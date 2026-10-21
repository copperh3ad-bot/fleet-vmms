-- Aligns the schema with the screens in the design canvas. Every form field now has a column, and every
-- multi-table save has one function so it is atomic. Idempotent.

-- ---------- Vehicles ----------
alter table vehicles add column if not exists engine_no text;
alter table vehicles add column if not exists colour text;
alter table vehicles add column if not exists base_location text;
alter table vehicles add column if not exists vehicle_class text;          -- e.g. truck, pickup, car, van; used by service rules
-- "BNK-902", "bnk 902" and "BNK902" are the same plate.
create unique index if not exists vehicles_reg_norm_uq on vehicles (upper(regexp_replace(registration_no, '[\s-]', '', 'g')));

-- ---------- Job cards ----------
alter table job_cards add column if not exists requested_reason_code_id uuid references reason_codes(id);
alter table job_cards add column if not exists needed_by date;
update job_cards set requested_reason_code_id = reason_code_id where requested_reason_code_id is null;

-- The requester's own reason is kept when the manager re-tags at approval, so driver view and manager view can be compared.
create or replace function job_card_keep_requested_reason() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.requested_reason_code_id := coalesce(new.requested_reason_code_id, new.reason_code_id);
  else
    new.requested_reason_code_id := old.requested_reason_code_id;
  end if;
  return new;
end $$;
drop trigger if exists job_cards_requested_reason on job_cards;
create trigger job_cards_requested_reason before insert or update on job_cards
  for each row execute function job_card_keep_requested_reason();

-- ---------- Quotations: line items and terms ----------
alter table quotations add column if not exists days_needed int check (days_needed > 0);
alter table quotations add column if not exists valid_until date;
alter table quotations add column if not exists warranty_months int check (warranty_months >= 0);

create table if not exists quotation_lines (
  id           uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references quotations(id) on delete cascade,
  kind         text not null check (kind in ('part','labour','service','other')),
  description  text not null,
  qty          numeric(12,3) not null default 1 check (qty > 0),
  unit_cost    numeric(14,2) not null default 0 check (unit_cost >= 0)
);
create index if not exists quotation_lines_q_idx on quotation_lines(quotation_id);

-- The quotation total always equals its lines.
create or replace function quotation_total_sync() returns trigger language plpgsql as $$
declare qid uuid := coalesce(new.quotation_id, old.quotation_id);
begin
  update quotations set amount = coalesce((select sum(qty * unit_cost) from quotation_lines where quotation_id = qid), 0)
   where id = qid;
  return null;
end $$;
drop trigger if exists quotation_lines_total on quotation_lines;
create trigger quotation_lines_total after insert or update or delete on quotation_lines
  for each row execute function quotation_total_sync();

-- ---------- Invoices: lines, decision, payable amount ----------
alter table invoices add column if not exists payable_amount numeric(14,2) check (payable_amount >= 0);
alter table invoices add column if not exists decision text check (decision in ('pay_approved','pay_full','return'));
alter table invoices add column if not exists decision_note text;

create table if not exists invoice_lines (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references invoices(id) on delete cascade,
  quotation_line_id uuid references quotation_lines(id),    -- null = work nobody approved
  kind              text not null check (kind in ('part','labour','service','other')),
  description       text not null,
  qty               numeric(12,3) not null default 1 check (qty > 0),
  unit_cost         numeric(14,2) not null default 0 check (unit_cost >= 0)
);
create index if not exists invoice_lines_inv_idx on invoice_lines(invoice_id);

-- Side-by-side check for the finance screen.
create or replace view v_invoice_check as
select i.id as invoice_id, i.invoice_no, wo.job_card_id, wo.approved_amount, i.amount as invoiced_amount,
       i.amount - wo.approved_amount as variance,
       case when wo.approved_amount > 0 then round((i.amount - wo.approved_amount) / wo.approved_amount * 100, 1) end as variance_pct,
       (select count(*) from invoice_lines l where l.invoice_id = i.id and l.quotation_line_id is null) as unapproved_lines
from invoices i join work_orders wo on wo.id = i.work_order_id;

-- Finance decision. The verifier may not be the person who approved or raised the job card.
create or replace function verify_invoice(p_invoice uuid, p_user uuid, p_decision text, p_note text default null) returns void
language plpgsql as $$
declare inv invoices; wo work_orders; jc job_cards; pay numeric;
begin
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null or inv.status <> 'submitted' then raise exception 'invoice % is not awaiting verification', p_invoice; end if;
  select * into wo from work_orders where id = inv.work_order_id;
  select * into jc from job_cards where id = wo.job_card_id for update;
  if exists (select 1 from employees e where e.user_id = p_user and e.id in (jc.approved_by, jc.requested_by)) then
    raise exception 'segregation of duties: the approver or requester cannot verify this invoice';
  end if;
  if jc.status <> 'invoiced' then raise exception 'job card % is % and cannot be verified', jc.job_no, jc.status; end if;
  if p_decision in ('pay_full','return') and (p_note is null or length(trim(p_note)) < 5) then
    raise exception 'a note is required for decision %', p_decision;
  end if;
  if p_decision = 'return' then
    update invoices set status = 'disputed', decision = 'return', decision_note = p_note,
           verified_by = p_user, verified_at = now() where id = p_invoice;
    update job_cards set status = 'completed' where id = jc.id;
    insert into job_card_events(job_card_id, from_status, to_status, actor_id, comment)
      values (jc.id, 'invoiced', 'completed', p_user, p_note);
    return;
  end if;
  pay := case p_decision when 'pay_approved' then least(inv.amount, wo.approved_amount)
                          when 'pay_full' then inv.amount
                          else null end;
  if pay is null then raise exception 'unknown decision %', p_decision; end if;
  update invoices set status = 'verified', decision = p_decision, decision_note = p_note,
         payable_amount = pay, verified_by = p_user, verified_at = now() where id = p_invoice;
  update job_cards set status = 'invoice_verified' where id = jc.id;
  insert into job_card_events(job_card_id, from_status, to_status, actor_id, comment)
    values (jc.id, 'invoiced', 'invoice_verified', p_user, p_note);
end $$;

-- Vehicle cost counts what was actually payable, not what the workshop asked for.
create or replace view v_vehicle_job_cost as
select jc.id as job_card_id, jc.vehicle_id, jc.custodian_id, jc.reason_code_id, jc.odometer_km,
       jc.created_at,
       coalesce(
         (select sum(coalesce(i.payable_amount, i.amount) + i.tax_amount) from work_orders wo
            join invoices i on i.work_order_id = wo.id and i.status in ('verified','paid')
          where wo.job_card_id = jc.id),
         (select sum(l.qty * l.unit_cost) from job_card_lines l where l.job_card_id = jc.id),
         0) as cost
from job_cards jc
where jc.status not in ('draft','cancelled','rejected');

-- What a vendor may see: their own orders, no requester names, no budgets. Filters itself on the signed-in user.
create or replace view v_vendor_work_orders as
select wo.id as work_order_id, wo.wo_no, wo.vendor_id, wo.status as wo_status, wo.issued_at, wo.approved_amount,
       jc.job_no, jc.priority, jc.needed_by, jc.description, jc.cause_text, jc.odometer_km,
       v.registration_no, v.make, v.model, v.year
from work_orders wo
join job_cards jc on jc.id = wo.job_card_id
join vehicles v on v.id = jc.vehicle_id
where wo.vendor_id in (select id from vendors where user_id::text = current_setting('app.user_id', true));

-- ---------- Budgets ----------
alter table budgets add column if not exists reason text;
alter table budgets add column if not exists created_by uuid;

create or replace function budget_guard() returns trigger language plpgsql as $$
begin
  if exists (select 1 from budgets b
              where b.id is distinct from new.id
                and b.vehicle_id is not distinct from new.vehicle_id
                and daterange(b.period_start, b.period_end, '[]') && daterange(new.period_start, new.period_end, '[]')) then
    raise exception 'overlaps an existing budget for the same vehicle';
  end if;
  if tg_op = 'UPDATE' and new.amount <> old.amount
     and (new.reason is null or length(trim(new.reason)) < 5 or new.reason is not distinct from old.reason) then
    raise exception 'changing a budget amount needs a new reason';
  end if;
  return new;
end $$;
drop trigger if exists budgets_guard on budgets;
create trigger budgets_guard before insert or update on budgets for each row execute function budget_guard();

-- ---------- Settings: only known keys, valid values ----------
insert into settings(key, value) values
  ('budget_warn_pct','80'), ('budget_flag_pct','100'),
  ('flag_jobs_90d','3'), ('flag_repeat_days','60'), ('flag_cost_multiple','2.0'),
  ('doc_reminder_days','60,30,14'), ('odometer_due_day','25')
on conflict (key) do nothing;

create or replace function settings_guard() returns trigger language plpgsql as $$
begin
  if new.key = 'doc_reminder_days' then
    if new.value !~ '^[0-9]+(,[0-9]+)*$' then raise exception 'doc_reminder_days must look like 60,30,14'; end if;
  elsif new.key in ('pm_warning_days','pm_warning_km','odometer_max_km_per_day','odometer_stale_days','odometer_due_day',
                    'budget_warn_pct','budget_flag_pct','flag_jobs_90d','flag_repeat_days','flag_cost_multiple') then
    if new.value !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'setting % must be a number', new.key; end if;
  else
    raise exception 'unknown setting %', new.key;
  end if;
  return new;
end $$;
drop trigger if exists settings_validate on settings;
create trigger settings_validate before insert or update on settings for each row execute function settings_guard();

-- ---------- Service rules: which vehicles a rule applies to ----------
alter table service_types add column if not exists applies_to_classes text[];   -- null = every vehicle

create or replace view v_service_last_done as
select v.id as vehicle_id, st.key as service_type_key, last.done_on, last.odometer_km
from vehicles v
cross join service_types st
left join lateral (
  select h.done_on, h.odometer_km from (
    select b.last_done_on as done_on, b.last_odometer_km as odometer_km
      from vehicle_service_baselines b
     where b.vehicle_id = v.id and b.service_type_key = st.key
    union all
    select coalesce(wo.completed_at::date, jc.updated_at::date), jc.odometer_km
      from job_cards jc
      join job_card_lines l on l.job_card_id = jc.id and l.service_type_key = st.key
      left join work_orders wo on wo.job_card_id = jc.id
     where jc.vehicle_id = v.id
       and jc.status in ('completed','invoiced','invoice_verified','closed')
  ) h
  order by h.done_on desc
  limit 1
) last on true
where v.status in ('active','in_workshop') and st.active and st.is_preventive
  and (st.applies_to_classes is null or v.vehicle_class = any(st.applies_to_classes));

-- ---------- Compliance documents ----------
alter table compliance_docs add column if not exists valid_from date;
alter table compliance_docs add column if not exists issued_by text;
alter table compliance_docs add column if not exists cost numeric(14,2);

create table if not exists document_reminders (
  entity_type text not null check (entity_type in ('insurance_policy','compliance_doc')),
  entity_id   uuid not null,
  days_before int not null,
  sent_at     timestamptz not null default now(),
  primary key (entity_type, entity_id, days_before)
);

-- One list for the Compliance screen: insurance plus every other document, newest renewal per vehicle and type only.
create or replace view v_documents_expiring as
select distinct on (vehicle_id, doc_type) *
from (
  select p.id as entity_id, 'insurance_policy'::text as entity_type, p.vehicle_id, 'insurance'::text as doc_type,
         p.policy_no as reference, p.insurer as issued_by, p.valid_to as expires_on
    from insurance_policies p
  union all
  select d.id, 'compliance_doc', d.vehicle_id, d.doc_type, d.reference, d.issued_by, d.expires_on
    from compliance_docs d
) x
order by vehicle_id, doc_type, expires_on desc;

create or replace view v_documents_status as
select e.*, (e.expires_on - current_date) as days_left,
       case when e.expires_on < current_date then 'expired'
            when e.expires_on - current_date <= 30 then 'due_30'
            when e.expires_on - current_date <= 90 then 'due_90'
            else 'ok' end as doc_status
from v_documents_expiring e;

-- ---------- Accidents and challans ----------
create or replace function custodian_on(p_vehicle uuid, p_on date) returns uuid language sql stable as $$
  select employee_id from vehicle_custody
   where vehicle_id = p_vehicle and from_date <= p_on and (to_date is null or to_date >= p_on)
   order by from_date desc limit 1
$$;

do $$ begin
  alter table accidents drop constraint if exists accidents_severity_check;
  alter table accidents add constraint accidents_severity_check check (severity in ('minor','moderate','major','total_loss'));
end $$;
alter table accidents add column if not exists fault text check (fault in ('third_party','our_driver','shared','unknown'));
alter table accidents add column if not exists insurance_claim boolean not null default false;
alter table accidents add column if not exists claim_ref text;
alter table challans add column if not exists paid_on date;

create or replace function accident_challan_defaults() returns trigger language plpgsql as $$
begin
  if new.employee_id is null then
    new.employee_id := custodian_on(new.vehicle_id, coalesce((to_jsonb(new)->>'occurred_at')::timestamptz, (to_jsonb(new)->>'issued_on')::timestamptz)::date);
  end if;
  return new;
end $$;
drop trigger if exists accidents_defaults on accidents;
create trigger accidents_defaults before insert on accidents for each row execute function accident_challan_defaults();
drop trigger if exists challans_defaults on challans;
create trigger challans_defaults before insert on challans for each row execute function accident_challan_defaults();

create or replace function challan_paid_date() returns trigger language plpgsql as $$
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status <> 'paid') then new.paid_on := coalesce(new.paid_on, current_date); end if;
  return new;
end $$;
drop trigger if exists challans_paid on challans;
create trigger challans_paid before insert or update on challans for each row execute function challan_paid_date();

-- ---------- One save for the Add a vehicle screen ----------
create or replace function onboard_vehicle(p jsonb, p_user uuid default null) returns uuid
language plpgsql as $$
declare vid uuid; b jsonb; d jsonb; ins jsonb;
begin
  insert into vehicles(registration_no, make, model, year, fuel_type, vin, engine_no, colour, base_location, vehicle_class)
  values (upper(trim(p->>'registration_no')), p->>'make', p->>'model', (p->>'year')::int, p->>'fuel_type', p->>'vin',
          p->>'engine_no', p->>'colour', p->>'base_location', p->>'vehicle_class')
  returning id into vid;

  if p->>'odometer_km' is not null then
    insert into odometer_readings(vehicle_id, reading_km, source, entered_by)
    values (vid, (p->>'odometer_km')::numeric, 'baseline', p_user);
  end if;

  if p->>'employee_id' is not null then
    insert into vehicle_custody(vehicle_id, employee_id, from_date)
    values (vid, (p->>'employee_id')::uuid, coalesce((p->>'holding_since')::date, current_date));
  end if;

  for b in select * from jsonb_array_elements(coalesce(p->'baselines', '[]'::jsonb)) loop
    insert into vehicle_service_baselines(vehicle_id, service_type_key, last_done_on, last_odometer_km)
    values (vid, b->>'service_type_key', (b->>'last_done_on')::date, (b->>'last_odometer_km')::numeric);
  end loop;

  ins := p->'insurance';
  if ins is not null and ins <> 'null'::jsonb then
    insert into insurance_policies(vehicle_id, insurer, policy_no, valid_from, valid_to, premium)
    values (vid, ins->>'insurer', ins->>'policy_no', (ins->>'valid_from')::date, (ins->>'valid_to')::date, (ins->>'premium')::numeric);
  end if;

  for d in select * from jsonb_array_elements(coalesce(p->'documents', '[]'::jsonb)) loop
    insert into compliance_docs(vehicle_id, doc_type, reference, expires_on, issued_by)
    values (vid, d->>'doc_type', d->>'reference', (d->>'expires_on')::date, d->>'issued_by');
  end loop;

  if p->>'budget_amount' is not null then
    insert into budgets(vehicle_id, period_start, period_end, amount, created_by, reason)
    values (vid, (p->>'budget_from')::date, (p->>'budget_to')::date, (p->>'budget_amount')::numeric, p_user, 'initial budget');
  end if;
  return vid;
end $$;

-- ---------- Audit the new tables ----------
do $$
declare t text;
begin
  foreach t in array array['quotation_lines','invoice_lines','settings'] loop
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_trigger()', t || '_audit', t);
  end loop;
end $$;
