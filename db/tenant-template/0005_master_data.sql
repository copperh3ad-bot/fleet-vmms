-- Master data screens (vehicles, employees, vendors, custody). Idempotent.

-- ---------- Permissions ----------
insert into permissions(key, description) values
  ('employee.manage', 'Add and edit employees'),
  ('vendor.manage',   'Add, edit and block vendors')
on conflict (key) do nothing;
insert into role_permissions(role_key, permission_key) values
  ('tenant_admin','employee.manage'), ('tenant_admin','vendor.manage'),
  ('fleet_manager','employee.manage'), ('fleet_manager','vendor.manage')
on conflict do nothing;

-- ---------- Duplicates ----------
-- Same employee number, or the same vendor name in different case, is the same record.
create unique index if not exists employees_no_uq on employees (lower(employee_no)) where employee_no is not null;
create unique index if not exists vendors_name_uq on vendors (lower(trim(name)));

-- ---------- Custody change ----------
-- Closes the current holder's row and opens the new one, in one step. Old holders stay in the history.
create or replace function change_custody(p_vehicle uuid, p_employee uuid, p_from date default current_date) returns uuid
language plpgsql as $$
declare cur record; new_id uuid;
begin
  if not exists (select 1 from employees where id = p_employee and active) then
    raise exception 'employee is not active' using errcode = '22023';
  end if;
  select * into cur from vehicle_custody where vehicle_id = p_vehicle and to_date is null for update;
  if found then
    if cur.employee_id = p_employee then
      raise exception 'employee already holds this vehicle' using errcode = '22023';
    end if;
    if p_from <= cur.from_date then
      raise exception 'new custody must start after the current holder started (%)', cur.from_date using errcode = '22023';
    end if;
    update vehicle_custody set to_date = p_from - 1 where id = cur.id;
  end if;
  insert into vehicle_custody(vehicle_id, employee_id, from_date) values (p_vehicle, p_employee, p_from) returning id into new_id;
  return new_id;
end $$;

-- A vehicle returned to the pool: closes the open row, opens nothing.
create or replace function end_custody(p_vehicle uuid, p_on date default current_date) returns void
language plpgsql as $$
declare cur record;
begin
  select * into cur from vehicle_custody where vehicle_id = p_vehicle and to_date is null for update;
  if not found then raise exception 'vehicle has no current holder' using errcode = '22023'; end if;
  if p_on < cur.from_date then raise exception 'end date is before custody started' using errcode = '22023'; end if;
  update vehicle_custody set to_date = p_on where id = cur.id;
end $$;
