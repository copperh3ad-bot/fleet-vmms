-- A handover dated the same day the current holder started replaces that holder: they held the vehicle for no
-- full day, so there is nothing to keep in the custody history (the audit log still records the removed row).
-- Earlier dates are still refused. Everything else is as in 0005.
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
    if p_from < cur.from_date then
      raise exception 'new custody must start on or after the day the current holder started (%)', cur.from_date using errcode = '22023';
    end if;
    if p_from = cur.from_date then
      delete from vehicle_custody where id = cur.id;
    else
      update vehicle_custody set to_date = p_from - 1 where id = cur.id;
    end if;
  end if;
  insert into vehicle_custody(vehicle_id, employee_id, from_date) values (p_vehicle, p_employee, p_from) returning id into new_id;
  return new_id;
end $$;
