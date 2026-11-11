-- Tenant migration 0055: owner decision D2 of 2026-11-11 (docs/OWNER-DECISIONS-2026-11-11.md). Idempotent.
-- A vehicle carries seats and load capacity (kg), beside its class (vehicle_class) and location (base_location) that exist already.
-- Fuel type is not part of this decision.
alter table vehicles add column if not exists seats int check (seats is null or (seats between 1 and 200));
alter table vehicles add column if not exists load_capacity_kg numeric(12,1) check (load_capacity_kg is null or load_capacity_kg >= 0);

-- The one save for the Add a vehicle screen now also takes seats and load capacity.
create or replace function onboard_vehicle(p jsonb, p_user uuid default null) returns uuid
language plpgsql as $$
declare vid uuid; b jsonb; d jsonb; ins jsonb;
begin
  insert into vehicles(registration_no, make, model, year, fuel_type, vin, engine_no, colour, base_location, vehicle_class, seats, load_capacity_kg)
  values (upper(trim(p->>'registration_no')), p->>'make', p->>'model', (p->>'year')::int, p->>'fuel_type', p->>'vin',
          p->>'engine_no', p->>'colour', p->>'base_location', p->>'vehicle_class', (p->>'seats')::int, (p->>'load_capacity_kg')::numeric)
  returning id into vid;

  if p->>'odometer_km' is not null then
    insert into odometer_readings(vehicle_id, reading_km, source, entered_by)
    values (vid, (p->>'odometer_km')::numeric, 'baseline', p_user);
  end if;

  if p->>'employee_id' is not null then
    insert into vehicle_custody(vehicle_id, employee_id, from_date)
    values (vid, (p->>'employee_id')::uuid, coalesce((p->>'holding_since')::date, current_date));
  end if;

  for b in select * from jsonb_array_elements(coalesce(p->'baselines', '[]'::jsonb)) loop
    insert into vehicle_service_baselines(vehicle_id, service_type_key, last_done_on, last_odometer_km)
    values (vid, b->>'service_type_key', (b->>'last_done_on')::date, (b->>'last_odometer_km')::numeric);
  end loop;

  ins := p->'insurance';
  if ins is not null and ins <> 'null'::jsonb then
    insert into insurance_policies(vehicle_id, insurer, policy_no, valid_from, valid_to, premium)
    values (vid, ins->>'insurer', ins->>'policy_no', (ins->>'valid_from')::date, (ins->>'valid_to')::date, (ins->>'premium')::numeric);
  end if;

  for d in select * from jsonb_array_elements(coalesce(p->'documents', '[]'::jsonb)) loop
    insert into compliance_docs(vehicle_id, doc_type, reference, expires_on, issued_by)
    values (vid, d->>'doc_type', d->>'reference', (d->>'expires_on')::date, d->>'issued_by');
  end loop;

  if p->>'budget_amount' is not null then
    insert into budgets(vehicle_id, period_start, period_end, amount, created_by, reason)
    values (vid, (p->>'budget_from')::date, (p->>'budget_to')::date, (p->>'budget_amount')::numeric, p_user, 'initial budget');
  end if;
  return vid;
end $$;
