-- Tenant migration 0039: the "every status leaves an event" check runs with its owner's rights (ADR-073). Idempotent.
--
-- Migration 0006 checks at commit that a job card's new status has a job_card_events row. That check is a deferred trigger, so it runs when the transaction commits,
-- with the rights of whoever is acting then. For a workshop using its one-time link, an invoice link or an emailed estimate, that is a restricted database role
-- (quotation_link, inbound_mail) which has no table access by design, so the check failed with "permission denied for table job_card_events" and no estimate or
-- invoice could be saved. Tests passed because they ran as a superuser, which ignores table permissions; the live database does not.
--
-- The check only reads one table to make sure the history is complete, so it runs as the function's owner with a pinned search_path. The restricted roles gain no access.

do $mig$
declare s text := current_schema();
begin
  execute format($f$
    create or replace function job_card_event_required() returns trigger
    language plpgsql security definer set search_path = %I, public as $b$
    begin
      if not exists (select 1 from job_card_events e
                      where e.job_card_id = new.id and e.to_status = new.status and e.created_at = now()) then
        raise exception 'job card %% moved to %% without a job_card_events row', new.job_no, new.status;       -- %% because this text goes through format()
      end if;
      return null;
    end $b$
  $f$, s);
  execute format('revoke execute on function %I.job_card_event_required() from public', s);        -- as every function since 0037: no role runs it by name
end
$mig$;
