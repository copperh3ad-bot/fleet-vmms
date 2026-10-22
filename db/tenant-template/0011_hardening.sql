-- Tenant migration 0011: audit gaps and a real restricted role for the odometer link. Idempotent.

-- ---------- Audit: tables that changed without a trace ----------
-- attachments: who added or removed a file. reason_codes, roles, permissions: configuration that changes what people
-- may do or how costs are classified. (tests/audit-coverage.test.ts fails if a new table is left out without a reason.)
do $$
declare t text;
begin
  foreach t in array array['attachments','reason_codes','roles','permissions'] loop
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- ---------- The odometer link gets its own database role (ADR-006) ----------
-- The link route runs as role odometer_link: no table access at all, only EXECUTE on the two functions below, which
-- are SECURITY DEFINER with a pinned search_path. So even a bug in the route's code cannot read or change anything else.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'odometer_link') then
    create role odometer_link nologin noinherit;
  end if;
  execute format('grant odometer_link to %I', current_user);   -- lets the app's own login switch to it with SET ROLE
end $$;

do $mig$
declare s text := current_schema();
begin
  execute format($f$
    create or replace function link_submission_info(p_submission uuid)
    returns table (registration_no text, period date, due_on date)
    language sql stable security definer set search_path = %1$I, public as $b$
      select v.registration_no, c.period, c.due_on
        from odometer_submissions s
        join odometer_cycles c on c.id = s.cycle_id and c.status = 'open'
        join vehicles v on v.id = s.vehicle_id
       where s.id = p_submission and s.status in ('pending','rejected')
    $b$
  $f$, s);

  -- Marks the link used and saves the reading as "submitted" in one step, so a refused reading never burns a link and
  -- the route never needs to touch the links table. It never writes odometer_readings.
  execute format($f$
    create or replace function submit_odometer_via_link(p_submission uuid, p_reading numeric, p_token_hash text)
    returns void language plpgsql security definer set search_path = %1$I, public as $b$
    begin
      if p_reading is null or p_reading < 0 or p_reading > 9999999 then raise exception 'reading out of range'; end if;
      update public.odometer_links l set used_at = now()
       where l.token_hash = p_token_hash and l.submission_id = p_submission
         and l.tenant_id = (select t.id from public.tenants t where t.schema_name = current_schema())
         and l.used_at is null and l.revoked_at is null and l.expires_at > now();
      if not found then raise exception 'link is not valid'; end if;
      perform submit_odometer(p_submission, p_reading, null, 'Sent by the driver through a link');
    end $b$
  $f$, s);

  execute 'drop function if exists submit_odometer_via_link(uuid, numeric)';   -- the old invoker version from 0008
  execute format('revoke all on function %I.link_submission_info(uuid) from public', s);
  execute format('revoke all on function %I.submit_odometer_via_link(uuid, numeric, text) from public', s);
  execute format('grant usage on schema %I to odometer_link', s);
  execute format('grant execute on function %I.link_submission_info(uuid), %I.submit_odometer_via_link(uuid, numeric, text) to odometer_link', s, s);
end $mig$;
