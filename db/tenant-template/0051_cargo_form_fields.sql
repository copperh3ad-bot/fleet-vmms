-- Tenant migration 0051 (ADR-079 amendment): a cargo request asks what the company's own Vehicle Request Form asks. Idempotent.
-- New: the vehicle type required, one box for the person(s) of contact with their numbers, and special instructions. The contact name and number at each end, and the
-- time it must be delivered by, are no longer required (the form has a single contact box and no delivery time); requests already made keep theirs.

alter table cargo_requests add column if not exists vehicle_type text;
alter table cargo_requests add column if not exists poc_details  text;
alter table cargo_requests add column if not exists instructions text;

alter table cargo_requests alter column pickup_contact drop not null;
alter table cargo_requests alter column pickup_phone   drop not null;
alter table cargo_requests alter column drop_contact   drop not null;
alter table cargo_requests alter column drop_phone     drop not null;
alter table cargo_requests alter column deliver_by     drop not null;
