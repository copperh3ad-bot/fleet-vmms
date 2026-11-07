-- Tenant migration 0036 (ADR-062): daily reminders for periodic maintenance that is due soon or overdue. Idempotent.
-- Works like the document and licence reminders: each reminder is claimed in the database first, so one is never sent twice. A service gets one
-- "due soon" reminder and one "overdue" reminder for each cycle; when the service is done its last-done date changes, which starts a new cycle.

create table if not exists pm_reminders (
  vehicle_id       uuid not null references vehicles(id) on delete cascade,
  service_type_key text not null,
  stage            text not null check (stage in ('due_soon', 'overdue')),
  cycle            text not null,                        -- the date of the last service, so the next cycle can remind again
  sent_at          timestamptz not null default now(),
  primary key (vehicle_id, service_type_key, stage, cycle)
);

create or replace function claim_pm_reminders()
returns table (vehicle_id uuid, registration_no text, service_type_key text, label text, stage text, due_on date, days_remaining int, km_remaining numeric, custodian_user uuid)
language plpgsql as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select s.vehicle_id as dv, s.registration_no as dreg, s.service_type_key as dkey, s.label as dlabel, s.pm_status as dstage, s.due_on as ddue,
           s.days_remaining as ddays, s.km_remaining as dkm, s.custodian_id as dcust, s.last_done_on as dlast
      from v_pm_status s join vehicles v on v.id = s.vehicle_id
     where v.status = 'active' and s.pm_status in ('due_soon', 'overdue') and s.last_done_on is not null
  ), claimed as (
    insert into pm_reminders(vehicle_id, service_type_key, stage, cycle)
    select d.dv, d.dkey, d.dstage, d.dlast::text from due d
    on conflict do nothing
    returning pm_reminders.vehicle_id as cv, pm_reminders.service_type_key as ck, pm_reminders.stage as cs
  )
  select d.dv, d.dreg, d.dkey, d.dlabel, d.dstage, d.ddue, d.ddays::int, d.dkm::numeric, (select e.user_id from employees e where e.id = d.dcust)
    from due d join claimed c on c.cv = d.dv and c.ck = d.dkey and c.cs = d.dstage;
end $$;
