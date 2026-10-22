-- Tenant migration 0009: compliance reminders and attachment checks for every entity. Idempotent.

-- ---------- Document reminders ----------
-- Which reminders are due today, and records that they were claimed, in one statement, so two runs at the same time
-- (or the same run twice) can never send the same one twice. The caller writes the notifications in the same
-- transaction: if that fails, the claim rolls back with it.
--
-- Thresholds come from settings.doc_reminder_days (default 60,30,14) plus 0, which means "expired".
-- A document that is already inside several thresholds gets ONE reminder, for the tightest one; the wider ones are
-- recorded as claimed so they never fire later. Only the newest renewal of each (vehicle, type) counts, and only for
-- vehicles that are active or in the workshop.
create or replace function claim_document_reminders(p_today date default current_date)
returns table (entity_type text, entity_id uuid, vehicle_id uuid, doc_type text, reference text, expires_on date,
               days_left int, days_before int)
language plpgsql as $$
#variable_conflict use_column
declare thresholds int[];
begin
  thresholds := array(
    select distinct t::int
      from unnest(string_to_array(coalesce((select value from settings where key = 'doc_reminder_days'), '60,30,14'), ',')) as t
     where t ~ '^[0-9]+$' and t::int > 0);
  return query
  with docs as (
    select e.entity_type, e.entity_id, e.vehicle_id, e.doc_type, e.reference, e.expires_on, (e.expires_on - p_today) as dl
      from v_documents_expiring e join vehicles v on v.id = e.vehicle_id
     where v.status in ('active','in_workshop')
  ), crossed as (
    select d.*, t as tt
      from docs d cross join lateral unnest(thresholds || 0) as t
     where (t > 0 and d.dl between 0 and t) or (t = 0 and d.dl < 0)
  ), claimed as (
    insert into document_reminders(entity_type, entity_id, days_before)
    select c.entity_type, c.entity_id, c.tt from crossed c
    on conflict do nothing
    returning document_reminders.entity_type as ct, document_reminders.entity_id as ci, document_reminders.days_before as cd
  )
  select c.entity_type, c.entity_id, c.vehicle_id, c.doc_type, c.reference, c.expires_on, c.dl::int, c.tt
    from crossed c
    join claimed k on k.ct = c.entity_type and k.ci = c.entity_id and k.cd = c.tt
   where c.tt = (select min(c2.tt) from crossed c2 where c2.entity_type = c.entity_type and c2.entity_id = c.entity_id);
end $$;

-- ---------- Attachments: the thing must exist, for every kind ----------
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
    else false end;
  if not ok then raise exception 'attachment target not found'; end if;
  return new;
end $$;
