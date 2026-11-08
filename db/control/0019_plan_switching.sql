-- Control-plane migration 0019: moving between Basic and Pro by paying (ADR-068). Idempotent.
-- A payment claim names the plan and quotes the price it was filed at, so what the customer sent is what is confirmed even if a price changes in between.
-- Confirming a claim for the other plan sets a pending switch that takes effect when the paid period ends (or at once when there is no paid period);
-- a downgrade is a pending switch to Basic. A Basic customer may take one free 3-day Pro trial. Nothing here holds a price: every figure is copied from the plans tables.
alter table public.payment_claims add column if not exists quoted_price_cents int check (quoted_price_cents is null or quoted_price_cents > 0);
alter table public.payment_claims add column if not exists quoted_currency text;
alter table public.payment_claims add column if not exists quoted_ai_reads_per_day int check (quoted_ai_reads_per_day is null or quoted_ai_reads_per_day > 0);

alter table public.invoices add column if not exists plan_key text;

alter table public.org_billing add column if not exists pending_plan_key text check (pending_plan_key is null or pending_plan_key in ('standard', 'pro'));
alter table public.org_billing add column if not exists pending_plan_from timestamptz;
alter table public.org_billing add column if not exists pending_price_cents int check (pending_price_cents is null or pending_price_cents > 0);
alter table public.org_billing add column if not exists pending_currency text;
alter table public.org_billing add column if not exists pending_ai_reads_per_day int check (pending_ai_reads_per_day is null or pending_ai_reads_per_day > 0);
-- Set once, when the free Pro trial is taken; never cleared, which is how "once per organization" is enforced. The close is set when the daily job has shut the Pro features off again.
alter table public.org_billing add column if not exists pro_trial_ends_at timestamptz;
alter table public.org_billing add column if not exists pro_trial_closed_at timestamptz;

create table if not exists public.plan_changes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  from_plan    text,
  to_plan      text not null check (to_plan in ('standard', 'pro')),
  reason       text not null check (reason in ('payment', 'downgrade', 'operator', 'pro_trial_end')),
  claim_id     uuid,
  invoice_id   uuid,
  changed_by   uuid,
  effective_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists plan_changes_tenant on public.plan_changes(tenant_id, created_at desc);
alter table public.plan_changes enable row level security;
drop trigger if exists plan_changes_audit on public.plan_changes;
create trigger plan_changes_audit after insert or update or delete on public.plan_changes
  for each row execute function public.platform_audit_trigger();
