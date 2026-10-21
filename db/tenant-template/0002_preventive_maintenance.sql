-- Tenant migration 0002: preventive maintenance (PM) due tracking. Idempotent.
-- Default rule: oil change every 3 months. Distance rule is optional and off until a km interval is set.

create table if not exists service_types (
  key             text primary key,
  label           text not null,
  is_preventive   boolean not null default true,
  interval_months int check (interval_months > 0),
  interval_km     numeric(12,1) check (interval_km > 0),   -- null = no distance rule
  active          boolean not null default true
);

create table if not exists settings (
  key   text primary key,
  value text not null
);

-- Which job card lines were a given service. This is how "last oil change" is found without free-text guessing.
alter table job_card_lines add column if not exists service_type_key text references service_types(key);
create index if not exists job_card_lines_service_idx on job_card_lines(service_type_key) where service_type_key is not null;

-- History from before the system existed. Needed at onboarding or every vehicle shows "no history".
create table if not exists vehicle_service_baselines (
  vehicle_id       uuid not null references vehicles(id) on delete cascade,
  service_type_key text not null references service_types(key),
  last_done_on     date not null,
  last_odometer_km numeric(12,1),
  primary key (vehicle_id, service_type_key)
);

insert into service_types(key, label, interval_months) values ('oil_change', 'Oil change', 3)
on conflict (key) do nothing;

insert into settings(key, value) values ('pm_warning_days', '14'), ('pm_warning_km', '500')
on conflict (key) do nothing;

insert into permissions(key, description) values ('service.manage', 'Edit service types, intervals and baselines')
on conflict (key) do nothing;
insert into role_permissions(role_key, permission_key) values
  ('tenant_admin','service.manage'), ('fleet_manager','service.manage')
on conflict do nothing;

do $$
declare t text;
begin
  foreach t in array array['service_types','vehicle_service_baselines'] loop
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- Latest completed service per vehicle and service type (baseline or finished job card).
create or replace view v_service_last_done as
select v.id as vehicle_id, st.key as service_type_key, last.done_on, last.odometer_km
from vehicles v
cross join service_types st
left join lateral (
  select h.done_on, h.odometer_km from (
    select b.last_done_on as done_on, b.last_odometer_km as odometer_km
      from vehicle_service_baselines b
     where b.vehicle_id = v.id and b.service_type_key = st.key
    union all
    select coalesce(wo.completed_at::date, jc.updated_at::date), jc.odometer_km
      from job_cards jc
      join job_card_lines l on l.job_card_id = jc.id and l.service_type_key = st.key
      left join work_orders wo on wo.job_card_id = jc.id
     where jc.vehicle_id = v.id
       and jc.status in ('completed','invoiced','invoice_verified','closed')
  ) h
  order by h.done_on desc
  limit 1
) last on true
where v.status in ('active','in_workshop') and st.active and st.is_preventive;

-- One row per vehicle and preventive service, with a status the dashboard and alerts can filter on.
--   no_history : never done and no baseline entered
--   scheduled  : a job card for this service is already in flight (no nagging)
--   overdue    : past the due date, or past the distance limit
--   due_soon   : within pm_warning_days of the due date (or pm_warning_km of the limit)
--   ok         : nothing to do yet
create or replace view v_pm_status as
with cfg as (
  select coalesce((select value::int  from settings where key = 'pm_warning_days'), 14)  as warn_days,
         coalesce((select value::numeric from settings where key = 'pm_warning_km'), 500) as warn_km
), base as (
  select ld.vehicle_id, vh.registration_no, vh.odometer_km as current_km,
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
       (select cu.employee_id from vehicle_custody cu where cu.vehicle_id = c.vehicle_id and cu.to_date is null) as custodian_id
  from calc c cross join cfg;
