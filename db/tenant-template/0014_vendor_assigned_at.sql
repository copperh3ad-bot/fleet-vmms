-- Tenant migration 0014: the vendor portal shows when a job was assigned to the workshop. Idempotent.
-- Appended as the last column, so the view keeps working for everything that already reads it.
create or replace view v_vendor_job_requests as
select jc.id as job_card_id, jc.job_no, jc.status as job_status, jc.priority, jc.needed_by, jc.description, jc.cause_text,
       jc.odometer_km, jc.vendor_id, v.registration_no, v.make, v.model, v.year,
       (select q.status from quotations q where q.job_card_id = jc.id order by q.created_at desc limit 1) as last_quotation_status,
       (select max(e.created_at) from job_card_events e where e.job_card_id = jc.id and e.to_status = 'vendor_assigned') as assigned_at
from job_cards jc join vehicles v on v.id = jc.vehicle_id
where jc.status in ('vendor_assigned','quotation_received')
  and jc.vendor_id in (select id from vendors where user_id::text = current_setting('app.user_id', true));
