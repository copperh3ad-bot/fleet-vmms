-- Control-plane migration 0008: dollar-to-rupee rates by date (ADR-018). Idempotent.
-- A tax invoice converts the price at the rate for the day the customer paid. One row per day. An operator's own entry always
-- wins over an automatic one for the same day. Nothing is invented: a day with no row uses the latest earlier day (up to a week),
-- and past that the invoice falls back to the manual rate in Settings, and says so.
create table if not exists public.fx_rates (
  rate_date  date primary key,
  buy        numeric(10,4) not null check (buy > 0 and buy < 100000),
  sell       numeric(10,4) not null check (sell > 0 and sell < 100000),
  source     text not null check (length(source) between 2 and 40),         -- 'manual', 'forex.pk'
  note       text check (note is null or length(note) <= 200),
  entered_by uuid,
  fetched_at timestamptz not null default now(),
  check (sell >= buy)
);
create index if not exists fx_rates_source_idx on public.fx_rates(source, rate_date desc);

alter table public.fx_rates enable row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table public.fx_rates from %I', r); end if;
  end loop;
end $$;

drop trigger if exists fx_rates_audit on public.fx_rates;
create trigger fx_rates_audit after insert or update or delete on public.fx_rates for each row execute function public.platform_audit_trigger();
