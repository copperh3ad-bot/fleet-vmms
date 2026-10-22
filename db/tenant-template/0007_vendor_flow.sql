-- Tenant migration 0007: vendor flow (quotation, work order, invoice). Idempotent.
-- Each step is one SQL function. A vendor's login is tied to exactly one active vendor, and every vendor function
-- checks that the job or work order belongs to that vendor. Job card status always moves through
-- transition_job_card (migration 0006), so the guard and the event row apply here too.

create sequence if not exists work_order_seq;
create unique index if not exists vendors_user_uq on vendors(user_id) where user_id is not null;

create or replace function vendor_of(p_user uuid) returns uuid language sql stable as $$
  select id from vendors where user_id = p_user and status = 'active'
$$;

-- ---------- What a vendor may see ----------
-- All filter on the signed-in user (app.user_id). No requester names, no budgets, no other vendors.
create or replace view v_vendor_work_orders as
select wo.id as work_order_id, wo.wo_no, wo.vendor_id, wo.status as wo_status, wo.issued_at, wo.approved_amount,
       jc.job_no, jc.priority, jc.needed_by, jc.description, jc.cause_text, jc.odometer_km,
       v.registration_no, v.make, v.model, v.year,
       jc.id as job_card_id, jc.status as job_status, wo.quotation_id, wo.completed_at
from work_orders wo
join job_cards jc on jc.id = wo.job_card_id
join vehicles v on v.id = jc.vehicle_id
where wo.vendor_id in (select id from vendors where user_id::text = current_setting('app.user_id', true));

-- Jobs assigned to the vendor that still need a quotation (or are waiting for the decision).
create or replace view v_vendor_job_requests as
select jc.id as job_card_id, jc.job_no, jc.status as job_status, jc.priority, jc.needed_by, jc.description, jc.cause_text,
       jc.odometer_km, jc.vendor_id, v.registration_no, v.make, v.model, v.year,
       (select q.status from quotations q where q.job_card_id = jc.id order by q.created_at desc limit 1) as last_quotation_status
from job_cards jc join vehicles v on v.id = jc.vehicle_id
where jc.status in ('vendor_assigned','quotation_received')
  and jc.vendor_id in (select id from vendors where user_id::text = current_setting('app.user_id', true));

create or replace view v_vendor_quotation_lines as
select ql.id as line_id, ql.quotation_id, q.job_card_id, q.vendor_id, q.status as quotation_status, ql.kind, ql.description, ql.qty, ql.unit_cost
from quotation_lines ql join quotations q on q.id = ql.quotation_id
where q.vendor_id in (select id from vendors where user_id::text = current_setting('app.user_id', true));

create or replace view v_vendor_invoices as
select i.id as invoice_id, i.work_order_id, i.invoice_no, i.invoice_date, i.amount, i.tax_amount, i.status,
       i.payable_amount, i.decision, case when i.decision = 'return' then i.decision_note end as return_note, wo.vendor_id
from invoices i join work_orders wo on wo.id = i.work_order_id
where wo.vendor_id in (select id from vendors where user_id::text = current_setting('app.user_id', true));

-- ---------- Quotation ----------
create or replace function submit_quotation(p_job uuid, p_user uuid, p jsonb) returns uuid language plpgsql as $$
declare jc job_cards; vid uuid := vendor_of(p_user); qid uuid; l jsonb;
begin
  if vid is null then raise exception 'this login is not linked to an active vendor'; end if;
  select * into jc from job_cards where id = p_job for update;
  if jc.id is null or jc.vendor_id is distinct from vid then raise exception 'job card not found'; end if;
  if jc.status <> 'vendor_assigned' then raise exception 'this job is not waiting for a quotation'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'add at least one line'; end if;
  insert into quotations(job_card_id, vendor_id, amount, details, days_needed, valid_until, warranty_months)
  values (p_job, vid, 0, nullif(p->>'details', ''), nullif(p->>'days_needed', '')::int,
          nullif(p->>'valid_until', '')::date, nullif(p->>'warranty_months', '')::int)
  returning id into qid;
  for l in select * from jsonb_array_elements(p->'lines') loop
    insert into quotation_lines(quotation_id, kind, description, qty, unit_cost)
    values (qid, coalesce(nullif(l->>'kind', ''), 'service'), l->>'description',
            coalesce(nullif(l->>'qty', '')::numeric, 1), coalesce(nullif(l->>'unit_cost', '')::numeric, 0));
  end loop;
  perform transition_job_card(p_job, 'quotation_received', p_user);
  return qid;
end $$;

-- Approving a quotation issues the work order for exactly the quoted amount.
create or replace function approve_quotation(p_quotation uuid, p_user uuid, p_note text default null) returns uuid
language plpgsql as $$
declare q quotations; jc job_cards; wid uuid; me uuid := actor_employee(p_user);
begin
  select * into q from quotations where id = p_quotation for update;
  if q.id is null then raise exception 'quotation not found'; end if;
  select * into jc from job_cards where id = q.job_card_id for update;
  if q.status <> 'submitted' or jc.status <> 'quotation_received' then raise exception 'this quotation is not awaiting a decision'; end if;
  if me is not null and me = jc.requested_by then
    raise exception 'segregation of duties: the requester cannot approve the quotation';
  end if;
  update quotations set status = 'approved' where id = q.id;
  insert into work_orders(wo_no, job_card_id, vendor_id, quotation_id, approved_amount)
  values ('WO-' || lpad(nextval('work_order_seq')::text, 6, '0'), jc.id, q.vendor_id, q.id, q.amount)
  returning id into wid;
  perform transition_job_card(jc.id, 'quotation_approved', p_user, p_note);
  return wid;
end $$;

-- Rejecting sends the job back to "vendor assigned" so the same vendor can quote again.
create or replace function reject_quotation(p_quotation uuid, p_user uuid, p_note text) returns void language plpgsql as $$
declare q quotations; jc job_cards;
begin
  if length(trim(coalesce(p_note, ''))) < 5 then raise exception 'a comment of at least 5 characters is required'; end if;
  select * into q from quotations where id = p_quotation for update;
  if q.id is null then raise exception 'quotation not found'; end if;
  select * into jc from job_cards where id = q.job_card_id for update;
  if q.status <> 'submitted' or jc.status <> 'quotation_received' then raise exception 'this quotation is not awaiting a decision'; end if;
  update quotations set status = 'rejected' where id = q.id;
  perform transition_job_card(jc.id, 'vendor_assigned', p_user, p_note);
end $$;

-- ---------- Work ----------
create or replace function vendor_start_work(p_wo uuid, p_user uuid) returns void language plpgsql as $$
declare wo work_orders; vid uuid := vendor_of(p_user);
begin
  select * into wo from work_orders where id = p_wo for update;
  if vid is null or wo.id is null or wo.vendor_id <> vid then raise exception 'work order not found'; end if;
  if wo.status <> 'issued' then raise exception 'this work order has already been started'; end if;
  update work_orders set status = 'in_progress' where id = p_wo;
  perform transition_job_card(wo.job_card_id, 'in_progress', p_user);
end $$;

create or replace function vendor_complete_work(p_wo uuid, p_user uuid, p_note text default null) returns void language plpgsql as $$
declare wo work_orders; vid uuid := vendor_of(p_user);
begin
  select * into wo from work_orders where id = p_wo for update;
  if vid is null or wo.id is null or wo.vendor_id <> vid then raise exception 'work order not found'; end if;
  if wo.status <> 'in_progress' then raise exception 'start the work before completing it'; end if;
  update work_orders set status = 'completed', completed_at = now() where id = p_wo;
  perform transition_job_card(wo.job_card_id, 'completed', p_user, p_note);
end $$;

-- ---------- Invoice ----------
-- The invoice total is the sum of its lines. A line may point at the quotation line it bills; a line with no
-- pointer is work nobody approved and shows up as such on the finance screen.
create or replace function submit_invoice(p_wo uuid, p_user uuid, p jsonb) returns uuid language plpgsql as $$
declare wo work_orders; jc job_cards; vid uuid := vendor_of(p_user); iid uuid; l jsonb; total numeric; qlid uuid;
begin
  select * into wo from work_orders where id = p_wo for update;
  if vid is null or wo.id is null or wo.vendor_id <> vid then raise exception 'work order not found'; end if;
  select * into jc from job_cards where id = wo.job_card_id for update;
  if exists (select 1 from invoices where work_order_id = p_wo and status in ('submitted','verified','paid')) then
    raise exception 'an invoice is already open for this work order';
  end if;
  if wo.status <> 'completed' or jc.status <> 'completed' then raise exception 'the work must be completed before invoicing'; end if;
  if length(trim(coalesce(p->>'invoice_no', ''))) = 0 then raise exception 'enter the invoice number'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'add at least one line'; end if;
  total := (select coalesce(sum(coalesce(nullif(e->>'qty', '')::numeric, 1) * coalesce(nullif(e->>'unit_cost', '')::numeric, 0)), 0)
              from jsonb_array_elements(p->'lines') e);
  insert into invoices(work_order_id, invoice_no, invoice_date, amount, tax_amount)
  values (p_wo, trim(p->>'invoice_no'), coalesce(nullif(p->>'invoice_date', '')::date, current_date), total,
          coalesce(nullif(p->>'tax_amount', '')::numeric, 0))
  returning id into iid;
  for l in select * from jsonb_array_elements(p->'lines') loop
    qlid := nullif(l->>'quotation_line_id', '')::uuid;
    if qlid is not null and not exists (select 1 from quotation_lines where id = qlid and quotation_id = wo.quotation_id) then
      raise exception 'an invoice line points at a line that is not in the approved quotation';
    end if;
    insert into invoice_lines(invoice_id, quotation_line_id, kind, description, qty, unit_cost)
    values (iid, qlid, coalesce(nullif(l->>'kind', ''), 'service'), l->>'description',
            coalesce(nullif(l->>'qty', '')::numeric, 1), coalesce(nullif(l->>'unit_cost', '')::numeric, 0));
  end loop;
  perform transition_job_card(jc.id, 'invoiced', p_user);
  return iid;
end $$;

-- ---------- transition_job_card: going back to "vendor assigned" ----------
-- Redefined from 0006. Coming back from "quotation received" (a rejected quotation) keeps the current vendor unless
-- a different one is chosen; a first assignment still needs a vendor.
create or replace function transition_job_card(p_job uuid, p_to text, p_user uuid, p_comment text default null,
                                               p_patch jsonb default '{}'::jsonb) returns void
language plpgsql as $$
declare jc job_cards; me uuid := actor_employee(p_user); rc uuid; vid uuid;
begin
  select * into jc from job_cards where id = p_job for update;
  if jc.id is null then raise exception 'job card not found'; end if;
  if jc.status = p_to then raise exception 'job card is already %', p_to; end if;
  if p_to in ('rejected','returned_for_edit') and length(trim(coalesce(p_comment, ''))) < 5 then
    raise exception 'a comment of at least 5 characters is required';
  end if;
  if p_to in ('submitted','cancelled') and not job_card_is_mine(p_job, p_user) then
    raise exception 'only the requester can % this job card', case p_to when 'submitted' then 'submit' else 'cancel' end;
  end if;

  if p_to = 'approved' then
    if me is null then raise exception 'you need an employee record linked to your login to approve'; end if;
    rc := nullif(p_patch->>'reason_code_id', '')::uuid;
    if rc is not null and not exists (select 1 from reason_codes where id = rc and active) then raise exception 'reason code not available'; end if;
    update job_cards set status = 'approved', approved_by = me, reason_code_id = coalesce(rc, reason_code_id) where id = p_job;
  elsif p_to = 'vendor_assigned' then
    vid := coalesce(nullif(p_patch->>'vendor_id', '')::uuid, case when jc.status = 'quotation_received' then jc.vendor_id end);
    if vid is null or not exists (select 1 from vendors where id = vid and status = 'active') then raise exception 'choose an active vendor'; end if;
    update job_cards set status = 'vendor_assigned', vendor_id = vid where id = p_job;
  else
    update job_cards set status = p_to where id = p_job;
  end if;

  insert into job_card_events(job_card_id, from_status, to_status, actor_id, comment)
  values (p_job, jc.status, p_to, p_user, nullif(trim(coalesce(p_comment, '')), ''));
end $$;
