-- Tenant migration 0027 (ADR-044): driving licences with expiry reminders, and the history of every vehicle's status. Idempotent.

-- ---------- Driving licences ----------
-- One row per employee, changed in place. The licence number is personal data: the audit trail below never keeps it in full.
create table if not exists driver_licences (
  id                      uuid primary key default gen_random_uuid(),
  employee_id             uuid not null unique references employees(id) on delete cascade,
  licence_no              text not null,
  licence_class           text,
  issued_on               date,
  expires_on              date not null,
  emergency_contact_name  text,
  emergency_contact_phone text,
  updated_at              timestamptz not null default now(),
  check (issued_on is null or expires_on >= issued_on)
);
create index if not exists driver_licences_expiry_idx on driver_licences(expires_on);

-- The audit row says that a licence changed and keeps the last four characters of the number, never the number.
create or replace function driver_licence_audit() returns trigger language plpgsql as $$
declare o jsonb; n jsonb;
begin
  if tg_op in ('UPDATE','DELETE') then o := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then n := to_jsonb(new); end if;
  if o is not null then o := o || jsonb_build_object('licence_no', '…' || right(o->>'licence_no', 4), 'emergency_contact_phone', null); end if;
  if n is not null then n := n || jsonb_build_object('licence_no', '…' || right(n->>'licence_no', 4), 'emergency_contact_phone', null); end if;
  insert into audit_log(table_name, row_id, action, actor_id, old_data, new_data)
  values (tg_table_name, (coalesce(n, o))->>'id', tg_op, nullif(current_setting('app.user_id', true), ''), o, n);
  return null;
end $$;
drop trigger if exists driver_licences_audit on driver_licences;
create trigger driver_licences_audit after insert or update or delete on driver_licences
  for each row execute function driver_licence_audit();

-- A licence is changed in place, so a new expiry date must start its reminders again.
create or replace function driver_licence_renewed() returns trigger language plpgsql as $$
begin
  if new.expires_on is distinct from old.expires_on then
    delete from document_reminders where entity_type = 'driver_licence' and entity_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists driver_licences_renewed on driver_licences;
create trigger driver_licences_renewed after update on driver_licences
  for each row execute function driver_licence_renewed();

-- The reminder table accepts licences too.
alter table document_reminders drop constraint if exists document_reminders_entity_type_check;
alter table document_reminders add constraint document_reminders_entity_type_check
  check (entity_type in ('insurance_policy','compliance_doc','driver_licence'));

-- Same rules as claim_document_reminders: the days come from settings.doc_reminder_days plus 0 for "expired", a licence
-- already inside several thresholds gets one reminder (the tightest), the wider ones are recorded as claimed, and
-- claiming and returning happen in one statement so a reminder is never sent twice. Only active employees count.
create or replace function claim_licence_reminders(p_today date default current_date)
returns table (entity_id uuid, employee_id uuid, expires_on date, days_left int, days_before int)
language plpgsql as $$
#variable_conflict use_column
declare thresholds int[];
begin
  thresholds := array(
    select distinct t::int
      from unnest(string_to_array(coalesce((select value from settings where key = 'doc_reminder_days'), '60,30,14'), ',')) as t
     where t ~ '^[0-9]+$' and t::int > 0);
  return query
  with lic as (
    select l.id as lid, l.employee_id as eid, l.expires_on as exp, (l.expires_on - p_today) as dl
      from driver_licences l join employees e on e.id = l.employee_id where e.active
  ), crossed as (
    select d.*, t as tt
      from lic d cross join lateral unnest(thresholds || 0) as t
     where (t > 0 and d.dl between 0 and t) or (t = 0 and d.dl < 0)
  ), claimed as (
    insert into document_reminders(entity_type, entity_id, days_before)
    select 'driver_licence', c.lid, c.tt from crossed c
    on conflict do nothing
    returning document_reminders.entity_id as ci, document_reminders.days_before as cd
  )
  select c.lid, c.eid, c.exp, c.dl::int, c.tt
    from crossed c join claimed k on k.ci = c.lid and k.cd = c.tt
   where c.tt = (select min(c2.tt) from crossed c2 where c2.lid = c.lid);
end $$;

-- ---------- The history of every vehicle's status ----------
-- Written by a trigger, so every way a status can change is recorded, not only the ones the application remembers.
create table if not exists vehicle_status_history (
  id         uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  status     text not null,
  from_at    timestamptz not null default now(),
  to_at      timestamptz,
  changed_by text,
  check (to_at is null or to_at >= from_at)
);
create unique index if not exists vehicle_status_history_open on vehicle_status_history(vehicle_id) where to_at is null;
create index if not exists vehicle_status_history_vehicle_idx on vehicle_status_history(vehicle_id, from_at);

create or replace function vehicle_status_history_write() returns trigger language plpgsql as $$
declare who text := nullif(current_setting('app.user_id', true), '');
begin
  if tg_op = 'INSERT' then
    insert into vehicle_status_history(vehicle_id, status, from_at, changed_by) values (new.id, new.status, coalesce(new.created_at, now()), who);
  elsif new.status is distinct from old.status then
    update vehicle_status_history set to_at = now() where vehicle_id = new.id and to_at is null;
    insert into vehicle_status_history(vehicle_id, status, from_at, changed_by) values (new.id, new.status, now(), who);
  end if;
  return null;
end $$;
drop trigger if exists vehicles_status_history on vehicles;
create trigger vehicles_status_history after insert or update of status on vehicles
  for each row execute function vehicle_status_history_write();

-- Vehicles that existed before this migration start at their creation date with the status they have now.
insert into vehicle_status_history(vehicle_id, status, from_at)
select v.id, v.status, v.created_at from vehicles v
 where not exists (select 1 from vehicle_status_history h where h.vehicle_id = v.id);
