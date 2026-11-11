-- Tenant migration 0060 (ADR-093): owner decision F5 of 2026-11-11. Idempotent.
-- Each organization keeps its own list of depots and places (a depot, yard, office, port or city it works from). The list feeds the places people type for a vehicle's base
-- location, a cargo pick-up or destination and a trip, so the same place is spelled the same way and "where is this vehicle" can be answered (ADR-092).
-- The places stay free text on the records: a depot is a suggestion, not a foreign key, so nothing breaks when a depot is renamed or switched off.

insert into permissions(key, description) values ('depot.manage', 'Add, rename and switch off depots and places') on conflict (key) do nothing;
insert into role_permissions(role_key, permission_key)
select r, p from (values ('tenant_admin','depot.manage'),('fleet_manager','depot.manage'),('logistics','depot.manage')) as x(r, p) on conflict do nothing;

create table if not exists depots (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 2 and 80),
  city       text check (city is null or length(city) <= 80),
  kind       text not null default 'depot' check (kind in ('depot','office','yard','port','workshop','site','other')),
  active     boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists depots_name_uq on depots (lower(trim(name)));

drop trigger if exists depots_audit on depots;
create trigger depots_audit after insert or update or delete on depots
  for each row execute function audit_trigger();
