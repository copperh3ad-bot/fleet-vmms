-- Tenant migration 0020: the administrator can approve job cards, including one they raised themselves. Idempotent.
-- Every other role keeps the rule that a requester cannot approve their own card. The approval is still recorded with the
-- person and the time, and the event shows who raised and who approved.

insert into role_permissions(role_key, permission_key) values
  ('tenant_admin', 'jobcard.approve'),
  ('tenant_admin', 'jobcard.assign_vendor')
on conflict do nothing;

-- The table's own "approver is not the requester" check cannot tell roles apart. The guard below keeps the rule for everyone but the
-- administrator, so the blunt check goes.
alter table job_cards drop constraint if exists job_cards_check;

create or replace function job_card_guard() returns trigger language plpgsql as $$
declare ok boolean; actor text := nullif(current_setting('app.user_id', true), '');
        actor_role text := coalesce(nullif(current_setting('app.role', true), ''), '');
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
        -- The administrator is the one role allowed to approve a card they raised themselves.
        if new.approved_by = new.requested_by and actor_role <> 'tenant_admin' then
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
