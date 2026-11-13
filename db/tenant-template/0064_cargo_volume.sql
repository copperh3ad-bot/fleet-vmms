-- Tenant migration 0064: a cargo request may also carry its volume in cubic metres. Idempotent.
-- Optional and informational (the vehicle suggestion still goes by weight against load capacity, ADR-092): it tells the fleet office how bulky the load is.
alter table cargo_requests add column if not exists volume_m3 numeric(10,2) check (volume_m3 is null or volume_m3 > 0);
