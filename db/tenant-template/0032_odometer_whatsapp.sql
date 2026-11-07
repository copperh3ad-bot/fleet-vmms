-- Tenant migration 0032: the monthly odometer request on WhatsApp, answered by a reply (ADR-050). Idempotent.
-- The app sends each holder a WhatsApp message from its own number; the holder uses Reply and types the reading. The reply is matched to the
-- message it answers (a hash kept here and routed in the control plane), checked against the holder's phone number, and saved as a
-- submission like a link would, for review. Nothing here approves a reading or moves an odometer.

-- The settings guard must know the new keys BEFORE they are inserted.
create or replace function settings_guard() returns trigger language plpgsql as $$
begin
  if new.key = 'doc_reminder_days' then
    if new.value !~ '^[0-9]+(,[0-9]+)*$' then raise exception 'doc_reminder_days must look like 60,30,14'; end if;
  elsif new.key = 'module_trips' then
    if new.value not in ('0','1') then raise exception 'module_trips must be 0 or 1'; end if;
  elsif new.key = 'odometer_whatsapp' then
    if new.value not in ('0','1') then raise exception 'odometer_whatsapp must be 0 or 1'; end if;
  elsif new.key = 'odometer_send_day' then
    if new.value !~ '^[0-9]+$' or new.value::int not between 1 and 28 then raise exception 'odometer_send_day must be a day from 1 to 28'; end if;
  elsif new.key = 'dept_approval_limit' then
    if new.value <> '' and new.value !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'dept_approval_limit must be a number or empty'; end if;
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

insert into settings(key, value) values ('odometer_whatsapp', '0'), ('odometer_send_day', '1') on conflict (key) do nothing;

-- One row per WhatsApp message the app sent about a submission: the hash of "wa:<message id>", never the id itself.
create table if not exists odometer_wa_messages (
  hash          text primary key,
  submission_id uuid not null references odometer_submissions(id) on delete cascade,
  kind          text not null check (kind in ('request', 'reminder')),
  sent_at       timestamptz not null default now()
);
create index if not exists odometer_wa_messages_sub_idx on odometer_wa_messages(submission_id);

do $mig$
declare s text := current_schema();
begin
  -- Files a driver's reply as a submission. The webhook role can run this and nothing else of the tenant. The answer says what happened;
  -- "wrong_sender" and "unknown" are never answered, so a stranger learns nothing.
  execute format($f$
    create or replace function file_odometer_reply(p_hash text, p_from text, p_reading numeric)
    returns table (outcome text, plate text)
    language plpgsql security definer set search_path = %1$I, public as $b$
    declare sub record; holder_digits text;
    begin
      select sb.id as id, sb.status as sstatus, v.registration_no as reg, e.phone as phone, c.status as cstatus into sub
        from odometer_wa_messages w
        join odometer_submissions sb on sb.id = w.submission_id
        join odometer_cycles c on c.id = sb.cycle_id
        join vehicles v on v.id = sb.vehicle_id
        left join employees e on e.id = sb.assigned_to
       where w.hash = p_hash;
      if not found then return query select 'unknown'::text, null::text; return; end if;
      holder_digits := regexp_replace(coalesce(sub.phone, ''), '\D', '', 'g');
      if length(holder_digits) < 7 or right(holder_digits, 10) <> right(regexp_replace(coalesce(p_from, ''), '\D', '', 'g'), 10) then
        return query select 'wrong_sender'::text, null::text; return;
      end if;
      if p_reading is null or p_reading < 0 or p_reading > 9999999 then return query select 'bad_value'::text, sub.reg::text; return; end if;
      if sub.cstatus <> 'open' or sub.sstatus not in ('pending', 'rejected') then return query select 'not_open'::text, sub.reg::text; return; end if;
      perform submit_odometer(sub.id, p_reading, null, 'Sent by the driver on WhatsApp');
      return query select 'ok'::text, sub.reg::text;
    end $b$
  $f$, s);

  execute format('revoke all on function %I.file_odometer_reply(text, text, numeric) from public', s);
  execute format('grant usage on schema %I to inbound_mail', s);
  execute format('grant execute on function %I.file_odometer_reply(text, text, numeric) to inbound_mail', s);
end $mig$;
