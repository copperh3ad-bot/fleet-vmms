-- Control-plane migration 0001: where each organization's database is, and how a login or a link finds its organization.
-- Runs on the control database only (ADR-014). Idempotent.

-- The registry: every organization is a row in public.tenants. Shared organizations (schema inside the control database)
-- keep db_kind 'shared'. A dedicated organization has its own database; its connection string is stored encrypted.
alter table public.tenants add column if not exists db_kind text not null default 'shared';
alter table public.tenants add column if not exists db_url_enc text;            -- encrypted connection string, never logged or shown
alter table public.tenants add column if not exists db_ref text;                -- the provider's id for the database (a Neon project id)
alter table public.tenants add column if not exists db_region text;
alter table public.tenants add column if not exists provision_state text not null default 'ready';
alter table public.tenants add column if not exists provision_error text;
alter table public.tenants add column if not exists provisioned_at timestamptz;
alter table public.tenants add column if not exists provision_owner jsonb;     -- who becomes administrator, kept only until provisioning ends
do $$ begin
  alter table public.tenants drop constraint if exists tenants_db_kind_check;
  alter table public.tenants add constraint tenants_db_kind_check check (db_kind in ('shared', 'dedicated'));
  alter table public.tenants drop constraint if exists tenants_provision_state_check;
  alter table public.tenants add constraint tenants_provision_state_check
    check (provision_state in ('creating_database', 'migrating_platform', 'migrating_tenant', 'seeding', 'ready', 'failed'));
  -- a dedicated organization that is ready must be reachable
  alter table public.tenants drop constraint if exists tenants_dedicated_ready_check;
  alter table public.tenants add constraint tenants_dedicated_ready_check
    check (db_kind = 'shared' or provision_state <> 'ready' or db_url_enc is not null);
end $$;

-- Which organizations a login belongs to, for finding them after sign-in. Only presence is kept here; the role and
-- status that decide access are read from the organization's own database. A missing row hides an organization from
-- the chooser; it never grants access.
create table if not exists public.user_orgs (
  user_id    uuid not null,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);
create index if not exists user_orgs_tenant_idx on public.user_orgs(tenant_id);

-- Which organization an open link belongs to, found from the token's hash alone (the token is never stored).
create table if not exists public.link_routes (
  token_hash text primary key,
  kind       text not null check (kind in ('invite', 'odometer')),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists link_routes_tenant_idx on public.link_routes(tenant_id);
create index if not exists link_routes_expiry_idx on public.link_routes(expires_at);

-- Open invitations by email, so the first page can list invitations waiting for a confirmed address.
create table if not exists public.invite_index (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  invitation_id uuid not null,
  email         text not null,
  expires_at    timestamptz not null,
  primary key (tenant_id, invitation_id)
);
create index if not exists invite_index_email_idx on public.invite_index(lower(email));

-- Only the server's own connection reads or writes these.
alter table public.user_orgs     enable row level security;
alter table public.link_routes   enable row level security;
alter table public.invite_index  enable row level security;
do $$
declare r text; t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['user_orgs', 'link_routes', 'invite_index'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end $$;

-- Existing shared organizations: every current membership is also in the index.
insert into public.user_orgs(user_id, tenant_id) select user_id, tenant_id from public.tenant_memberships on conflict do nothing;

-- Open invitations and odometer links of the shared organizations that already exist: give them their routes.
insert into public.link_routes(token_hash, kind, tenant_id, expires_at)
  select token_hash, 'invite', tenant_id, expires_at from public.invitations where accepted_at is null and revoked_at is null
  on conflict do nothing;
insert into public.invite_index(tenant_id, invitation_id, email, expires_at)
  select tenant_id, id, lower(email), expires_at from public.invitations where accepted_at is null and revoked_at is null and email is not null
  on conflict do nothing;
insert into public.link_routes(token_hash, kind, tenant_id, expires_at)
  select token_hash, 'odometer', tenant_id, expires_at from public.odometer_links where used_at is null and revoked_at is null and expires_at > now()
  on conflict do nothing;
