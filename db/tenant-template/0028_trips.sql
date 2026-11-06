-- Tenant migration 0028 (ADR-045 phase 5a): trip requests and their approval. Idempotent.
-- The module is off until an administrator sets settings.module_trips to 1. Gate passes follow in 0029.

-- ---------- Odometer readings may come from a trip ----------
alter table odometer_readings drop constraint if exists odometer_readings_source_check;
alter table odometer_readings add constraint odometer_readings_source_check
  check (source in ('tracker','monthly_entry','job_card','manual','baseline','trip'));

-- ---------- Pool cars ----------
-- A pool car is one the logistics team runs for staff pick and drop. Pick and drop trips can only be given a pool car.
alter table vehicles add column if not exists is_pool boolean not null default false;

-- ---------- Trips ----------
create sequence if not exists trip_seq;
create table if not exists trips (
  id                   uuid primary key default gen_random_uuid(),
  trip_no              text not null unique default ('TR-' || lpad(nextval('trip_seq')::text, 6, '0')),
  requested_by         uuid not null references employees(id),
  kind                 text not null default 'trip' check (kind in ('trip','pick_drop')),   -- pick_drop: staff pick and drop by a pool car
  stops                text,                                                              -- other pick-up or drop-off points, in order
  purpose             text not null check (length(trim(purpose)) >= 3),
  from_place           text not null,
  to_place             text not null,
  start_at             timestamptz not null,
  end_at               timestamptz not null,
  passengers           int check (passengers is null or passengers >= 0),
  preferred_vehicle_id uuid references vehicles(id),
  vehicle_id           uuid references vehicles(id),
  driver_id            uuid references employees(id),
  status               text not null default 'requested' check (status in ('requested','approved','rejected','cancelled','started','completed')),
  decided_by           uuid,
  decided_at           timestamptz,
  decision_note        text,
  odometer_out         numeric(12,1) check (odometer_out is null or odometer_out >= 0),
  odometer_in          numeric(12,1) check (odometer_in is null or odometer_in >= 0),
  started_at           timestamptz,
  completed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (end_at > start_at),
  check (odometer_in is null or odometer_out is null or odometer_in >= odometer_out),
  check (status not in ('approved','started','completed') or (vehicle_id is not null and driver_id is not null))
);
create index if not exists trips_status_idx on trips(status, start_at);
create index if not exists trips_vehicle_idx on trips(vehicle_id, start_at);
create index if not exists trips_requester_idx on trips(requested_by);
create index if not exists trips_driver_idx on trips(driver_id);

-- Append-only history: who moved a trip from where to where, and why.
create table if not exists trip_events (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references trips(id) on delete cascade,
  from_status text,
  to_status   text not null,
  actor_id    uuid,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists trip_events_trip_idx on trip_events(trip_id, created_at);

drop trigger if exists trips_audit on trips;
create trigger trips_audit after insert or update or delete on trips
  for each row execute function audit_trigger();

-- Two live trips may not overlap on one vehicle or one driver. Checked by the database so a race between two approvals cannot slip
-- past the page: the check runs under a lock taken per vehicle (and per driver), so the second approval sees the first.
create or replace function trip_overlap_guard() returns trigger language plpgsql as $$
begin
  if new.status not in ('approved','started') then return new; end if;
  if new.vehicle_id is not null then
    perform pg_advisory_xact_lock(hashtext('trip:vehicle:' || new.vehicle_id::text));
    if exists (select 1 from trips t where t.id <> new.id and t.vehicle_id = new.vehicle_id and t.status in ('approved','started')
                 and tstzrange(t.start_at, t.end_at) && tstzrange(new.start_at, new.end_at)) then
      raise exception 'that vehicle is already booked for part of this time';
    end if;
  end if;
  if new.driver_id is not null then
    perform pg_advisory_xact_lock(hashtext('trip:driver:' || new.driver_id::text));
    if exists (select 1 from trips t where t.id <> new.id and t.driver_id = new.driver_id and t.status in ('approved','started')
                 and tstzrange(t.start_at, t.end_at) && tstzrange(new.start_at, new.end_at)) then
      raise exception 'that driver is already on another trip for part of this time';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trips_overlap on trips;
create trigger trips_overlap before insert or update on trips for each row execute function trip_overlap_guard();

-- Every status change goes through this one function (CLAUDE.md rule 4) and writes a trip_events row. The page never updates trips.status.
create or replace function trip_transition(
  p_trip uuid, p_to text, p_actor uuid, p_note text default null,
  p_vehicle uuid default null, p_driver uuid default null, p_odometer numeric default null
) returns void language plpgsql as $$
declare
  t trips%rowtype;
  v vehicles%rowtype;
  requester_user uuid;
begin
  select * into t from trips where id = p_trip for update;
  if not found then raise exception 'trip not found'; end if;
  if not ((t.status = 'requested' and p_to in ('approved','rejected','cancelled'))
       or (t.status = 'approved' and p_to in ('started','cancelled'))
       or (t.status = 'started' and p_to = 'completed')) then
    raise exception 'illegal trip transition % -> %', t.status, p_to;
  end if;

  if p_to = 'approved' then
    select user_id into requester_user from employees where id = t.requested_by;
    if requester_user is not null and requester_user = p_actor then raise exception 'segregation of duties: you cannot approve your own trip request'; end if;
    p_vehicle := coalesce(p_vehicle, t.preferred_vehicle_id);
    if p_vehicle is null then raise exception 'choose a vehicle for this trip'; end if;
    if p_driver is null then raise exception 'choose a driver for this trip'; end if;
    select * into v from vehicles where id = p_vehicle;
    if not found then raise exception 'vehicle not found'; end if;
    if v.status <> 'active' then raise exception 'that vehicle is not available (it is %)', replace(v.status, '_', ' '); end if;
    if t.kind = 'pick_drop' and not v.is_pool then raise exception 'pick and drop runs use a pool car'; end if;
    if not exists (select 1 from employees where id = p_driver and active) then raise exception 'the driver must be an active employee'; end if;
    update trips set vehicle_id = p_vehicle, driver_id = p_driver, decided_by = p_actor, decided_at = now(), decision_note = nullif(trim(p_note), ''), status = 'approved', updated_at = now() where id = p_trip;
  elsif p_to in ('rejected','cancelled') then
    if p_note is null or length(trim(p_note)) < 5 then raise exception 'a reason of at least 5 characters is required'; end if;
    update trips set status = p_to, decided_by = case when p_to = 'rejected' then p_actor else decided_by end,
           decided_at = case when p_to = 'rejected' then now() else decided_at end, decision_note = trim(p_note), updated_at = now() where id = p_trip;
  elsif p_to = 'started' then
    if p_odometer is null then raise exception 'enter the odometer reading at departure'; end if;
    update trips set status = 'started', odometer_out = p_odometer, started_at = now(), updated_at = now() where id = p_trip;
    insert into odometer_readings(vehicle_id, reading_km, source, entered_by) values (t.vehicle_id, p_odometer, 'trip', p_actor);
  elsif p_to = 'completed' then
    if p_odometer is null then raise exception 'enter the odometer reading on return'; end if;
    if p_odometer < t.odometer_out then raise exception 'the return reading is below the departure reading'; end if;
    update trips set status = 'completed', odometer_in = p_odometer, completed_at = now(), updated_at = now() where id = p_trip;
    insert into odometer_readings(vehicle_id, reading_km, source, entered_by) values (t.vehicle_id, p_odometer, 'trip', p_actor);
  end if;

  insert into trip_events(trip_id, from_status, to_status, actor_id, note) values (p_trip, t.status, p_to, p_actor, nullif(trim(coalesce(p_note, '')), ''));
end $$;

-- ---------- Settings: the module switch ----------
-- The guard first (it refuses keys it does not know), then the starting value.
create or replace function settings_guard() returns trigger language plpgsql as $$
begin
  if new.key = 'doc_reminder_days' then
    if new.value !~ '^[0-9]+(,[0-9]+)*$' then raise exception 'doc_reminder_days must look like 60,30,14'; end if;
  elsif new.key = 'module_trips' then
    if new.value not in ('0','1') then raise exception 'module_trips must be 0 or 1'; end if;
  elsif new.key in ('pm_warning_days','pm_warning_km','odometer_max_km_per_day','odometer_stale_days','odometer_due_day',
                    'budget_warn_pct','budget_flag_pct','flag_jobs_90d','flag_repeat_days','flag_cost_multiple',
                    'policy_replace_years','policy_free_accidents','policy_accident_gap_months','policy_driver_share_pct') then
    if new.value !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'setting % must be a number', new.key; end if;
    if new.key = 'policy_driver_share_pct' and new.value::numeric > 100 then raise exception 'policy_driver_share_pct cannot be above 100'; end if;
  else
    raise exception 'unknown setting %', new.key;
  end if;
  return new;
end $$;
insert into settings(key, value) values ('module_trips', '0') on conflict (key) do nothing;

-- ---------- Permissions and the gate security role ----------
insert into roles(key, name, is_external) values ('security', 'Gate security', false), ('logistics', 'Logistics', false) on conflict (key) do nothing;
insert into permissions(key, description) values
  ('trip.dispatch','Assign pool cars and drivers to staff pick and drop requests'),
  ('trip.request','Ask for a vehicle for a trip'),('trip.approve','Approve or reject trip requests and assign a vehicle and driver'),
  ('trip.read_all','See every trip, not only your own'),('gate.use','Mark vehicles out and returned at the gate')
on conflict (key) do nothing;
insert into role_permissions(role_key, permission_key)
select r, p from (values
  ('requester','trip.request'),
  ('fleet_manager','trip.request'),('fleet_manager','trip.approve'),('fleet_manager','trip.read_all'),
  ('tenant_admin','trip.request'),('tenant_admin','trip.approve'),('tenant_admin','trip.read_all'),('tenant_admin','gate.use'),
  ('fleet_manager','trip.dispatch'),('tenant_admin','trip.dispatch'),
  ('auditor','trip.read_all'),
  ('logistics','trip.request'),('logistics','trip.dispatch'),('logistics','vehicle.read'),
  ('security','gate.use'),('security','vehicle.read')
) as x(r, p)
on conflict do nothing;
