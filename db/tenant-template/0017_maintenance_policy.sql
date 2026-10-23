-- Tenant migration 0017: a company can keep its own vehicle maintenance policy (a PDF or scan) in its workspace.
-- Each upload is a dated version; the newest is the current policy, older ones stay as history. Idempotent.
create table if not exists maintenance_policies (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(trim(title)) between 2 and 120),
  effective_from date,
  notes          text check (notes is null or length(notes) <= 1000),
  created_by     uuid,
  created_at     timestamptz not null default now()
);

do $$
begin
  alter table attachments drop constraint if exists attachments_entity_type_check;
  alter table attachments add constraint attachments_entity_type_check check (entity_type in
    ('job_card','quotation','invoice','accident','challan','compliance_doc','insurance_policy','odometer_submission','vehicle','maintenance_policy'));
end $$;

-- Same guard as before with one more kind: the thing a file is attached to must exist, and its path must be this tenant's.
create or replace function attachment_guard() returns trigger language plpgsql as $$
declare ok boolean;
begin
  if split_part(new.storage_path, '/', 1) <> current_schema() then
    raise exception 'attachment path must start with the tenant folder';
  end if;
  ok := case new.entity_type
    when 'job_card'           then exists (select 1 from job_cards where id = new.entity_id)
    when 'quotation'          then exists (select 1 from quotations where id = new.entity_id)
    when 'invoice'            then exists (select 1 from invoices where id = new.entity_id)
    when 'accident'           then exists (select 1 from accidents where id = new.entity_id)
    when 'challan'            then exists (select 1 from challans where id = new.entity_id)
    when 'compliance_doc'     then exists (select 1 from compliance_docs where id = new.entity_id)
    when 'insurance_policy'   then exists (select 1 from insurance_policies where id = new.entity_id)
    when 'odometer_submission' then exists (select 1 from odometer_submissions where id = new.entity_id)
    when 'vehicle'            then exists (select 1 from vehicles where id = new.entity_id)
    when 'maintenance_policy' then exists (select 1 from maintenance_policies where id = new.entity_id)
    else false end;
  if not ok then raise exception 'attachment target not found'; end if;
  return new;
end $$;

-- Managers upload and remove; everyone inside the company except workshops can read.
insert into permissions(key, description) values
  ('policy.manage', 'Upload and remove the maintenance policy'),
  ('policy.read',   'Read the maintenance policy')
on conflict (key) do nothing;
insert into role_permissions(role_key, permission_key) values
  ('tenant_admin','policy.manage'), ('fleet_manager','policy.manage'),
  ('tenant_admin','policy.read'), ('fleet_manager','policy.read'), ('finance','policy.read'), ('requester','policy.read'), ('auditor','policy.read')
on conflict do nothing;

drop trigger if exists maintenance_policies_audit on maintenance_policies;
create trigger maintenance_policies_audit after insert or update or delete on maintenance_policies
  for each row execute function audit_trigger();
