-- Tenant migration 0038: the administrator may decide their own job card, quotation or invoice check only when nobody else could (ADR-072). Idempotent.
--
-- ADR-029 let the administrator approve a card they raised themselves, so a company run by one person is not stuck. The cost was that "nobody approves their own job"
-- stopped being true for every company, including ones with a fleet manager. Now the exception applies only while no one else holds the permission: as soon as a
-- second active person who can approve exists, the administrator is held to the same rule as everyone else. The decision is still recorded with the person and time.

-- True for the signed-in administrator when no other active member of this organization holds the permission. False for every other role.
create or replace function admin_may_decide_own(p_permission text) returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('app.role', true), ''), '') = 'tenant_admin'
     and not exists (
       select 1 from public.tenant_memberships m
        where m.tenant_id = (select t.id from public.tenants t where t.schema_name = current_schema())
          and m.status = 'active'
          and m.user_id::text is distinct from nullif(current_setting('app.user_id', true), '')
          and m.role in (select role_key from role_permissions where permission_key = p_permission))
$$;

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
        -- Nobody approves a card they raised, except the administrator while no one else could approve it (ADR-072).
        if new.approved_by = new.requested_by and not admin_may_decide_own('jobcard.approve') then
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
  if me is not null and me = jc.requested_by and not admin_may_decide_own('quotation.approve') then
    raise exception 'segregation of duties: the requester cannot approve the quotation';
  end if;
  update quotations set status = 'approved' where id = q.id;
  insert into work_orders(wo_no, job_card_id, vendor_id, quotation_id, approved_amount)
  values ('WO-' || lpad(nextval('work_order_seq')::text, 6, '0'), jc.id, q.vendor_id, q.id, q.amount)
  returning id into wid;
  perform transition_job_card(jc.id, 'quotation_approved', p_user, p_note);
  return wid;
end $$;

-- Finance decision. The verifier may not be the person who approved or raised the job card, unless they are the administrator and no one else could verify.
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

-- Stay closed to every role by default (migration 0037); the app's own login is the owner and needs no grant.
revoke execute on function admin_may_decide_own(text) from public;
