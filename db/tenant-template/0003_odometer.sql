-- Tenant migration 0003: odometer readings. Idempotent.
-- Two ways in, both optional and combinable per vehicle:
--   A) 3rd-party tracker, synced automatically by a server-side worker.
--   B) Monthly collection: admin opens a cycle, gets each driver's reading, reviews and approves.
-- Every reading lands in one append-style table, is validated, and only accepted readings move vehicles.odometer_km.
-- vehicles.odometer_km must be written only through this path.

alter table vehicles add column if not exists odometer_updated_at timestamptz;

insert into settings(key, value) values ('odometer_max_km_per_day', '800'), ('odometer_stale_days', '45')
on conflict (key) do nothing;

create table if not exists odometer_readings (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references vehicles(id) on delete cascade,
  reading_km  numeric(12,1) not null check (reading_km >= 0),
  read_at     timestamptz not null default now(),
  source      text not null check (source in ('tracker','monthly_entry','job_card','manual','baseline')),
  status      text not null default 'accepted' check (status in ('accepted','flagged','dismissed')),
  flag_reason text,
  entered_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists odometer_readings_vehicle_idx on odometer_readings(vehicle_id, read_at desc);
create index if not exists odometer_readings_flagged_idx on odometer_readings(vehicle_id) where status = 'flagged';

-- Validate on the way in: a lower reading, or an impossible jump, is flagged instead of silently applied.
create or replace function odometer_validate() returns trigger language plpgsql as $$
declare
  prev record;
  days numeric;
  max_per_day numeric;
begin
  if new.status <> 'accepted' then return new; end if;
  select r.reading_km, r.read_at into prev
    from odometer_readings r
   where r.vehicle_id = new.vehicle_id and r.status = 'accepted' and r.read_at <= new.read_at
   order by r.read_at desc, r.created_at desc
   limit 1;
  if found then
    if new.reading_km < prev.reading_km then
      new.status := 'flagged'; new.flag_reason := 'lower_than_previous';
    else
      days := greatest(extract(epoch from (new.read_at - prev.read_at)) / 86400.0, 1);
      max_per_day := coalesce((select value::numeric from settings where key = 'odometer_max_km_per_day'), 800);
      if (new.reading_km - prev.reading_km) / days > max_per_day then
        new.status := 'flagged'; new.flag_reason := 'implausible_jump';
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists odometer_readings_validate on odometer_readings;
create trigger odometer_readings_validate before insert on odometer_readings
  for each row execute function odometer_validate();

create or replace function refresh_vehicle_odometer(p_vehicle uuid) returns void language plpgsql as $$
begin
  update vehicles v
     set odometer_km = r.reading_km, odometer_updated_at = r.read_at
    from (select reading_km, read_at from odometer_readings
           where vehicle_id = p_vehicle and status = 'accepted'
           order by read_at desc, created_at desc limit 1) r
   where v.id = p_vehicle;
end $$;

create or replace function odometer_after_change() returns trigger language plpgsql as $$
begin
  if new.status = 'accepted' or (tg_op = 'UPDATE' and old.status = 'accepted') then
    perform refresh_vehicle_odometer(new.vehicle_id);
  end if;
  return null;
end $$;
drop trigger if exists odometer_readings_refresh on odometer_readings;
create trigger odometer_readings_refresh after insert or update of status on odometer_readings
  for each row execute function odometer_after_change();

-- Every job card that records an odometer also records a reading, so the number never lives only on the card.
create or replace function job_card_odometer_reading() returns trigger language plpgsql as $$
begin
  if new.odometer_km is not null and (tg_op = 'INSERT' or new.odometer_km is distinct from old.odometer_km) then
    insert into odometer_readings(vehicle_id, reading_km, source, entered_by)
    values (new.vehicle_id, new.odometer_km, 'job_card', nullif(current_setting('app.user_id', true), '')::uuid);
  end if;
  return null;
end $$;
drop trigger if exists job_cards_odometer on job_cards;
create trigger job_cards_odometer after insert or update of odometer_km on job_cards
  for each row execute function job_card_odometer_reading();

-- ---------- Option A: 3rd-party tracker ----------
-- Provider-agnostic. A server-side worker per provider does the fetching and inserts readings with source = 'tracker'.
-- secret_ref names a server-side secret (env or vault). Credentials are never stored in this table.
create table if not exists tracker_integrations (
  provider            text primary key,
  enabled             boolean not null default false,
  sync_interval_hours int not null default 24 check (sync_interval_hours > 0),
  secret_ref          text,
  last_run_at         timestamptz,
  last_run_status     text
);

create table if not exists vehicle_trackers (
  vehicle_id         uuid primary key references vehicles(id) on delete cascade,
  provider           text not null references tracker_integrations(provider),
  device_ref         text not null,
  odometer_offset_km numeric(12,1) not null default 0,  -- tracker total distance usually differs from the dashboard odometer; worker adds this
  active             boolean not null default true,
  linked_at          timestamptz not null default now(),
  last_sync_at       timestamptz,
  last_sync_status   text,
  last_error         text,
  unique (provider, device_ref)
);

-- ---------- Option B: monthly collection ----------
create table if not exists odometer_cycles (
  id        uuid primary key default gen_random_uuid(),
  period    date not null unique check (period = date_trunc('month', period)::date),
  due_on    date not null,
  status    text not null default 'open' check (status in ('open','closed')),
  opened_by uuid,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists odometer_submissions (
  id           uuid primary key default gen_random_uuid(),
  cycle_id     uuid not null references odometer_cycles(id) on delete cascade,
  vehicle_id   uuid not null references vehicles(id),
  assigned_to  uuid references employees(id),   -- current custodian when the cycle opened
  reading_km   numeric(12,1) check (reading_km >= 0),
  note         text,
  status       text not null default 'pending' check (status in ('pending','submitted','approved','rejected')),
  submitted_by uuid,                            -- driver, or the admin entering it on the driver's behalf
  submitted_at timestamptz,
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  review_note  text,
  reading_id   uuid references odometer_readings(id),
  unique (cycle_id, vehicle_id)
);
create index if not exists odometer_submissions_status_idx on odometer_submissions(cycle_id, status);

-- Photos of the dashboard are the evidence for a monthly reading.
do $$
begin
  alter table attachments drop constraint if exists attachments_entity_type_check;
  alter table attachments add constraint attachments_entity_type_check check (entity_type in
    ('job_card','quotation','invoice','accident','challan','compliance_doc','insurance_policy','odometer_submission'));
end $$;

-- Opens a cycle with one pending row per vehicle. Vehicles with a tracker that synced in the last 7 days are skipped.
create or replace function open_odometer_cycle(p_period date, p_due date, p_user uuid default null) returns uuid
language plpgsql as $$
declare cid uuid;
begin
  insert into odometer_cycles(period, due_on, opened_by)
  values (date_trunc('month', p_period)::date, p_due, p_user) returning id into cid;
  insert into odometer_submissions(cycle_id, vehicle_id, assigned_to)
  select cid, v.id, cu.employee_id
    from vehicles v
    left join vehicle_custody cu on cu.vehicle_id = v.id and cu.to_date is null
   where v.status in ('active','in_workshop')
     and not exists (select 1 from vehicle_trackers t
                      where t.vehicle_id = v.id and t.active and t.last_sync_at > now() - interval '7 days');
  return cid;
end $$;

create or replace function submit_odometer(p_submission uuid, p_reading numeric, p_user uuid, p_note text default null) returns void
language plpgsql as $$
begin
  update odometer_submissions s
     set reading_km = p_reading, note = p_note, status = 'submitted', submitted_by = p_user, submitted_at = now()
   where s.id = p_submission and s.status in ('pending','rejected')
     and exists (select 1 from odometer_cycles c where c.id = s.cycle_id and c.status = 'open');
  if not found then raise exception 'submission % is not open for input', p_submission; end if;
end $$;

-- Approval creates the reading. If validation flagged it (lower or implausible), approving needs an explicit note.
create or replace function approve_odometer_submission(p_submission uuid, p_reviewer uuid, p_note text default null) returns uuid
language plpgsql as $$
declare s odometer_submissions; rid uuid; rstatus text;
begin
  select * into s from odometer_submissions where id = p_submission for update;
  if s.id is null or s.status <> 'submitted' then raise exception 'submission % is not awaiting review', p_submission; end if;
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
  update odometer_submissions
     set status = 'approved', reviewed_by = p_reviewer, reviewed_at = now(), review_note = p_note, reading_id = rid
   where id = p_submission;
  return rid;
end $$;

create or replace function reject_odometer_submission(p_submission uuid, p_reviewer uuid, p_note text) returns void
language plpgsql as $$
begin
  if p_note is null or length(trim(p_note)) < 5 then raise exception 'a rejection note is required'; end if;
  update odometer_submissions
     set status = 'rejected', reviewed_by = p_reviewer, reviewed_at = now(), review_note = p_note
   where id = p_submission and status = 'submitted';
  if not found then raise exception 'submission % is not awaiting review', p_submission; end if;
end $$;

-- ---------- Seed, permissions, audit ----------
insert into permissions(key, description) values
  ('odometer.submit', 'Enter an odometer reading'),
  ('odometer.review', 'Open monthly cycles, approve or reject readings'),
  ('tracker.manage',  'Link vehicles to a 3rd-party tracker')
on conflict (key) do nothing;
insert into role_permissions(role_key, permission_key) values
  ('requester','odometer.submit'), ('fleet_manager','odometer.submit'),
  ('fleet_manager','odometer.review'), ('tenant_admin','odometer.review'),
  ('tenant_admin','tracker.manage')
on conflict do nothing;

do $$
declare t text;
begin
  foreach t in array array['odometer_readings','odometer_cycles','odometer_submissions','vehicle_trackers','tracker_integrations'] loop
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- ---------- Views ----------
create or replace view v_odometer_status as
select v.id as vehicle_id, v.registration_no, v.odometer_km, v.odometer_updated_at,
       case when v.odometer_updated_at is null then null else current_date - v.odometer_updated_at::date end as days_since_reading,
       (select r.source from odometer_readings r
         where r.vehicle_id = v.id and r.status = 'accepted'
         order by r.read_at desc, r.created_at desc limit 1) as last_source,
       (t.vehicle_id is not null and t.active) as tracker_linked,
       t.last_sync_at,
       (select count(*)::int from odometer_readings r where r.vehicle_id = v.id and r.status = 'flagged') as flagged_readings,
       case when v.odometer_updated_at is null then 'never'
            when current_date - v.odometer_updated_at::date > c.stale_days then 'stale'
            else 'fresh' end as freshness
  from vehicles v
  left join vehicle_trackers t on t.vehicle_id = v.id
  cross join (select coalesce((select value::int from settings where key = 'odometer_stale_days'), 45) as stale_days) c
 where v.status in ('active','in_workshop');

-- PM status again, with one added column: is the distance rule running on an old odometer?
create or replace view v_pm_status as
with cfg as (
  select coalesce((select value::int  from settings where key = 'pm_warning_days'), 14)  as warn_days,
         coalesce((select value::numeric from settings where key = 'pm_warning_km'), 500) as warn_km,
         coalesce((select value::int from settings where key = 'odometer_stale_days'), 45) as stale_days
), base as (
  select ld.vehicle_id, vh.registration_no, vh.odometer_km as current_km, vh.odometer_updated_at,
         ld.service_type_key, st.label,
         ld.done_on as last_done_on, ld.odometer_km as last_km,
         case when ld.done_on is not null and st.interval_months is not null
              then (ld.done_on + st.interval_months * interval '1 month')::date end as due_on,
         case when ld.odometer_km is not null and st.interval_km is not null
              then ld.odometer_km + st.interval_km end as due_km,
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
  select b.*, (b.due_on - current_date) as days_remaining, (b.due_km - b.current_km) as km_remaining
    from base b
)
select c.vehicle_id, c.registration_no, c.service_type_key, c.label,
       c.last_done_on, c.last_km, c.due_on, c.due_km, c.days_remaining, c.km_remaining, c.has_open_job,
       case
         when c.last_done_on is null then 'no_history'
         when c.has_open_job then 'scheduled'
         when c.days_remaining < 0 or c.km_remaining < 0 then 'overdue'
         when c.days_remaining <= cfg.warn_days or c.km_remaining <= cfg.warn_km then 'due_soon'
         else 'ok'
       end as pm_status,
       (select cu.employee_id from vehicle_custody cu where cu.vehicle_id = c.vehicle_id and cu.to_date is null) as custodian_id,
       (c.due_km is not null
         and (c.odometer_updated_at is null or current_date - c.odometer_updated_at::date > cfg.stale_days)) as km_data_stale
  from calc c cross join cfg;
