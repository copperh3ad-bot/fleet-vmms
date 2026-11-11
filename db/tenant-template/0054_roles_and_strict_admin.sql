-- Tenant migration 0054 (ADR-088): owner decisions A1 to A5 of 2026-11-11 (docs/OWNER-DECISIONS-2026-11-11.md). Idempotent.
--  A1 the administrator may decide other people's job cards, quotations and invoice checks only if the company allows it (setting admin_decides_others,
--     default off = strict), and strict never blocks a company with no other approver;
--  A2 Logistics may give a pool vehicle on an HR request; purchases and rejections stay with Fleet Manager and Admin (vreq.decide);
--  A3 Logistics may approve and reject trips: no new permission; the rule 'dispatchable' in the trips service now includes a trip with no vehicle chosen yet while
--     Logistics sees the whole fleet (the default). In department-scoped mode it still sees and acts only on its own department's trips;
--  A4 the auditor reads cargo (invoices were done in 0053);
--  A5 HR sees the pool, read-only.

-- ---------- Permissions ----------
insert into permissions(key, description) values
  ('vreq.assign','Give a vehicle from the pool for a vehicle request'),
  ('vreq.see_pool','See the vehicles nobody holds at the moment (read-only)'),
  ('cargo.read_all','See every cargo request, read-only')
on conflict (key) do nothing;
insert into role_permissions(role_key, permission_key)
select r, p from (values
  ('logistics','vreq.assign'),('fleet_manager','vreq.assign'),('tenant_admin','vreq.assign'),
  ('logistics','vreq.see_pool'),('fleet_manager','vreq.see_pool'),('tenant_admin','vreq.see_pool'),('hr','vreq.see_pool'),
  ('logistics','vreq.read_all'),
  ('auditor','cargo.read_all')
) as x(r, p)
on conflict do nothing;

-- ---------- Setting (the guard must know the key BEFORE it is inserted) ----------
create or replace function settings_guard() returns trigger language plpgsql as $$
begin
  if new.key = 'doc_reminder_days' then
    if new.value !~ '^[0-9]+(,[0-9]+)*$' then raise exception 'doc_reminder_days must look like 60,30,14'; end if;
  elsif new.key in ('module_trips','odometer_whatsapp','allow_learner_licence','admin_decides_others') then
    if new.value not in ('0','1') then raise exception '% must be 0 or 1', new.key; end if;
  elsif new.key = 'odometer_send_day' then
    if new.value !~ '^[0-9]+$' or new.value::int not between 1 and 28 then raise exception 'odometer_send_day must be a day from 1 to 28'; end if;
  elsif new.key in ('dept_approval_limit','payment_approval_limit') then
    if new.value <> '' and new.value !~ '^[0-9]+(\.[0-9]+)?$' then raise exception '% must be a number or empty', new.key; end if;
  elsif new.key = 'invoice_over_quote_pct' then
    if new.value !~ '^[0-9]+(\.[0-9]+)?$' or new.value::numeric > 1000 then raise exception 'invoice_over_quote_pct must be a number up to 1000'; end if;
  elsif new.key in ('pm_warning_days','pm_warning_km','pm_warning_hours','odometer_max_km_per_day','odometer_stale_days','odometer_due_day',
                    'budget_warn_pct','budget_flag_pct','flag_jobs_90d','flag_repeat_days','flag_cost_multiple',
                    'policy_replace_years','policy_free_accidents','policy_accident_gap_months','policy_driver_share_pct') then
    if new.value !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'setting % must be a number', new.key; end if;
    if new.key = 'policy_driver_share_pct' and new.value::numeric > 100 then raise exception 'policy_driver_share_pct cannot be above 100'; end if;
  else
    raise exception 'unknown setting %', new.key;
  end if;
  return new;
end $$;
insert into settings(key, value) values ('admin_decides_others', '0') on conflict (key) do nothing;

-- ---------- A1: strict administrator ----------
-- True when the signed-in administrator is NOT allowed to decide this kind of item because the company is strict (setting 0 or missing) and another active
-- member who is not the administrator holds the permission. False for every other role, and false when no one else could decide, so a company
-- without a fleet manager (or other approver) is never stuck. A workshop never counts (ADR-033), and a disabled or uninvited person does not count.
create or replace function admin_blocked_from_others(p_permission text) returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('app.role', true), ''), '') = 'tenant_admin'
     and coalesce((select s.value from settings s where s.key = 'admin_decides_others'), '0') <> '1'
     and exists (
       select 1 from public.tenant_memberships m
        where m.tenant_id = (select t.id from public.tenants t where t.schema_name = current_schema())
          and m.status = 'active'
          and m.role not in ('vendor', 'tenant_admin')
          and m.user_id::text is distinct from nullif(current_setting('app.user_id', true), '')
          and m.role in (select rp.role_key from role_permissions rp where rp.permission_key = p_permission))
$$;
revoke execute on function admin_blocked_from_others(text) from public;

-- Job card approval: one more check next to the existing ones (everything else is unchanged from 0040).
create or replace function job_card_guard() returns trigger language plpgsql as $$
declare ok boolean; actor text := nullif(current_setting('app.user_id', true), '');
begin
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      ok := (old.status, new.status) in (
        ('draft','submitted'),('draft','cancelled'),
        ('submitted','approved'),('submitted','rejected'),('submitted','returned_for_edit'),
        ('returned_for_edit','submitted'),('returned_for_edit','cancelled'),
        ('approved','vendor_assigned'),
        ('vendor_assigned','quotation_received'),
        ('quotation_received','quotation_approved'),('quotation_received','vendor_assigned'),
        ('quotation_approved','in_progress'),
        ('in_progress','completed'),
        ('completed','invoiced'),
        ('invoiced','invoice_verified'),('invoiced','completed'),
        ('invoice_verified','closed')
      );
      if not ok then
        raise exception 'illegal job card transition % -> %', old.status, new.status;
      end if;
      if new.status = 'closed' then new.closed_at := now(); end if;

      if new.status = 'approved' then
        if new.approved_by is null then
          raise exception 'approval needs an approver';
        end if;
        -- Nobody approves a card they raised, except the administrator while no one else could approve this card (ADR-072, ADR-074).
        if new.approved_by = new.requested_by and not admin_may_decide_own('jobcard.approve', new.vehicle_id, new.estimated_cost) then
          raise exception 'segregation of duties: the requester cannot approve their own job card';
        end if;
        if actor is null or not exists (select 1 from employees e where e.id = new.approved_by and e.user_id::text = actor) then
          raise exception 'segregation of duties: the approver must be the signed-in user';
        end if;
        if not exists (select 1 from role_permissions rp
                        where rp.role_key = nullif(current_setting('app.role', true), '') and rp.permission_key = 'jobcard.approve') then
          raise exception 'this role may not approve job cards';
        end if;
        if admin_blocked_from_others('jobcard.approve') then
          raise exception 'company rule: the administrator does not decide job cards while a fleet manager or other approver is active';
        end if;
      end if;
    end if;
    if new.approved_by is distinct from old.approved_by and not (new.status = 'approved' and old.status <> 'approved') then
      raise exception 'the approver can only be set by approving';
    end if;
    if new.requested_by is distinct from old.requested_by and old.status not in ('draft','returned_for_edit') then
      raise exception 'the requester cannot change after submission';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Quotation approval (from 0040) with the same company rule.
create or replace function approve_quotation(p_quotation uuid, p_user uuid, p_note text default null) returns uuid
language plpgsql as $$
declare q quotations; jc job_cards; wid uuid; me uuid := actor_employee(p_user);
begin
  select * into q from quotations where id = p_quotation for update;
  if q.id is null then raise exception 'quotation not found'; end if;
  select * into jc from job_cards where id = q.job_card_id for update;
  if q.status <> 'submitted' or jc.status <> 'quotation_received' then raise exception 'this quotation is not awaiting a decision'; end if;
  if me is not null and me = jc.requested_by and not admin_may_decide_own('quotation.approve', jc.vehicle_id, q.amount) then
    raise exception 'segregation of duties: the requester cannot approve the quotation';
  end if;
  if admin_blocked_from_others('quotation.approve') then
    raise exception 'company rule: the administrator does not decide quotations while a fleet manager or other approver is active';
  end if;
  update quotations set status = 'approved' where id = q.id;
  insert into work_orders(wo_no, job_card_id, vendor_id, quotation_id, approved_amount)
  values ('WO-' || lpad(nextval('work_order_seq')::text, 6, '0'), jc.id, q.vendor_id, q.id, q.amount)
  returning id into wid;
  perform transition_job_card(jc.id, 'quotation_approved', p_user, p_note);
  return wid;
end $$;

-- Invoice check (from 0038) with the same company rule.
create or replace function verify_invoice(p_invoice uuid, p_user uuid, p_decision text, p_note text default null) returns void
language plpgsql as $$
declare inv invoices; wo work_orders; jc job_cards; pay numeric;
begin
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null or inv.status <> 'submitted' then raise exception 'invoice % is not awaiting verification', p_invoice; end if;
  select * into wo from work_orders where id = inv.work_order_id;
  select * into jc from job_cards where id = wo.job_card_id for update;
  if not admin_may_decide_own('invoice.verify')
     and exists (select 1 from employees e where e.user_id = p_user and e.id in (jc.approved_by, jc.requested_by)) then
    raise exception 'segregation of duties: the approver or requester cannot verify this invoice';
  end if;
  if admin_blocked_from_others('invoice.verify') then
    raise exception 'company rule: the administrator does not check invoices while Finance or another checker is active';
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

