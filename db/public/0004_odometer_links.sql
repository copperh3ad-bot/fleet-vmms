-- Single-use links that let a driver send one odometer reading without signing in (docs/adr/ADR-006). Idempotent.
-- Only the SHA-256 of the token is stored. The token itself is shown once to the admin who creates the link.
create table if not exists public.odometer_links (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  submission_id uuid not null,                 -- odometer_submissions.id inside the tenant schema
  created_by    uuid,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  revoked_at    timestamptz
);
create index if not exists odometer_links_submission_idx on public.odometer_links(tenant_id, submission_id);
alter table public.odometer_links enable row level security;
