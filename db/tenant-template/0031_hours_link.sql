-- Tenant migration 0031: engine hours through the driver's single-use link (ADR-048 phase 48b, extended). Idempotent.
-- A driver of a vehicle that has an hour meter may send the hours as well as, or instead of, the odometer. The link still
-- writes nothing but the submission; an approver turns it into readings, and a bad hour reading needs a note like a bad
-- odometer reading does. The link role keeps its two functions and nothing else.

alter table odometer_submissions add column if not exists reading_hours numeric(10,1) check (reading_hours is null or reading_hours >= 0);

do $mig$
declare s text := current_schema();
begin
  -- the page also needs to know whether to ask for the hour meter
  execute 'drop function if exists link_submission_info(uuid)';
  execute format($f$
    create function link_submission_info(p_submission uuid)
    returns table (registration_no text, period date, due_on date, tracks_hours boolean)
    language sql stable security definer set search_path = %1$I, public as $b$
      select v.registration_no, c.period, c.due_on, v.tracks_hours
        from odometer_submissions s
        join odometer_cycles c on c.id = s.cycle_id and c.status = 'open'
        join vehicles v on v.id = s.vehicle_id
       where s.id = p_submission and s.status in ('pending','rejected')
    $b$
  $f$, s);

  -- Marks the link used and saves the submission, in one step. Hours are accepted only for a vehicle that tracks them, and a
  -- submission needs at least one of the two numbers. A refused reading burns nothing: the whole call rolls back.
  execute 'drop function if exists submit_odometer_via_link(uuid, numeric, text)';
  execute 'drop function if exists submit_odometer_via_link(uuid, numeric, text, numeric)';
  execute format($f$
    create function submit_odometer_via_link(p_submission uuid, p_reading numeric, p_token_hash text, p_hours numeric default null)
    returns void language plpgsql security definer set search_path = %1$I, public as $b$
    begin
      if p_reading is null and p_hours is null then raise exception 'reading out of range'; end if;
      if p_reading is not null and (p_reading < 0 or p_reading > 9999999) then raise exception 'reading out of range'; end if;
      if p_hours is not null and (p_hours < 0 or p_hours > 9999999) then raise exception 'reading out of range'; end if;
      if p_hours is not null and not exists (
           select 1 from odometer_submissions s join vehicles v on v.id = s.vehicle_id where s.id = p_submission and v.tracks_hours) then
        raise exception 'reading out of range';
      end if;
      update public.odometer_links l set used_at = now()
       where l.token_hash = p_token_hash and l.submission_id = p_submission
         and l.tenant_id = (select t.id from public.tenants t where t.schema_name = current_schema())
         and l.used_at is null and l.revoked_at is null and l.expires_at > now();
      if not found then raise exception 'link is not valid'; end if;
      perform submit_odometer(p_submission, p_reading, null, 'Sent by the driver through a link');
      if p_hours is not null then update odometer_submissions set reading_hours = p_hours where id = p_submission; end if;
    end $b$
  $f$, s);

  execute format('revoke all on function %I.link_submission_info(uuid) from public', s);
  execute format('revoke all on function %I.submit_odometer_via_link(uuid, numeric, text, numeric) from public', s);
  execute format('grant usage on schema %I to odometer_link', s);
  execute format('grant execute on function %I.link_submission_info(uuid), %I.submit_odometer_via_link(uuid, numeric, text, numeric) to odometer_link', s, s);
end $mig$;

-- Approval turns a submission into readings: the odometer one (if km were sent) and the hour one (if hours were sent).
-- Either, if flagged by validation (lower, or too many hours or km a day), needs a note to be accepted.
create or replace function approve_odometer_submission(p_submission uuid, p_reviewer uuid, p_note text default null) returns uuid
language plpgsql as $$
declare s odometer_submissions; rid uuid; rstatus text; hid uuid; hstatus text;
begin
  select * into s from odometer_submissions where id = p_submission for update;
  if s.id is null or s.status <> 'submitted' then raise exception 'submission % is not awaiting review', p_submission; end if;
  if s.reading_km is not null then
    insert into odometer_readings(vehicle_id, reading_km, source, entered_by)
    values (s.vehicle_id, s.reading_km, 'monthly_entry', s.submitted_by)
    returning id, status into rid, rstatus;
    if rstatus = 'flagged' then
      if p_note is null or length(trim(p_note)) < 5 then
        raise exception 'reading is flagged (%): a review note is required to accept it',
          (select flag_reason from odometer_readings where id = rid);
      end if;
      update odometer_readings set status = 'accepted' where id = rid;
    end if;
  end if;
  if s.reading_hours is not null then
    insert into engine_hour_readings(vehicle_id, reading_hours, source, entered_by)
    values (s.vehicle_id, s.reading_hours, 'manual', s.submitted_by)
    returning id, status into hid, hstatus;
    if hstatus = 'flagged' then
      if p_note is null or length(trim(p_note)) < 5 then
        raise exception 'hour reading is flagged (%): a review note is required to accept it',
          (select flag_reason from engine_hour_readings where id = hid);
      end if;
      update engine_hour_readings set status = 'accepted' where id = hid;
    end if;
  end if;
  update odometer_submissions
     set status = 'approved', reviewed_by = p_reviewer, reviewed_at = now(), review_note = p_note, reading_id = rid
   where id = p_submission;
  return rid;
end $$;
