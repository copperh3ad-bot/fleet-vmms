-- Control-plane migration 0015: two plans, Basic and Pro, and fleet-size bands for Pro (ADR-035). Idempotent.
-- Basic is the existing "standard" plan, renamed: same key, same price, same customers, nothing taken away. Pro is the same product plus the AI features.
-- PRICES ARE THE OWNER'S, entered in Admin and never in code (CLAUDE.md rule 7). Pro has no single price: the AI costs more to run for a larger fleet
-- (more vehicles raise more estimates and invoices, so more readings), so Pro is priced in BANDS by number of vehicles, each with its own price and its own daily
-- allowance of AI readings. Until the owner enters bands that cover every fleet size (the last band has no upper limit), Pro is announced but cannot be bought.
--   features.ai_documents   the AI may read workshop documents (ADR-034)
--   limits.ai_reads_per_day the allowance when no band applies (a gifted or waived organization)
--   limits.ai_trial_reads   readings allowed in all during a trial (a small taste; paying lifts it)
update public.plans set name = 'Basic' where key = 'standard' and name = 'Standard';

insert into public.plans(key, name, limits, features, price_cents, currency, trial_days)
  values ('pro', 'Pro', '{"ai_reads_per_day": 60, "ai_trial_reads": 10}'::jsonb, '{"ai_documents": true}'::jsonb, null, 'USD', 3)
  on conflict (key) do nothing;

create table if not exists public.plan_bands (
  id               uuid primary key default gen_random_uuid(),
  plan_key         text not null references public.plans(key) on delete cascade,
  up_to_vehicles   int check (up_to_vehicles is null or up_to_vehicles > 0),     -- null: no upper limit (the last band)
  price_cents      int not null check (price_cents > 0),
  currency         text not null default 'USD',
  ai_reads_per_day int not null check (ai_reads_per_day between 1 and 100000)
);
create unique index if not exists plan_bands_one_per_size on public.plan_bands(plan_key, coalesce(up_to_vehicles, 2147483647));
alter table public.plan_bands enable row level security;

-- What an organization's band gave it when it joined or renewed (the price copy it already has is in price_cents), so a later change touches nobody already paying.
alter table public.org_billing add column if not exists ai_reads_per_day int check (ai_reads_per_day is null or ai_reads_per_day > 0);

-- A payment says which plan it pays for, so that paying for Pro is what switches an organization to Pro (step 2 of ADR-035). Null means "the plan it is on".
alter table public.payment_claims add column if not exists plan_key text;
