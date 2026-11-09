-- Tenant migration 0049 (ADR-079 phase C): cargo pick-up and delivery requests. Idempotent.
-- A person asks for something to be collected and delivered; the fleet manager or Logistics accepts it and may turn it into a trip. Cargo is its own list, not a kind of trip.

create sequence if not exists cargo_seq;
create table if not exists cargo_requests (
  id               uuid primary key default gen_random_uuid(),
  cargo_no         text not null unique default ('CR-' || lpad(nextval('cargo_seq')::text, 6, '0')),
  requested_by     uuid not null references employees(id),
  description      text not null check (length(trim(description)) >= 3),       -- what is being moved
  quantity_text    text not null check (length(trim(quantity_text)) >= 1),     -- how much: "12 cartons, about 300 kg"
  pickup_place     text not null,
  pickup_contact   text not null,
  pickup_phone     text not null,
  pickup_at        timestamptz not null,
  drop_place       text not null,
  drop_contact     text not null,
  drop_phone       text not null,
  deliver_by       timestamptz not null,
  handling         text,                                                      -- fragile, cold, hazardous, needs loading help; empty for none
  department       text,
  status           text not null default 'requested' check (status in ('requested','accepted','in_transit','delivered','rejected','cancelled')),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text,
  trip_id          uuid references trips(id),
  source           text not null default 'app' check (source in ('app','whatsapp')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (deliver_by > pickup_at)
);
create index if not exists cargo_requests_status_idx on cargo_requests(status, pickup_at);
create index if not exists cargo_requests_requester_idx on cargo_requests(requested_by);

-- Append-only history: who moved a request from where to where, and why.
create table if not exists cargo_events (
  id          uuid primary key default gen_random_uuid(),
  cargo_id    uuid not null references cargo_requests(id) on delete cascade,
  from_status text,
  to_status   text not null,
  actor_id    uuid,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists cargo_events_cargo_idx on cargo_events(cargo_id, created_at);

drop trigger if exists cargo_requests_audit on cargo_requests;
create trigger cargo_requests_audit after insert or update or delete on cargo_requests for each row execute function audit_trigger();

-- Every status change goes through this one function (CLAUDE.md rule 4) and writes a cargo_events row. The person who asked cannot accept or reject their own
-- request, except a sole-employee administrator (ADR-077).
create or replace function cargo_transition(p_id uuid, p_to text, p_actor uuid, p_note text default null) returns void
language plpgsql as $$
declare c cargo_requests; requester_user uuid; note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into c from cargo_requests where id = p_id for update;
  if not found then raise exception 'cargo request not found'; end if;
  if not ((c.status = 'requested' and p_to in ('accepted','rejected','cancelled'))
       or (c.status = 'accepted' and p_to in ('in_transit','cancelled'))
       or (c.status = 'in_transit' and p_to = 'delivered')) then
    raise exception 'illegal cargo transition % -> %', c.status, p_to;
  end if;
  if p_to in ('accepted','rejected') then
    select user_id into requester_user from employees where id = c.requested_by;
    if requester_user is not null and requester_user = p_actor and not admin_may_decide_own('cargo.handle') then
      raise exception 'segregation of duties: you cannot decide your own cargo request';
    end if;
  end if;
  if p_to in ('rejected','cancelled') and (note is null or length(note) < 5) then raise exception 'a reason of at least 5 characters is required'; end if;
  update cargo_requests set status = p_to, updated_at = now(),
         decided_by = case when p_to in ('accepted','rejected') then p_actor else decided_by end,
         decided_at = case when p_to in ('accepted','rejected') then now() else decided_at end,
         decision_note = case when p_to in ('accepted','rejected','cancelled') then note else decision_note end where id = p_id;
  insert into cargo_events(cargo_id, from_status, to_status, actor_id, note) values (p_id, c.status, p_to, p_actor, note);
end $$;
revoke execute on function cargo_transition(uuid, text, uuid, text) from public;

-- Permissions: ask for cargo to be moved, and handle (accept, reject, move, deliver) the requests.
insert into permissions(key, description) values
  ('cargo.request', 'Ask for cargo to be picked up and delivered'),
  ('cargo.handle', 'Accept, reject and follow cargo requests, and make a trip from one')
on conflict (key) do nothing;
insert into role_permissions(role_key, permission_key) values
  ('requester','cargo.request'), ('fleet_manager','cargo.request'), ('tenant_admin','cargo.request'), ('logistics','cargo.request'),
  ('fleet_manager','cargo.handle'), ('tenant_admin','cargo.handle'), ('logistics','cargo.handle')
on conflict do nothing;
