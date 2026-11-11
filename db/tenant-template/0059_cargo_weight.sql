-- Tenant migration 0059 (ADR-092): owner decision F of 2026-11-11. Idempotent.
-- A cargo request carries its weight in kilograms, so the system can suggest a vehicle whose load capacity (vehicles.load_capacity_kg, 0055) is at least that.
-- Optional: the requester may not know it; Logistics can enter it on the request.
alter table cargo_requests add column if not exists weight_kg numeric(12,1) check (weight_kg is null or weight_kg > 0);
