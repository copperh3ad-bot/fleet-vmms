-- Tenant migration 0041: a department role may see and maintain the whole fleet (ADR-075). Idempotent.
--
-- Migration 0029 made a department role (logistics) see only vehicles whose own department matched, so a vehicle with no department was invisible to it.
-- Owner decision 2026-11-09: Logistics is the fleet-management department and handles the complete fleet, while staying tied to its department (its approval limit,
-- pool cars and dispatch still apply). A department that is NOT meant to see everything (a future Administration role) keeps the old scoping.
-- The choice is a flag on the role's department row, so it is data, not code.

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'role_departments' and column_name = 'sees_all_vehicles') then
    alter table role_departments add column sees_all_vehicles boolean not null default false;
    update role_departments set sees_all_vehicles = true where role_key = 'logistics';           -- only on the first run: a later change by the owner is never undone
  end if;
end $$;

-- True only for a department role that is limited to its own department's vehicles. False for everyone else, including a department role that sees the whole fleet.
create or replace function acting_dept_scoped() returns boolean language sql stable as $$
  select coalesce((select not rd.sees_all_vehicles from role_departments rd where rd.role_key = nullif(current_setting('app.role', true), '')), false)
$$;

create or replace function dept_ok(p_vehicle uuid) returns boolean language sql stable as $$
  select not acting_dept_scoped()
      or exists (select 1 from vehicles v where v.id = p_vehicle and lower(btrim(v.department)) = lower(btrim(acting_department())))
$$;

create or replace function dept_write_guard() returns trigger language plpgsql as $$
declare vid uuid;
begin
  if not acting_dept_scoped() then return new; end if;
  vid := case tg_table_name when 'vehicles' then new.id else (to_jsonb(new)->>'vehicle_id')::uuid end;
  if vid is not null and not dept_ok(vid) then raise exception 'this vehicle belongs to another department'; end if;
  return new;
end $$;

create or replace function dept_vehicle_guard() returns trigger language plpgsql as $$
begin
  if not acting_dept_scoped() then return new; end if;
  if tg_op = 'UPDATE' and not dept_ok(old.id) then raise exception 'this vehicle belongs to another department'; end if;
  if lower(btrim(coalesce(new.department, ''))) <> lower(btrim(acting_department())) then raise exception 'this vehicle belongs to another department'; end if;
  return new;
end $$;

-- Rule B (ADR-074): another approver counts for a vehicle when their role sees the whole fleet, or the vehicle is in their department.
create or replace function admin_may_decide_own(p_permission text, p_vehicle uuid, p_amount numeric) returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('app.role', true), ''), '') = 'tenant_admin'
     and not exists (
       select 1 from public.tenant_memberships m
        where m.tenant_id = (select t.id from public.tenants t where t.schema_name = current_schema())
          and m.status = 'active'
          and m.user_id::text is distinct from nullif(current_setting('app.user_id', true), '')
          and m.role in (select role_key from role_permissions where permission_key = p_permission)
          and (p_vehicle is null
               or not exists (select 1 from role_departments rd where rd.role_key = m.role and not rd.sees_all_vehicles)
               or exists (select 1 from role_departments rd join vehicles v on v.id = p_vehicle
                           where rd.role_key = m.role and lower(btrim(v.department)) = lower(btrim(rd.department))))
          and (p_amount is null
               or not exists (select 1 from role_departments rd where rd.role_key = m.role)
               or coalesce((select nullif(s.value, '') from settings s where s.key = 'dept_approval_limit'), '') = ''
               or coalesce(p_amount, 0) <= (select s.value::numeric from settings s where s.key = 'dept_approval_limit')))
$$;

revoke execute on function acting_dept_scoped() from public;
revoke execute on function admin_may_decide_own(text, uuid, numeric) from public;
