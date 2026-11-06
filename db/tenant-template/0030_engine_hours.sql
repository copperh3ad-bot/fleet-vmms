-- Tenant migration 0030: engine hours for loaders, forklifts and anything else with an hour meter (ADR-048 phase 48b). Idempotent.
-- Mirrors the odometer: every reading lands in one table, is validated, and only accepted readings move vehicles.engine_hours.
-- A vehicle opts in with tracks_hours. Service rules may say "every N hours"; the due view then uses hours the way it uses km.

alter table vehicles add column if not exists tracks_hours boolean not null default false;
alter table vehicles add column if not exists engine_hours numeric(10,1) check (engine_hours is null or engine_hours >= 0);
alter table vehicles add column if not exists engine_hours_updated_at timestamptz;

create table if not exists engine_hour_readings (
  id            uuid primary key default gen_random_uuid(),
  vehicle_id    uuid not null references vehicles(id) on delete cascade,
  reading_hours numeric(10,1) not null check (reading_hours >= 0),
  read_at       timestamptz not null default now(),
  source        text not null check (source in ('manual','job_card','baseline')),
  status        text not null default 'accepted' check (status in ('accepted','flagged','dismissed')),
  flag_reason   text,
  entered_by    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists engine_hour_readings_vehicle_idx on engine_hour_readings(vehicle_id, read_at desc);

-- A lower reading, or more hours than there are in the elapsed time, is held (flagged) instead of silently applied.
create or replace function engine_hours_validate() returns trigger language plpgsql as $$
declare
  prev record;
  days numeric;
begin
  if new.status <> 'accepted' then return new; end if;
  select r.reading_hours, r.read_at into prev
    from engine_hour_readings r
   where r.vehicle_id = new.vehicle_id and r.status = 'accepted' and r.read_at <= new.read_at
   order by r.read_at desc, r.created_at desc
   limit 1;
  if found then
    if new.reading_hours < prev.reading_hours then
      new.status := 'flagged'; new.flag_reason := 'lower_than_previous';
    else
      days := greatest(extract(epoch from (new.read_at - prev.read_at)) / 86400.0, 1);
      if (new.reading_hours - prev.reading_hours) / days > 24 then
        new.status := 'flagged'; new.flag_reason := 'implausible_jump';
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists engine_hour_readings_validate on engine_hour_readings;
create trigger engine_hour_readings_validate before insert on engine_hour_readings
  for each row execute function engine_hours_validate();

create or replace function engine_hours_after_change() returns trigger language plpgsql as $$
begin
  if new.status = 'accepted' or (tg_op = 'UPDATE' and old.status = 'accepted') then
    update vehicles v
       set engine_hours = r.reading_hours, engine_hours_updated_at = r.read_at
      from (select reading_hours, read_at from engine_hour_readings
             where vehicle_id = new.vehicle_id and status = 'accepted'
             order by read_at desc, created_at desc limit 1) r
     where v.id = new.vehicle_id;
  end if;
  return null;
end $$;
drop trigger if exists engine_hour_readings_refresh on engine_hour_readings;
create trigger engine_hour_readings_refresh after insert or update of status on engine_hour_readings
  for each row execute function engine_hours_after_change();

-- A department user records hours only on its own department's vehicles.
drop trigger if exists engine_hour_readings_dept on engine_hour_readings;
create trigger engine_hour_readings_dept before insert or update on engine_hour_readings
  for each row execute function dept_write_guard();

drop trigger if exists engine_hour_readings_audit on engine_hour_readings;
create trigger engine_hour_readings_audit after insert or update or delete on engine_hour_readings
  for each row execute function audit_trigger();

-- A job card may carry the hour meter, like it carries the odometer. The number never lives only on the card.
alter table job_cards add column if not exists engine_hours numeric(10,1) check (engine_hours is null or engine_hours >= 0);
create or replace function job_card_hours_reading() returns trigger language plpgsql as $$
begin
  if new.engine_hours is not null and (tg_op = 'INSERT' or new.engine_hours is distinct from old.engine_hours) then
    insert into engine_hour_readings(vehicle_id, reading_hours, source, entered_by)
    values (new.vehicle_id, new.engine_hours, 'job_card', nullif(current_setting('app.user_id', true), '')::uuid);
  end if;
  return null;
end $$;
drop trigger if exists job_cards_hours on job_cards;
create trigger job_cards_hours after insert or update of engine_hours on job_cards
  for each row execute function job_card_hours_reading();

-- ---------- Service rules in hours ----------
alter table service_types add column if not exists interval_hours numeric(10,1) check (interval_hours > 0);
alter table vehicle_service_baselines add column if not exists last_hours numeric(10,1);

create or replace function settings_guard() returns trigger language plpgsql as $$
begin
  if new.key = 'doc_reminder_days' then
    if new.value !~ '^[0-9]+(,[0-9]+)*$' then raise exception 'doc_reminder_days must look like 60,30,14'; end if;
  elsif new.key = 'module_trips' then
    if new.value not in ('0','1') then raise exception 'module_trips must be 0 or 1'; end if;
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

insert into settings(key, value) values ('pm_warning_hours', '25') on conflict (key) do nothing;

-- Latest completed service per vehicle and service type, now with the hour meter at that time.
create or replace view v_service_last_done as
select v.id as vehicle_id, st.key as service_type_key, last.done_on, last.odometer_km, last.engine_hours
from vehicles v
cross join service_types st
left join lateral (
  select h.done_on, h.odometer_km, h.engine_hours from (
    select b.last_done_on as done_on, b.last_odometer_km as odometer_km, b.last_hours as engine_hours
      from vehicle_service_baselines b
     where b.vehicle_id = v.id and b.service_type_key = st.key
    union all
    select coalesce(wo.completed_at::date, jc.updated_at::date), jc.odometer_km, jc.engine_hours
      from job_cards jc
      join job_card_lines l on l.job_card_id = jc.id and l.service_type_key = st.key
      left join work_orders wo on wo.job_card_id = jc.id
     where jc.vehicle_id = v.id
       and jc.status in ('completed','invoiced','invoice_verified','closed')
  ) h
  order by h.done_on desc
  limit 1
) last on true
where v.status in ('active','in_workshop') and st.active and st.is_preventive
  and (st.applies_to_classes is null or v.vehicle_class = any(st.applies_to_classes));

-- PM status with an hours rule beside the time and distance rules. New columns are at the end.
create or replace view v_pm_status as
with cfg as (
  select coalesce((select value::int  from settings where key = 'pm_warning_days'), 14)  as warn_days,
         coalesce((select value::numeric from settings where key = 'pm_warning_km'), 500) as warn_km,
         coalesce((select value::numeric from settings where key = 'pm_warning_hours'), 25) as warn_hours,
         coalesce((select value::int from settings where key = 'odometer_stale_days'), 45) as stale_days
), base as (
  select ld.vehicle_id, vh.registration_no, vh.odometer_km as current_km, vh.odometer_updated_at,
         vh.engine_hours as current_hours,
         ld.service_type_key, st.label,
         ld.done_on as last_done_on, ld.odometer_km as last_km, ld.engine_hours as last_hours,
         case when ld.done_on is not null and st.interval_months is not null
              then (ld.done_on + st.interval_months * interval '1 month')::date end as due_on,
         case when ld.odometer_km is not null and st.interval_km is not null
              then ld.odometer_km + st.interval_km end as due_km,
         case when vh.tracks_hours and ld.engine_hours is not null and st.interval_hours is not null
              then ld.engine_hours + st.interval_hours end as due_hours,
         exists (
           select 1 from job_cards jc
             join job_card_lines l on l.job_card_id = jc.id and l.service_type_key = ld.service_type_key
            where jc.vehicle_id = ld.vehicle_id
              and jc.status in ('submitted','approved','returned_for_edit','vendor_assigned',
                                'quotation_received','quotation_approved','in_progress')
         ) as has_open_job
    from v_service_last_done ld
    join vehicles vh on vh.id = ld.vehicle_id
    join service_types st on st.key = ld.service_type_key
), calc as (
  select b.*, (b.due_on - current_date) as days_remaining, (b.due_km - b.current_km) as km_remaining,
         (b.due_hours - b.current_hours) as hours_remaining
    from base b
)
select c.vehicle_id, c.registration_no, c.service_type_key, c.label,
       c.last_done_on, c.last_km, c.due_on, c.due_km, c.days_remaining, c.km_remaining, c.has_open_job,
       case
         when c.last_done_on is null then 'no_history'
         when c.has_open_job then 'scheduled'
         when c.days_remaining < 0 or c.km_remaining < 0 or c.hours_remaining < 0 then 'overdue'
         when c.days_remaining <= cfg.warn_days or c.km_remaining <= cfg.warn_km or c.hours_remaining <= cfg.warn_hours then 'due_soon'
         else 'ok'
       end as pm_status,
       (select cu.employee_id from vehicle_custody cu where cu.vehicle_id = c.vehicle_id and cu.to_date is null) as custodian_id,
       (c.due_km is not null
         and (c.odometer_updated_at is null or current_date - c.odometer_updated_at::date > cfg.stale_days)) as km_data_stale,
       c.last_hours, c.due_hours, c.hours_remaining, c.current_hours
  from calc c cross join cfg;
