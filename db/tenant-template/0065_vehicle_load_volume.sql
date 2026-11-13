-- Tenant migration 0065: how much space a vehicle's load area holds, in cubic metres. Idempotent.
-- Optional. A cargo request that states its volume is matched against it, together with the weight (ADR-092); a vehicle with no volume recorded is still suggested, with a note.
alter table vehicles add column if not exists load_volume_m3 numeric(10,2) check (load_volume_m3 is null or load_volume_m3 > 0);
