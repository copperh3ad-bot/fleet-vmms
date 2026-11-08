-- Tenant migration 0040: the administrator's "nobody else could" test looks at what each other approver can actually decide (ADR-074). Idempotent.
--
-- Migration 0038 let the administrator decide their own job card, quotation or invoice check only while no other active member holds the permission. A person
-- who holds the permission but is tied to a department (the logistics role, ADR-048) can decide only that department's vehicles, and only up to the department
-- approval limit. Counting such a person as "someone else could" left a card nobody could decide: the administrator was blocked and the department approver was
-- refused by dept_ok() or the limit guard. The test now also asks whether the other member could decide THIS card (its vehicle and amount).

-- The scope-aware form. A null vehicle or amount means "no scope to test", which is what the one-argument form below passes.
create or replace function admin_may_decide_own(p_permission text, p_vehicle uuid, p_amount numeric) returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('app.role', true), ''), '') = 'tenant_admin'
     and not exists (
       select 1 from public.tenant_memberships m
        where m.tenant_id = (select t.id from public.tenants t where t.schema_name = current_schema())
          and m.status = 'active'
          and m.user_id::text is distinct from nullif(current_setting('app.user_id', true), '')
          and m.role in (select role_key from role_permissions where permission_key = p_permission)
          -- a department role decides only its own department's vehicles ...
          and (p_vehicle is null
               or not exists (select 1 from role_departments rd where rd.role_key = m.role)
               or exists (select 1 from role_departments rd join vehicles v on v.id = p_vehicle
                           where rd.role_key = m.role and lower(btrim(v.department)) = lower(btrim(rd.department))))
          -- ... and only up to the department approval limit (empty limit = no limit)
          and (p_amount is null
               or not exists (select 1 from role_departments rd where rd.role_key = m.role)
               or coalesce((select nullif(s.value, '') from settings s where s.key = 'dept_approval_limit'), '') = ''
               or coalesce(p_amount, 0) <= (select s.value::numeric from settings s where s.key = 'dept_approval_limit')))
$$;

-- The one-argument form keeps working for callers that have no card in hand: any holder of the permission counts, as in 0038.
create or replace function admin_may_decide_own(p_permission text) returns boolean language sql stable as $$
  select admin_may_decide_own(p_permission, null::uuid, null::numeric)
$$;

-- The three decisions pass the card's vehicle and amount.
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
  update quotations set status = 'approved' where id = q.id;
  insert into work_orders(wo_no, job_card_id, vendor_id, quotation_id, approved_amount)
  values ('WO-' || lpad(nextval('work_order_seq')::text, 6, '0'), jc.id, q.vendor_id, q.id, q.amount)
  returning id into wid;
  perform transition_job_card(jc.id, 'quotation_approved', p_user, p_note);
  return wid;
end $$;

-- Stay closed to every role by default (migration 0037); the app's own login is the owner and needs no grant.
revoke execute on function admin_may_decide_own(text) from public;
revoke execute on function admin_may_decide_own(text, uuid, numeric) from public;
