-- Tenant migration 0008: what the unauthenticated odometer link (ADR-006) may do. Idempotent.
-- The link route can call exactly these two functions and nothing else of the tenant.

-- Plate and month for the page. Returns nothing for a submission that is not open for input.
create or replace function link_submission_info(p_submission uuid)
returns table (registration_no text, period date, due_on date)
language sql stable as $$
  select v.registration_no, c.period, c.due_on
    from odometer_submissions s
    join odometer_cycles c on c.id = s.cycle_id and c.status = 'open'
    join vehicles v on v.id = s.vehicle_id
   where s.id = p_submission and s.status in ('pending','rejected')
$$;

-- Saves the reading as "submitted" for an admin to approve. It never writes odometer_readings, so a link alone
-- cannot move a vehicle's odometer.
create or replace function submit_odometer_via_link(p_submission uuid, p_reading numeric) returns void
language plpgsql as $$
begin
  if p_reading is null or p_reading < 0 or p_reading > 9999999 then raise exception 'reading out of range'; end if;
  perform submit_odometer(p_submission, p_reading, null, 'Sent by the driver through a link');
end $$;

-- Closing a cycle stops further input; open cycles are what the links depend on.
create or replace function close_odometer_cycle(p_cycle uuid) returns void language plpgsql as $$
begin
  update odometer_cycles set status = 'closed', closed_at = now() where id = p_cycle and status = 'open';
  if not found then raise exception 'cycle is not open'; end if;
end $$;
