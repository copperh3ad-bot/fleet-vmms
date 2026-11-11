-- Tenant migration 0063 (ADR-095): owner decisions G1 and G5 of 2026-11-11. Idempotent.
-- G5: the requester may reopen a job card that was rejected, with a reason (the reason is required by the application; the person who may submit a card is already limited
--     to its requester by transition_job_card). The guard below is the one from 0054 with one more allowed step: rejected -> submitted. Nothing else in it changes.
-- G1: the repeat window is 30 days. A company that never changed the old default of 60 moves to 30; a company that set its own number keeps it.
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
        ('invoice_verified','closed'),
        ('rejected','submitted')
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

update settings set value = '30' where key = 'flag_repeat_days' and value = '60';
