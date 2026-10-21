-- Tenant schema template, migration 0001. Idempotent.
-- Run with search_path already set to the target tenant schema (see scripts/migrate-tenants.ts).
-- No schema names are hardcoded here.

-- ---------- RBAC ----------
create table if not exists roles (
  key         text primary key,
  name        text not null,
  is_external boolean not null default false
);
create table if not exists permissions (
  key         text primary key,
  description text
);
create table if not exists role_permissions (
  role_key       text not null references roles(key) on delete cascade,
  permission_key text not null references permissions(key) on delete cascade,
  primary key (role_key, permission_key)
);

-- ---------- Master data ----------
create table if not exists employees (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid unique,               -- auth.users.id once they have a login
  full_name  text not null,
  employee_no text,
  department text,
  email      text,
  phone      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists vehicles (
  id              uuid primary key default gen_random_uuid(),
  registration_no text not null unique,
  make            text,
  model           text,
  year            int,
  vin             text,
  fuel_type       text,
  odometer_km     numeric(12,1) not null default 0,
  status          text not null default 'active' check (status in ('active','in_workshop','inactive','disposed')),
  created_at      timestamptz not null default now()
);

-- Custody history. A vehicle has at most one open custody row (to_date is null).
create table if not exists vehicle_custody (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references vehicles(id) on delete cascade,
  employee_id uuid not null references employees(id),
  from_date   date not null default current_date,
  to_date     date,
  check (to_date is null or to_date >= from_date)
);
create unique index if not exists vehicle_custody_one_open
  on vehicle_custody(vehicle_id) where to_date is null;
create index if not exists vehicle_custody_employee_idx on vehicle_custody(employee_id);

create table if not exists vendors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  categories text[] not null default '{}',
  contact    text,
  phone      text,
  email      text,
  user_id    uuid,                      -- vendor portal login, if any
  status     text not null default 'active' check (status in ('active','blocked')),
  created_at timestamptz not null default now()
);

-- Structured "why did this need maintenance" taxonomy.
create table if not exists reason_codes (
  id       uuid primary key default gen_random_uuid(),
  category text not null check (category in
    ('scheduled_service','wear_and_tear','driver_misuse','accident_damage','defect','poor_previous_repair','environmental','other')),
  code     text not null unique,
  label    text not null,
  active   boolean not null default true
);

-- ---------- Job cards ----------
create sequence if not exists job_card_seq;

create table if not exists job_cards (
  id             uuid primary key default gen_random_uuid(),
  job_no         text not null unique default ('JC-' || lpad(nextval('job_card_seq')::text, 6, '0')),
  vehicle_id     uuid not null references vehicles(id),
  custodian_id   uuid references employees(id),       -- snapshot of who held the vehicle at creation
  requested_by   uuid not null references employees(id),
  odometer_km    numeric(12,1),
  category       text not null default 'corrective' check (category in ('preventive','corrective','accident','inspection')),
  reason_code_id uuid not null references reason_codes(id),
  cause_text     text not null check (length(trim(cause_text)) >= 10),  -- qualitative root cause, mandatory
  description    text,
  priority       text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status         text not null default 'draft' check (status in (
    'draft','submitted','approved','rejected','returned_for_edit','vendor_assigned',
    'quotation_received','quotation_approved','in_progress','completed','invoiced','invoice_verified','closed','cancelled')),
  approved_by    uuid references employees(id),
  vendor_id      uuid references vendors(id),
  estimated_cost numeric(14,2),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  closed_at      timestamptz,
  check (approved_by is null or approved_by <> requested_by)   -- no self-approval
);
create index if not exists job_cards_vehicle_idx on job_cards(vehicle_id, created_at desc);
create index if not exists job_cards_status_idx  on job_cards(status);
create index if not exists job_cards_custodian_idx on job_cards(custodian_id);

create table if not exists job_card_lines (
  id          uuid primary key default gen_random_uuid(),
  job_card_id uuid not null references job_cards(id) on delete cascade,
  kind        text not null check (kind in ('part','labour','service','other')),
  description text not null,
  qty         numeric(12,3) not null default 1 check (qty > 0),
  unit_cost   numeric(14,2) not null default 0 check (unit_cost >= 0)
);

-- Append-only transition log.
create table if not exists job_card_events (
  id          uuid primary key default gen_random_uuid(),
  job_card_id uuid not null references job_cards(id) on delete cascade,
  from_status text,
  to_status   text not null,
  actor_id    uuid,                     -- auth user id
  comment     text,
  created_at  timestamptz not null default now()
);
create index if not exists job_card_events_card_idx on job_card_events(job_card_id, created_at);

-- ---------- Vendor flow ----------
create table if not exists quotations (
  id          uuid primary key default gen_random_uuid(),
  job_card_id uuid not null references job_cards(id) on delete cascade,
  vendor_id   uuid not null references vendors(id),
  amount      numeric(14,2) not null check (amount >= 0),
  details     text,
  status      text not null default 'submitted' check (status in ('submitted','approved','rejected')),
  created_at  timestamptz not null default now()
);

create table if not exists work_orders (
  id          uuid primary key default gen_random_uuid(),
  wo_no       text not null unique,
  job_card_id uuid not null unique references job_cards(id),
  vendor_id   uuid not null references vendors(id),
  quotation_id uuid references quotations(id),
  approved_amount numeric(14,2) not null check (approved_amount >= 0),
  status      text not null default 'issued' check (status in ('issued','in_progress','completed','cancelled')),
  issued_at   timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists invoices (
  id           uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id),
  invoice_no   text not null,
  invoice_date date not null,
  amount       numeric(14,2) not null check (amount >= 0),
  tax_amount   numeric(14,2) not null default 0 check (tax_amount >= 0),
  status       text not null default 'submitted' check (status in ('submitted','verified','disputed','paid')),
  verified_by  uuid,
  verified_at  timestamptz,
  unique (work_order_id, invoice_no)
);

create table if not exists attachments (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('job_card','quotation','invoice','accident','challan','compliance_doc','insurance_policy')),
  entity_id   uuid not null,
  storage_path text not null,           -- must start with the tenant schema name
  file_name   text not null,
  mime_type   text,
  uploaded_by uuid,
  created_at  timestamptz not null default now()
);
create index if not exists attachments_entity_idx on attachments(entity_type, entity_id);

-- ---------- Control ----------
create table if not exists budgets (
  id         uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id) on delete cascade,   -- null = fleet-wide budget
  period_start date not null,
  period_end   date not null,
  amount     numeric(14,2) not null check (amount >= 0),
  check (period_end >= period_start)
);
create index if not exists budgets_vehicle_idx on budgets(vehicle_id, period_start);

create table if not exists insurance_policies (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references vehicles(id) on delete cascade,
  insurer     text not null,
  policy_no   text not null,
  valid_from  date not null,
  valid_to    date not null,
  premium     numeric(14,2),
  check (valid_to >= valid_from)
);

create table if not exists compliance_docs (
  id         uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  doc_type   text not null check (doc_type in ('registration','fitness','token_tax','route_permit','other')),
  reference  text,
  expires_on date not null
);
create index if not exists compliance_docs_expiry_idx on compliance_docs(expires_on);

create table if not exists accidents (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references vehicles(id),
  employee_id uuid references employees(id),
  occurred_at timestamptz not null,
  location    text,
  description text not null,
  severity    text not null default 'minor' check (severity in ('minor','major','total_loss')),
  job_card_id uuid references job_cards(id)
);

create table if not exists challans (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references vehicles(id),
  employee_id uuid references employees(id),   -- custodian at the time
  issued_on   date not null,
  reference   text,
  violation   text,
  amount      numeric(14,2) not null check (amount >= 0),
  status      text not null default 'open' check (status in ('open','paid','disputed'))
);

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Audit ----------
create table if not exists audit_log (
  id         bigserial primary key,
  table_name text not null,
  row_id     text,
  action     text not null check (action in ('INSERT','UPDATE','DELETE')),
  actor_id   text,
  old_data   jsonb,
  new_data   jsonb,
  at         timestamptz not null default now()
);

create or replace function audit_trigger() returns trigger language plpgsql as $$
begin
  insert into audit_log(table_name, row_id, action, actor_id, old_data, new_data)
  values (
    tg_table_name,
    coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id', null),
    tg_op,
    nullif(current_setting('app.user_id', true), ''),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return null;
end $$;

-- Block edits to the audit log itself.
create or replace function audit_log_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only'; end $$;
drop trigger if exists audit_log_no_change on audit_log;
create trigger audit_log_no_change before update or delete on audit_log
  for each row execute function audit_log_immutable();

do $$
declare t text;
begin
  foreach t in array array[
    'vehicles','employees','vehicle_custody','vendors','job_cards','job_card_lines',
    'quotations','work_orders','invoices','budgets','insurance_policies',
    'compliance_docs','accidents','challans','role_permissions'
  ] loop
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- ---------- Job card state machine (DB-level guard) ----------
create or replace function job_card_guard() returns trigger language plpgsql as $$
declare ok boolean;
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    ok := (old.status, new.status) in (
      ('draft','submitted'),('draft','cancelled'),
      ('submitted','approved'),('submitted','rejected'),('submitted','returned_for_edit'),
      ('returned_for_edit','submitted'),('returned_for_edit','cancelled'),
      ('approved','vendor_assigned'),
      ('vendor_assigned','quotation_received'),
      ('quotation_received','quotation_approved'),('quotation_received','vendor_assigned'),
      ('quotation_approved','in_progress'),
      ('in_progress','completed'),
      ('completed','invoiced'),
      ('invoiced','invoice_verified'),('invoiced','completed'),
      ('invoice_verified','closed')
    );
    if not ok then
      raise exception 'illegal job card transition % -> %', old.status, new.status;
    end if;
    if new.status = 'closed' then new.closed_at := now(); end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists job_cards_guard on job_cards;
create trigger job_cards_guard before update on job_cards
  for each row execute function job_card_guard();

-- ---------- Analytics views ----------
create or replace view v_vehicle_job_cost as
select jc.id as job_card_id, jc.vehicle_id, jc.custodian_id, jc.reason_code_id, jc.odometer_km,
       jc.created_at,
       coalesce(
         (select sum(i.amount + i.tax_amount) from work_orders wo
            join invoices i on i.work_order_id = wo.id and i.status in ('verified','paid')
          where wo.job_card_id = jc.id),
         (select sum(l.qty * l.unit_cost) from job_card_lines l where l.job_card_id = jc.id),
         0) as cost
from job_cards jc
where jc.status not in ('draft','cancelled','rejected');

create or replace view v_vehicle_maintenance_summary as
select v.id as vehicle_id, v.registration_no,
       count(c.job_card_id)               as job_count,
       coalesce(sum(c.cost), 0)           as total_cost,
       max(c.created_at)                  as last_job_at,
       count(c.job_card_id) filter (where c.created_at > now() - interval '90 days') as jobs_last_90d,
       coalesce(sum(c.cost) filter (where c.created_at > now() - interval '90 days'), 0) as cost_last_90d
from vehicles v
left join v_vehicle_job_cost c on c.vehicle_id = v.id
group by v.id, v.registration_no;

-- Repeat repair: same vehicle and same reason code within 30 days of the previous one.
create or replace view v_repeat_repairs as
select job_card_id, vehicle_id, reason_code_id, created_at,
       created_at - lag(created_at) over (partition by vehicle_id, reason_code_id order by created_at) as since_previous
from v_vehicle_job_cost;

-- Budget utilisation per vehicle budget period.
create or replace view v_budget_utilisation as
select b.id as budget_id, b.vehicle_id, b.period_start, b.period_end, b.amount as budget,
       coalesce(sum(c.cost), 0) as spent,
       case when b.amount > 0 then round(coalesce(sum(c.cost),0) / b.amount * 100, 1) end as pct_used,
       coalesce(sum(c.cost),0) > b.amount as over_budget
from budgets b
left join v_vehicle_job_cost c
  on (b.vehicle_id is null or c.vehicle_id = b.vehicle_id)
 and c.created_at::date between b.period_start and b.period_end
group by b.id;

-- Seed default roles, permissions, reason codes.
insert into roles(key, name, is_external) values
  ('tenant_admin','Tenant Admin',false),
  ('fleet_manager','Fleet Manager',false),
  ('finance','Finance',false),
  ('requester','Requester',false),
  ('auditor','Auditor',false),
  ('vendor','Vendor',true)
on conflict (key) do nothing;

insert into permissions(key, description) values
  ('vehicle.read',''),('vehicle.write',''),
  ('jobcard.create',''),('jobcard.read_own',''),('jobcard.read_all',''),
  ('jobcard.approve',''),('jobcard.assign_vendor',''),
  ('quotation.submit',''),('quotation.approve',''),
  ('workorder.update',''),
  ('invoice.submit',''),('invoice.verify',''),
  ('budget.manage',''),('compliance.manage',''),
  ('report.view',''),('admin.users',''),('admin.settings','')
on conflict (key) do nothing;

insert into role_permissions(role_key, permission_key)
select r, p from (values
  ('tenant_admin','vehicle.read'),('tenant_admin','vehicle.write'),('tenant_admin','jobcard.read_all'),
  ('tenant_admin','budget.manage'),('tenant_admin','compliance.manage'),('tenant_admin','report.view'),
  ('tenant_admin','admin.users'),('tenant_admin','admin.settings'),
  ('fleet_manager','vehicle.read'),('fleet_manager','vehicle.write'),('fleet_manager','jobcard.create'),
  ('fleet_manager','jobcard.read_all'),('fleet_manager','jobcard.approve'),('fleet_manager','jobcard.assign_vendor'),
  ('fleet_manager','quotation.approve'),('fleet_manager','budget.manage'),('fleet_manager','compliance.manage'),
  ('fleet_manager','report.view'),
  ('finance','vehicle.read'),('finance','jobcard.read_all'),('finance','invoice.verify'),
  ('finance','budget.manage'),('finance','report.view'),
  ('requester','vehicle.read'),('requester','jobcard.create'),('requester','jobcard.read_own'),
  ('auditor','vehicle.read'),('auditor','jobcard.read_all'),('auditor','report.view'),
  ('vendor','quotation.submit'),('vendor','workorder.update'),('vendor','invoice.submit')
) as x(r, p)
on conflict do nothing;

insert into reason_codes(category, code, label) values
  ('scheduled_service','SVC_ROUTINE','Routine scheduled service'),
  ('wear_and_tear','WEAR_BRAKES','Brake wear'),
  ('wear_and_tear','WEAR_TYRES','Tyre wear'),
  ('driver_misuse','MISUSE_OVERLOAD','Overloading / rough use'),
  ('accident_damage','ACC_COLLISION','Collision damage'),
  ('defect','DEFECT_PART','Faulty part / manufacturing defect'),
  ('poor_previous_repair','REPEAT_POOR_REPAIR','Previous repair not effective'),
  ('environmental','ENV_WEATHER','Weather / road conditions'),
  ('other','OTHER','Other')
on conflict (code) do nothing;
