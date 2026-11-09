-- Tenant migration 0044 (ADR-078, V1.4 phase A): third-party logistics providers. Idempotent.
-- A vendor has a kind (workshop or logistics). A trip can be sent to several logistics providers for a quote; one quote is awarded and the trip is
-- then approved as outsourced: no vehicle or driver of ours, the provider's own vehicle and driver are recorded as text when known.

alter table vendors add column if not exists kind text not null default 'workshop';
alter table vendors drop constraint if exists vendors_kind_check;
alter table vendors add constraint vendors_kind_check check (kind in ('workshop','logistics'));

alter table trips add column if not exists outsourced_vendor_id uuid references vendors(id);
alter table trips add column if not exists vendor_vehicle_text text;
alter table trips add column if not exists vendor_driver_text text;
alter table trips add column if not exists award_amount numeric(14,2) check (award_amount is null or award_amount > 0);

-- "approved needs a vehicle and a driver" now also holds for an outsourced trip with its provider named instead.
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'trips'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%driver_id IS NOT NULL%' loop
    execute format('alter table trips drop constraint %I', c.conname);
  end loop;
end $$;
alter table trips drop constraint if exists trips_assigned_check;
alter table trips add constraint trips_assigned_check
  check (status not in ('approved','started','completed') or (vehicle_id is not null and driver_id is not null) or outsourced_vendor_id is not null);

-- One row per provider asked about one trip. requested: asked, no answer; quoted: has an amount; declined: said no; awarded: chosen; closed: another was chosen.
create table if not exists trip_quotes (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references trips(id) on delete cascade,
  vendor_id    uuid not null references vendors(id),
  status       text not null default 'requested' check (status in ('requested','quoted','declined','awarded','closed')),
  amount       numeric(14,2) check (amount is null or amount > 0),
  vehicle_text text,
  driver_text  text,
  notes        text,
  valid_until  date,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  quoted_by    uuid,
  quoted_at    timestamptz,
  unique (trip_id, vendor_id),
  check (status <> 'quoted' and status <> 'awarded' or amount is not null)
);
create index if not exists trip_quotes_trip_idx on trip_quotes(trip_id);
drop trigger if exists trip_quotes_audit on trip_quotes;
create trigger trip_quotes_audit after insert or update or delete on trip_quotes for each row execute function audit_trigger();

-- Permission: ask providers for quotes and award one.
insert into permissions(key, description) values ('trip.award', 'Ask logistics providers to quote for a trip and award one quote') on conflict (key) do nothing;
insert into role_permissions(role_key, permission_key) values
  ('fleet_manager','trip.award'), ('tenant_admin','trip.award'), ('logistics','trip.award')
on conflict do nothing;

-- The one function that moves a trip (CLAUDE.md rule 4), now with an optional quote to award. An award is an approval: it needs trip.award
-- (checked by the caller), is refused for the requester (except a sole-employee administrator, ADR-077), and closes the other quotes.
drop function if exists trip_transition(uuid, text, uuid, text, uuid, uuid, numeric);
create or replace function trip_transition(
  p_trip uuid, p_to text, p_actor uuid, p_note text default null,
  p_vehicle uuid default null, p_driver uuid default null, p_odometer numeric default null, p_quote uuid default null
) returns void language plpgsql as $$
declare
  t trips%rowtype;
  v vehicles%rowtype;
  qt trip_quotes%rowtype;
  requester_user uuid;
  vendor_name text;
  event_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into t from trips where id = p_trip for update;
  if not found then raise exception 'trip not found'; end if;
  if not ((t.status = 'requested' and p_to in ('approved','rejected','cancelled'))
       or (t.status = 'approved' and p_to in ('started','cancelled'))
       or (t.status = 'started' and p_to = 'completed')) then
    raise exception 'illegal trip transition % -> %', t.status, p_to;
  end if;

  if p_to = 'approved' and p_quote is not null then
    select user_id into requester_user from employees where id = t.requested_by;
    if requester_user is not null and requester_user = p_actor and not admin_may_decide_own('trip.award') then
      raise exception 'segregation of duties: you cannot award your own trip request';
    end if;
    select * into qt from trip_quotes where id = p_quote and trip_id = p_trip and status = 'quoted';
    if not found then raise exception 'that quote is not available to award'; end if;
    select name into vendor_name from vendors where id = qt.vendor_id;
    update trip_quotes set status = case when id = p_quote then 'awarded' else 'closed' end where trip_id = p_trip and status in ('requested','quoted');
    update trips set outsourced_vendor_id = qt.vendor_id, vendor_vehicle_text = qt.vehicle_text, vendor_driver_text = qt.driver_text, award_amount = qt.amount,
           vehicle_id = null, driver_id = null, decided_by = p_actor, decided_at = now(), decision_note = event_note, status = 'approved', updated_at = now() where id = p_trip;
    event_note := 'Awarded to ' || vendor_name || ' at ' || to_char(qt.amount, 'FM999G999G999G990D00') || coalesce('. ' || event_note, '');
  elsif p_to = 'approved' then
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
    update trip_quotes set status = 'closed' where trip_id = p_trip and status in ('requested','quoted');
  elsif p_to = 'started' then
    if t.outsourced_vendor_id is null then
      if p_odometer is null then raise exception 'enter the odometer reading at departure'; end if;
      update trips set status = 'started', odometer_out = p_odometer, started_at = now(), updated_at = now() where id = p_trip;
      insert into odometer_readings(vehicle_id, reading_km, source, entered_by) values (t.vehicle_id, p_odometer, 'trip', p_actor);
    else
      update trips set status = 'started', started_at = now(), updated_at = now() where id = p_trip;       -- the provider's vehicle: no odometer of ours
    end if;
  elsif p_to = 'completed' then
    if t.outsourced_vendor_id is null then
      if p_odometer is null then raise exception 'enter the odometer reading on return'; end if;
      if p_odometer < t.odometer_out then raise exception 'the return reading is below the departure reading'; end if;
      update trips set status = 'completed', odometer_in = p_odometer, completed_at = now(), updated_at = now() where id = p_trip;
      insert into odometer_readings(vehicle_id, reading_km, source, entered_by) values (t.vehicle_id, p_odometer, 'trip', p_actor);
    else
      update trips set status = 'completed', completed_at = now(), updated_at = now() where id = p_trip;
    end if;
  end if;

  insert into trip_events(trip_id, from_status, to_status, actor_id, note) values (p_trip, t.status, p_to, p_actor, event_note);
end $$;

revoke execute on function trip_transition(uuid, text, uuid, text, uuid, uuid, numeric, uuid) from public;
