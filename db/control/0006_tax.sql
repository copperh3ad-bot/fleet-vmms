-- Control-plane migration 0006: tax on subscriptions for customers in Pakistan (ADR-017). Idempotent.
-- No rate is stored here. Rates are rows the operator adds (tax_rules) and defaults in platform_settings, so a change in the
-- law is a data change. Each invoice keeps a snapshot of the numbers and details it used, because invoices never change.

-- A tax authority and its sales tax rate on services, for example the province a customer falls under.
create table if not exists public.tax_rules (
  code          text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,11}$'),
  label         text not null check (length(trim(label)) between 2 and 80),
  sales_tax_pct numeric(5,2) not null check (sales_tax_pct >= 0 and sales_tax_pct <= 100),
  active        boolean not null default true,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);

-- What a customer tells us about itself for its tax invoices. Empty until it fills it in; no tax is charged without a rule.
create table if not exists public.org_tax (
  tenant_id           uuid primary key references public.tenants(id) on delete cascade,
  tax_rule_code       text references public.tax_rules(code),
  legal_name          text check (legal_name is null or length(legal_name) <= 160),
  ntn                 text check (ntn is null or ntn ~ '^[0-9A-Za-z-]{5,20}$'),
  strn                text check (strn is null or strn ~ '^[0-9A-Za-z-]{3,30}$'),
  address             text check (address is null or length(address) <= 300),
  withholding_agent   boolean not null default false,
  -- the operator sets these for a customer whose withholding differs from the platform default (filer or not, kind of service)
  wht_income_pct      numeric(5,2) check (wht_income_pct is null or (wht_income_pct >= 0 and wht_income_pct <= 100)),
  wht_sales_share_pct numeric(5,2) check (wht_sales_share_pct is null or (wht_sales_share_pct >= 0 and wht_sales_share_pct <= 100)),
  updated_at          timestamptz not null default now(),
  updated_by          uuid
);

-- The tax figures an invoice was made with. All null for an invoice made without tax (customers outside Pakistan, or before this was set up).
alter table public.invoices add column if not exists pkr_per_usd       numeric(12,4);
alter table public.invoices add column if not exists subtotal_minor    bigint;
alter table public.invoices add column if not exists sales_tax_pct     numeric(5,2);
alter table public.invoices add column if not exists sales_tax_minor   bigint;
alter table public.invoices add column if not exists total_minor       bigint;
alter table public.invoices add column if not exists wht_income_minor  bigint;
alter table public.invoices add column if not exists wht_sales_minor   bigint;
alter table public.invoices add column if not exists net_expected_minor bigint;
alter table public.invoices add column if not exists tax_snapshot      jsonb;      -- seller and buyer details, authority and percentages as they were

-- A withholding customer pays the government part of what it owes us and gives us a certificate for it. Until we hold the
-- certificate we cannot claim that tax back, so each invoice with a withholding amount is listed until one is recorded.
create table if not exists public.invoice_certificates (
  invoice_id     uuid primary key references public.invoices(id),
  certificate_no text not null check (length(trim(certificate_no)) between 1 and 80),
  received_on    date not null,
  note           text check (note is null or length(note) <= 300),
  recorded_by    uuid,
  created_at     timestamptz not null default now()
);

alter table public.tax_rules            enable row level security;
alter table public.org_tax              enable row level security;
alter table public.invoice_certificates enable row level security;
do $$
declare r text; t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['tax_rules', 'org_tax', 'invoice_certificates'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end $$;

drop trigger if exists tax_rules_audit on public.tax_rules;
create trigger tax_rules_audit after insert or update or delete on public.tax_rules for each row execute function public.platform_audit_trigger();
drop trigger if exists org_tax_audit on public.org_tax;
create trigger org_tax_audit after insert or update or delete on public.org_tax for each row execute function public.platform_audit_trigger();
drop trigger if exists invoice_certificates_audit on public.invoice_certificates;
create trigger invoice_certificates_audit after insert or update or delete on public.invoice_certificates for each row execute function public.platform_audit_trigger();
