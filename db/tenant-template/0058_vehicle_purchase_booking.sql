-- Tenant migration 0058 (ADR-091): HR vehicle purchase booking, owner decisions E1 to E5 of 2026-11-11. Idempotent.
-- When no pool vehicle fits, the request becomes a purchase: Finance confirms a budget, a Fleet Manager or Administrator approves the purchase,
-- dealer quotations are recorded, and adding the vehicle closes the request and hands the vehicle over.
--   requested -> budget_confirmed (Finance enters the budget) -> purchase_approved (Fleet Manager / Admin) -> assigned (the vehicle is added)
-- A purchase can no longer be approved before Finance has confirmed a budget. A pool vehicle may still be given at any open step.

insert into permissions(key, description) values ('vreq.confirm_budget', 'Confirm the budget for buying a vehicle for a vehicle request') on conflict (key) do nothing;
insert into role_permissions(role_key, permission_key)
select r, p from (values
  ('finance','vreq.confirm_budget'),('tenant_admin','vreq.confirm_budget'),
  ('finance','vreq.read_all')                                      -- Finance must see the requests whose budget it confirms
) as x(r, p) on conflict do nothing;

alter table vehicle_requests add column if not exists purchase_budget numeric(14,2) check (purchase_budget is null or purchase_budget > 0);
alter table vehicle_requests add column if not exists budget_confirmed_by uuid;
alter table vehicle_requests add column if not exists budget_confirmed_at timestamptz;

alter table vehicle_requests drop constraint if exists vehicle_requests_status_check;
alter table vehicle_requests add constraint vehicle_requests_status_check
  check (status in ('requested','budget_confirmed','purchase_approved','assigned','rejected','cancelled'));

-- One open request per person, now counting the new step.
drop index if exists vehicle_requests_one_open_uq;
create unique index if not exists vehicle_requests_one_open_uq on vehicle_requests(for_employee) where status in ('requested','budget_confirmed','purchase_approved');

-- ---------- Dealer quotations (E4) ----------
create table if not exists vehicle_request_quotes (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references vehicle_requests(id) on delete cascade,
  dealer      text not null check (length(trim(dealer)) between 2 and 120),
  vehicle     text not null check (length(trim(vehicle)) between 2 and 160),   -- what is quoted: make, model, variant
  amount      numeric(14,2) not null check (amount > 0),
  valid_until date,
  note        text check (note is null or length(note) <= 500),
  added_by    uuid,
  created_at  timestamptz not null default now()
);
create index if not exists vehicle_request_quotes_idx on vehicle_request_quotes(request_id, created_at);
drop trigger if exists vehicle_request_quotes_audit on vehicle_request_quotes;
create trigger vehicle_request_quotes_audit after insert or update or delete on vehicle_request_quotes
  for each row execute function audit_trigger();

-- ---------- The one way a request changes (from 0034), with the budget step ----------
drop function if exists vehicle_request_transition(uuid, text, uuid, text, uuid);
create or replace function vehicle_request_transition(
  p_req uuid, p_to text, p_actor uuid, p_note text default null, p_vehicle uuid default null, p_amount numeric default null
) returns void language plpgsql as $$
declare
  r vehicle_requests%rowtype;
  v vehicles%rowtype;
  for_user uuid;
begin
  select * into r from vehicle_requests where id = p_req for update;
  if not found then raise exception 'vehicle request not found'; end if;
  if not ((r.status = 'requested'         and p_to in ('budget_confirmed','assigned','rejected','cancelled'))
       or (r.status = 'budget_confirmed'  and p_to in ('budget_confirmed','purchase_approved','assigned','rejected','cancelled'))
       or (r.status = 'purchase_approved' and p_to in ('assigned','cancelled'))) then
    raise exception 'illegal vehicle request transition % -> %', r.status, p_to;
  end if;
  select user_id into for_user from employees where id = r.for_employee;

  if p_to = 'budget_confirmed' then
    if for_user is not null and for_user = p_actor then raise exception 'segregation of duties: you cannot decide your own vehicle request'; end if;
    if p_amount is null or p_amount <= 0 then raise exception 'enter the budget amount'; end if;
    update vehicle_requests set status = 'budget_confirmed', purchase_budget = p_amount, budget_confirmed_by = p_actor, budget_confirmed_at = now(),
           decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now() where id = p_req;
  elsif p_to = 'assigned' then
    if for_user is not null and for_user = p_actor then raise exception 'segregation of duties: you cannot decide your own vehicle request'; end if;
    if p_vehicle is null then raise exception 'choose a vehicle to give'; end if;
    select * into v from vehicles where id = p_vehicle for update;
    if not found then raise exception 'vehicle not found'; end if;
    if v.status <> 'active' then raise exception 'that vehicle is not available (it is %)', replace(v.status, '_', ' '); end if;
    if exists (select 1 from vehicle_custody where vehicle_id = p_vehicle and to_date is null) then raise exception 'that vehicle is already held by someone'; end if;
    perform change_custody(p_vehicle, r.for_employee, greatest(current_date, r.needed_from));
    update vehicle_requests set status = 'assigned', vehicle_id = p_vehicle, decided_by = p_actor, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now() where id = p_req;
  elsif p_to = 'purchase_approved' then
    if for_user is not null and for_user = p_actor then raise exception 'segregation of duties: you cannot decide your own vehicle request'; end if;
    if r.purchase_budget is null then raise exception 'Finance must confirm a budget before the purchase is approved'; end if;
    update vehicle_requests set status = 'purchase_approved', decided_by = p_actor, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now() where id = p_req;
  else
    if p_note is null or length(trim(p_note)) < 5 then raise exception 'a reason of at least 5 characters is required'; end if;
    update vehicle_requests set status = p_to, decided_by = case when p_to = 'rejected' then p_actor else decided_by end,
           decided_at = case when p_to = 'rejected' then now() else decided_at end, decision_note = trim(p_note), updated_at = now() where id = p_req;
  end if;

  insert into vehicle_request_events(request_id, from_status, to_status, actor_id, note)
  values (p_req, r.status, p_to, p_actor,
          case when p_to = 'budget_confirmed' then 'Budget ' || trim(to_char(p_amount, 'FM999,999,999,990.00')) || coalesce(': ' || nullif(trim(coalesce(p_note, '')), ''), '')
               else nullif(trim(coalesce(p_note, '')), '') end);
end $$;
revoke execute on function vehicle_request_transition(uuid, text, uuid, text, uuid, numeric) from public;
