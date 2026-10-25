-- Tenant migration 0021: the administrator can decide quotations and check invoices on job cards they raised or approved. Idempotent.
-- Every other role keeps the separation of duties. The decision is still recorded with the person and the time.

insert into role_permissions(role_key, permission_key) values
  ('tenant_admin', 'quotation.approve'),
  ('tenant_admin', 'invoice.verify')
on conflict do nothing;

-- Approving a quotation issues the work order for exactly the quoted amount. The requester may not approve it, unless they are the administrator.
create or replace function approve_quotation(p_quotation uuid, p_user uuid, p_note text default null) returns uuid
language plpgsql as $$
declare q quotations; jc job_cards; wid uuid; me uuid := actor_employee(p_user);
begin
  select * into q from quotations where id = p_quotation for update;
  if q.id is null then raise exception 'quotation not found'; end if;
  select * into jc from job_cards where id = q.job_card_id for update;
  if q.status <> 'submitted' or jc.status <> 'quotation_received' then raise exception 'this quotation is not awaiting a decision'; end if;
  if me is not null and me = jc.requested_by and coalesce(nullif(current_setting('app.role', true), ''), '') <> 'tenant_admin' then
    raise exception 'segregation of duties: the requester cannot approve the quotation';
  end if;
  update quotations set status = 'approved' where id = q.id;
  insert into work_orders(wo_no, job_card_id, vendor_id, quotation_id, approved_amount)
  values ('WO-' || lpad(nextval('work_order_seq')::text, 6, '0'), jc.id, q.vendor_id, q.id, q.amount)
  returning id into wid;
  perform transition_job_card(jc.id, 'quotation_approved', p_user, p_note);
  return wid;
end $$;

-- Finance decision. The verifier may not be the person who approved or raised the job card, unless they are the administrator.
create or replace function verify_invoice(p_invoice uuid, p_user uuid, p_decision text, p_note text default null) returns void
language plpgsql as $$
declare inv invoices; wo work_orders; jc job_cards; pay numeric;
begin
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null or inv.status <> 'submitted' then raise exception 'invoice % is not awaiting verification', p_invoice; end if;
  select * into wo from work_orders where id = inv.work_order_id;
  select * into jc from job_cards where id = wo.job_card_id for update;
  if coalesce(nullif(current_setting('app.role', true), ''), '') <> 'tenant_admin'
     and exists (select 1 from employees e where e.user_id = p_user and e.id in (jc.approved_by, jc.requested_by)) then
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
