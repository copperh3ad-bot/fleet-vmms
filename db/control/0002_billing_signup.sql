-- Control-plane migration 0002: the price, the trial, each organization's subscription, and sign-ups waiting to be set up
-- (ADR-014). Runs on the control database only. Idempotent.

-- The price lives on the plan (CLAUDE.md rule 7): one plan, USD 149 a month, 3-day trial. Older plans stay unpriced.
alter table public.plans add column if not exists price_cents int check (price_cents is null or price_cents >= 0);
alter table public.plans add column if not exists currency text not null default 'USD';
alter table public.plans add column if not exists trial_days int not null default 0 check (trial_days between 0 and 60);
insert into public.plans(key, name, limits, price_cents, currency, trial_days)
  values ('standard', 'Standard', '{}'::jsonb, 14900, 'USD', 3) on conflict (key) do nothing;

-- One row per organization. Access is worked out from these dates (src/lib/billing/state.ts), so nothing has to run
-- for a trial to end or a payment to fall late. The price is copied here so a later price change does not touch
-- organizations already paying.
create table if not exists public.org_billing (
  tenant_id          uuid primary key references public.tenants(id) on delete cascade,
  plan_key           text not null,
  status             text not null check (status in ('trialing', 'active', 'cancelled')),
  trial_ends_at      timestamptz,
  current_period_end timestamptz,                -- paid up to here
  price_cents        int not null check (price_cents >= 0),
  currency           text not null default 'USD',
  grace_days         int not null default 5 check (grace_days between 0 and 30),
  comped             boolean not null default false,       -- the operator waives billing for this organization
  suspended          boolean not null default false,       -- the operator has locked it
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Organizations that existed before billing: free of charge, never locked, until the operator decides otherwise.
insert into public.org_billing(tenant_id, plan_key, status, price_cents, currency, comped)
  select id, 'legacy', 'active', 0, 'USD', true from public.tenants where db_kind = 'shared'
  on conflict do nothing;

-- Operator-editable settings: bank details to pay into, the PKR rate. Not in the repository, not secrets.
create table if not exists public.platform_settings (
  key        text primary key check (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  value      text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Someone who filled in the sign-up form. Nothing is built for them until their email is confirmed and they are signed in
-- (a stranger typing addresses must not be able to make databases). One row per address; filling the form again
-- replaces a waiting one.
create table if not exists public.signups (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  org_name      text not null,
  contact_name  text not null,
  phone         text,
  fleet_size    text,
  terms_version text not null,
  status        text not null default 'pending' check (status in ('pending', 'started', 'done')),
  tenant_id     uuid references public.tenants(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists signups_email_uq on public.signups (lower(email));

alter table public.org_billing       enable row level security;
alter table public.platform_settings enable row level security;
alter table public.signups           enable row level security;
do $$
declare r text; t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['org_billing', 'platform_settings', 'signups'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end $$;

-- Billing changes are access changes: write them to the platform audit log (migration platform 0007).
drop trigger if exists org_billing_audit on public.org_billing;
create trigger org_billing_audit after insert or update or delete on public.org_billing
  for each row execute function public.platform_audit_trigger();
drop trigger if exists platform_settings_audit on public.platform_settings;
create trigger platform_settings_audit after insert or update or delete on public.platform_settings
  for each row execute function public.platform_audit_trigger();
