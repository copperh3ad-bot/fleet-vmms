-- Single-use links that let a workshop send one estimate for one job card without signing in (docs/adr/ADR-030). Idempotent.
-- Only the SHA-256 of the token is stored. The token itself is shown once to the person who creates the link.
create table if not exists public.quotation_links (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  job_card_id uuid not null,                  -- job_cards.id inside the tenant schema
  vendor_id   uuid not null,                  -- vendors.id inside the tenant schema
  created_by  uuid,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  revoked_at  timestamptz
);
create index if not exists quotation_links_job_idx on public.quotation_links(tenant_id, job_card_id);
alter table public.quotation_links enable row level security;
