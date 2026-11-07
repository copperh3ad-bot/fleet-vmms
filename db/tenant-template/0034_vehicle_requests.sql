-- Tenant migration 0034 (ADR-059): HR vehicle requests. Idempotent.
-- HR asks for a vehicle for an employee. An administrator or fleet manager either gives a vehicle that nobody holds at the moment
-- (the pool), or approves buying one and gives it once it has been added. Every step is recorded with the person's name and time.

-- ---------- The hr role and its permissions ----------
insert into roles(key, name, is_external) values ('hr', 'HR', false) on conflict (key) do nothing;
insert into permissions(key, description) values
  ('vreq.request','Ask for a vehicle for an employee'),
  ('vreq.decide','Give a vehicle from the pool, or approve buying one, for a vehicle request'),
  ('vreq.read_all','See every vehicle request')
on conflict (key) do nothing;
insert into role_permissions(role_key, permission_key)
select r, p from (values
  ('hr','vreq.request'),('hr','vreq.read_all'),
  ('tenant_admin','vreq.decide'),('tenant_admin','vreq.read_all'),
  ('fleet_manager','vreq.decide'),('fleet_manager','vreq.read_all'),
  ('auditor','vreq.read_all')
) as x(r, p)
on conflict do nothing;

-- ---------- Requests ----------
create sequence if not exists vehicle_request_seq;
create table if not exists vehicle_requests (
  id             uuid primary key default gen_random_uuid(),
  request_no     text not null unique default ('VR-' || lpad(nextval('vehicle_request_seq')::text, 6, '0')),
  requested_by   uuid not null references employees(id),          -- the HR person who asked
  for_employee   uuid not null references employees(id),          -- the person who will hold the vehicle
  reason         text not null check (length(trim(reason)) >= 3),
  vehicle_class  text,                                            -- the kind wanted, in words; optional
  needed_from    date not null,
  status         text not null default 'requested' check (status in ('requested','purchase_approved','assigned','rejected','cancelled')),
  vehicle_id     uuid references vehicles(id),
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (status <> 'assigned' or vehicle_id is not null)
);
create index if not exists vehicle_requests_status_idx on vehicle_requests(status, created_at);
create index if not exists vehicle_requests_for_idx on vehicle_requests(for_employee);
-- One open request per person: a second one would only be a duplicate.
create unique index if not exists vehicle_requests_one_open_uq on vehicle_requests(for_employee) where status in ('requested','purchase_approved');

-- Append-only history: who moved a request from where to where, and why.
create table if not exists vehicle_request_events (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references vehicle_requests(id) on delete cascade,
  from_status text,
  to_status   text not null,
  actor_id    uuid,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists vehicle_request_events_idx on vehicle_request_events(request_id, created_at);

drop trigger if exists vehicle_requests_audit on vehicle_requests;
create trigger vehicle_requests_audit after insert or update or delete on vehicle_requests
  for each row execute function audit_trigger();

-- Every status change goes through this one function (CLAUDE.md rule 4 applied to requests) and writes a vehicle_request_events row.
-- Giving a vehicle also opens the employee's custody of it, through the same change_custody the Vehicles page uses.
create or replace function vehicle_request_transition(
  p_req uuid, p_to text, p_actor uuid, p_note text default null, p_vehicle uuid default null
) returns void language plpgsql as $$
declare
  r vehicle_requests%rowtype;
  v vehicles%rowtype;
  for_user uuid;
begin
  select * into r from vehicle_requests where id = p_req for update;
  if not found then raise exception 'vehicle request not found'; end if;
  if not ((r.status = 'requested' and p_to in ('assigned','purchase_approved','rejected','cancelled'))
       or (r.status = 'purchase_approved' and p_to in ('assigned','cancelled'))) then
    raise exception 'illegal vehicle request transition % -> %', r.status, p_to;
  end if;

  if p_to = 'assigned' then
    select user_id into for_user from employees where id = r.for_employee;
    if for_user is not null and for_user = p_actor then raise exception 'segregation of duties: you cannot decide your own vehicle request'; end if;
    if p_vehicle is null then raise exception 'choose a vehicle to give'; end if;
    select * into v from vehicles where id = p_vehicle for update;
    if not found then raise exception 'vehicle not found'; end if;
    if v.status <> 'active' then raise exception 'that vehicle is not available (it is %)', replace(v.status, '_', ' '); end if;
    if exists (select 1 from vehicle_custody where vehicle_id = p_vehicle and to_date is null) then raise exception 'that vehicle is already held by someone'; end if;
    perform change_custody(p_vehicle, r.for_employee, greatest(current_date, r.needed_from));
    update vehicle_requests set status = 'assigned', vehicle_id = p_vehicle, decided_by = p_actor, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now() where id = p_req;
  elsif p_to = 'purchase_approved' then
    select user_id into for_user from employees where id = r.for_employee;
    if for_user is not null and for_user = p_actor then raise exception 'segregation of duties: you cannot decide your own vehicle request'; end if;
    update vehicle_requests set status = 'purchase_approved', decided_by = p_actor, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now() where id = p_req;
  else
    if p_note is null or length(trim(p_note)) < 5 then raise exception 'a reason of at least 5 characters is required'; end if;
    update vehicle_requests set status = p_to, decided_by = case when p_to = 'rejected' then p_actor else decided_by end,
           decided_at = case when p_to = 'rejected' then now() else decided_at end, decision_note = trim(p_note), updated_at = now() where id = p_req;
  end if;

  insert into vehicle_request_events(request_id, from_status, to_status, actor_id, note) values (p_req, r.status, p_to, p_actor, nullif(trim(coalesce(p_note, '')), ''));
end $$;
