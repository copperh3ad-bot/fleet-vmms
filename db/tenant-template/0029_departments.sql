-- Tenant migration 0029 (ADR-048, phase 48a): operating departments. Idempotent.
-- A vehicle may belong to a department. A role may be tied to a department; a person with such a role sees and changes only that
-- department's vehicles. The rule is dept_ok(); read paths call it in their where clause and the guards below refuse writes.

alter table vehicles add column if not exists department text;
create index if not exists vehicles_department_idx on vehicles(lower(btrim(department)));

create table if not exists role_departments (
  role_key   text primary key references roles(key) on delete cascade,
  department text not null check (length(btrim(department)) > 0)
);
insert into role_departments(role_key, department) values ('logistics', 'Logistics') on conflict (role_key) do nothing;
drop trigger if exists role_departments_audit on role_departments;
create trigger role_departments_audit after insert or update or delete on role_departments
  for each row execute function audit_trigger();

-- The department of the role acting right now (null for every role with none, and for system work with no role).
create or replace function acting_department() returns text language sql stable as $$
  select rd.department from role_departments rd where rd.role_key = nullif(current_setting('app.role', true), '')
$$;

-- True for everyone with no department, and for a department user only when the vehicle is in their department.
create or replace function dept_ok(p_vehicle uuid) returns boolean language sql stable as $$
  select acting_department() is null
      or exists (select 1 from vehicles v where v.id = p_vehicle and lower(btrim(v.department)) = lower(btrim(acting_department())))
$$;

-- ---------- Writes: a department user cannot change another department's vehicle, its job cards, custody or trips ----------
create or replace function dept_write_guard() returns trigger language plpgsql as $$
declare vid uuid;
begin
  if acting_department() is null then return new; end if;
  vid := case tg_table_name when 'vehicles' then new.id else (to_jsonb(new)->>'vehicle_id')::uuid end;
  if vid is not null and not dept_ok(vid) then raise exception 'this vehicle belongs to another department'; end if;
  return new;
end $$;
drop trigger if exists job_cards_dept on job_cards;
create trigger job_cards_dept before insert or update on job_cards for each row execute function dept_write_guard();
drop trigger if exists vehicle_custody_dept on vehicle_custody;
create trigger vehicle_custody_dept before insert or update on vehicle_custody for each row execute function dept_write_guard();
drop trigger if exists trips_dept on trips;
create trigger trips_dept before insert or update on trips for each row execute function dept_write_guard();
-- A department user changes a vehicle only while it is theirs, and may not move it out of their department.
create or replace function dept_vehicle_guard() returns trigger language plpgsql as $$
begin
  if acting_department() is null then return new; end if;
  if tg_op = 'UPDATE' and not dept_ok(old.id) then raise exception 'this vehicle belongs to another department'; end if;
  if lower(btrim(coalesce(new.department, ''))) <> lower(btrim(acting_department())) then raise exception 'this vehicle belongs to another department'; end if;
  return new;
end $$;
drop trigger if exists vehicles_dept on vehicles;
create trigger vehicles_dept before insert or update on vehicles for each row execute function dept_vehicle_guard();

-- ---------- Pool cars are logistics vehicles only (ADR-048) ----------
create or replace function pool_car_guard() returns trigger language plpgsql as $$
declare ld text := (select department from role_departments where role_key = 'logistics');
begin
  if not new.is_pool then return new; end if;
  if ld is null or lower(btrim(coalesce(new.department, ''))) <> lower(btrim(ld)) then
    raise exception 'pool cars belong to the % department', coalesce(ld, 'logistics');
  end if;
  if exists (select 1 from vehicle_custody c join employees e on e.id = c.employee_id
              where c.vehicle_id = new.id and c.to_date is null and lower(btrim(coalesce(e.department, ''))) <> lower(btrim(ld))) then
    raise exception 'this car is held by someone outside the % department, so it cannot be a pool car', ld;
  end if;
  return new;
end $$;
drop trigger if exists vehicles_pool on vehicles;
create trigger vehicles_pool before insert or update of is_pool, department on vehicles for each row execute function pool_car_guard();

create or replace function pool_custody_guard() returns trigger language plpgsql as $$
declare ld text := (select department from role_departments where role_key = 'logistics');
begin
  if new.to_date is null and exists (select 1 from vehicles v where v.id = new.vehicle_id and v.is_pool)
     and not exists (select 1 from employees e where e.id = new.employee_id and lower(btrim(coalesce(e.department, ''))) = lower(btrim(coalesce(ld, '')))) then
    raise exception 'a pool car can only be held by someone in the % department; take it out of the pool first', coalesce(ld, 'logistics');
  end if;
  return new;
end $$;
drop trigger if exists vehicle_custody_pool on vehicle_custody;
create trigger vehicle_custody_pool before insert or update on vehicle_custody for each row execute function pool_custody_guard();

-- ---------- Spending limit on a department user's approvals ----------
-- A blank value means no limit; 0 means a department user approves nothing. Fleet managers and administrators are never limited.
create or replace function settings_guard() returns trigger language plpgsql as $$
begin
  if new.key = 'doc_reminder_days' then
    if new.value !~ '^[0-9]+(,[0-9]+)*$' then raise exception 'doc_reminder_days must look like 60,30,14'; end if;
  elsif new.key = 'module_trips' then
    if new.value not in ('0','1') then raise exception 'module_trips must be 0 or 1'; end if;
  elsif new.key = 'dept_approval_limit' then
    if new.value <> '' and new.value !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'dept_approval_limit must be a number or empty'; end if;
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
insert into settings(key, value) values ('dept_approval_limit', '') on conflict (key) do nothing;

create or replace function dept_over_limit(p_amount numeric) returns boolean language plpgsql stable as $$
declare lim text;
begin
  if acting_department() is null then return false; end if;
  select value into lim from settings where key = 'dept_approval_limit';
  if lim is null or lim = '' then return false; end if;
  return coalesce(p_amount, 0) > lim::numeric;
end $$;

create or replace function job_card_limit_guard() returns trigger language plpgsql as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and dept_over_limit(new.estimated_cost) then
    raise exception 'this is over the approval limit for your department, so a fleet manager must approve it';
  end if;
  return new;
end $$;
drop trigger if exists job_cards_limit on job_cards;
create trigger job_cards_limit before update on job_cards for each row execute function job_card_limit_guard();

create or replace function quotation_limit_guard() returns trigger language plpgsql as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and dept_over_limit(new.amount) then
    raise exception 'this is over the approval limit for your department, so a fleet manager must approve it';
  end if;
  return new;
end $$;
drop trigger if exists quotations_limit on quotations;
create trigger quotations_limit before update on quotations for each row execute function quotation_limit_guard();

-- ---------- What logistics may do (the role itself exists since 0028) ----------
insert into role_permissions(role_key, permission_key) values
  ('logistics','jobcard.create'),('logistics','jobcard.read_all'),('logistics','jobcard.approve'),('logistics','jobcard.assign_vendor'),
  ('logistics','quotation.approve')
on conflict do nothing;
