-- Platform (shared) schema. Idempotent.
create extension if not exists pgcrypto;

create table if not exists public.tenants (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  schema_name    text not null unique check (schema_name ~ '^tenant_[a-z0-9_]{1,50}$'),
  schema_version int  not null default 0,
  status         text not null default 'active' check (status in ('active','suspended','closed')),
  currency       text not null default 'PKR',
  created_at     timestamptz not null default now()
);

create table if not exists public.tenant_memberships (
  user_id    uuid not null,          -- auth.users.id
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  role       text not null,          -- role key inside the tenant schema
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);
create index if not exists tenant_memberships_tenant_idx on public.tenant_memberships(tenant_id);

-- Plans carry limits and feature flags only. Pricing is intentionally not modelled.
create table if not exists public.plans (
  id       uuid primary key default gen_random_uuid(),
  key      text not null unique,
  name     text not null,
  limits   jsonb not null default '{}'::jsonb,   -- e.g. {"max_vehicles": 50, "max_users": 20}
  features jsonb not null default '{}'::jsonb
);

create table if not exists public.tenant_subscriptions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plan_id   uuid not null references public.plans(id),
  status    text not null default 'active' check (status in ('trial','active','past_due','cancelled')),
  starts_at timestamptz not null default now(),
  ends_at   timestamptz
);

create table if not exists public.platform_admins (
  user_id    uuid primary key,
  created_at timestamptz not null default now()
);

-- Lock the platform tables away from the public API roles. App uses a server-side connection.
alter table public.tenants              enable row level security;
alter table public.tenant_memberships   enable row level security;
alter table public.plans                enable row level security;
alter table public.tenant_subscriptions enable row level security;
alter table public.platform_admins      enable row level security;
