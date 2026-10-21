-- Invitations and member status, for the Users and roles screen.
alter table public.tenant_memberships add column if not exists status text not null default 'active';
alter table public.tenant_memberships add column if not exists vehicle_scope text not null default 'all';
do $$ begin
  alter table public.tenant_memberships drop constraint if exists tenant_memberships_status_check;
  alter table public.tenant_memberships add constraint tenant_memberships_status_check check (status in ('active','disabled'));
  alter table public.tenant_memberships drop constraint if exists tenant_memberships_scope_check;
  alter table public.tenant_memberships add constraint tenant_memberships_scope_check check (vehicle_scope in ('all','own'));
end $$;

create table if not exists public.invitations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  full_name     text not null,
  email         text,
  phone         text,
  role_key      text not null,
  vehicle_scope text not null default 'all' check (vehicle_scope in ('all','own')),
  invited_by    uuid not null,
  token_hash    text not null unique,            -- only the hash is stored; the token goes in the message
  expires_at    timestamptz not null default now() + interval '7 days',
  accepted_at   timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  check (email is not null or phone is not null)
);
-- One live invitation per person per tenant.
create unique index if not exists invitations_live_email_uq
  on public.invitations (tenant_id, lower(email)) where accepted_at is null and revoked_at is null and email is not null;
alter table public.invitations enable row level security;
