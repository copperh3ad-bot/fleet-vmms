-- Tenant migration 0016: a vehicle can have files (its photo and a scan of the registration book). Idempotent.
do $$
begin
  alter table attachments drop constraint if exists attachments_entity_type_check;
  alter table attachments add constraint attachments_entity_type_check check (entity_type in
    ('job_card','quotation','invoice','accident','challan','compliance_doc','insurance_policy','odometer_submission','vehicle'));
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
    else false end;
  if not ok then raise exception 'attachment target not found'; end if;
  return new;
end $$;
