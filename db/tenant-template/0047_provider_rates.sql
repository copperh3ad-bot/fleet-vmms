-- Tenant migration 0047 (ADR-078 phase C): each organization's own reference rates for its logistics providers. Idempotent.
-- Entered by the organization, never built in and never shared between organizations (the rule for every rate, ADR-018). A rate is reference only: it never replaces a quote.
create table if not exists provider_rates (
  id         uuid primary key default gen_random_uuid(),
  vendor_id  uuid not null references vendors(id) on delete cascade,
  label      text not null check (length(trim(label)) >= 2),          -- the run or service this rate is for, e.g. "Lahore to Karachi, 10-tonne truck"
  basis      text not null check (basis in ('per_trip','per_km','per_day','per_hour')),
  amount     numeric(14,2) not null check (amount > 0),
  notes      text,
  active     boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists provider_rates_vendor_idx on provider_rates(vendor_id) where active;
drop trigger if exists provider_rates_audit on provider_rates;
create trigger provider_rates_audit after insert or update or delete on provider_rates for each row execute function audit_trigger();
