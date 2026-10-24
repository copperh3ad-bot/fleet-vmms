-- Control-plane migration 0007 (ADR-018). Idempotent.
--   1. the customer's country, and tax scenarios the owner configures (which tax applies to which customers)
--   2. an internal ledger (chart of accounts, journals) that the subscription business posts into
--   3. withholding certificates the application issues for Pakistani customers

-- ------------------------------------------------------------------ country and scenarios
alter table public.signups add column if not exists country text;
alter table public.org_tax add column if not exists country text;
do $$ begin
  alter table public.signups drop constraint if exists signups_country_check;
  alter table public.signups add constraint signups_country_check check (country is null or country ~ '^[A-Z]{2}$');
  alter table public.org_tax drop constraint if exists org_tax_country_check;
  alter table public.org_tax add constraint org_tax_country_check check (country is null or country ~ '^[A-Z]{2}$');
end $$;

-- A scenario says what tax a customer gets, chosen by the customer's country. The owner adds and changes them; the two below
-- are only the starting point. Customers in a listed country take the first matching scenario by priority; a scenario with no
-- country list matches every country, so give it the largest priority number to make it the fallback.
create table if not exists public.tax_scenarios (
  code                text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  label               text not null check (length(trim(label)) between 2 and 80),
  priority            int not null default 100 check (priority between 1 and 100000),
  countries           text[] check (countries is null or (cardinality(countries) between 1 and 250 and array_to_string(countries, ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$')),
  sales_tax_mode      text not null check (sales_tax_mode in ('none', 'authority', 'fixed')),   -- none | the rate of the authority the customer chooses | one rate set here
  sales_tax_pct       numeric(5,2) check (sales_tax_pct is null or (sales_tax_pct >= 0 and sales_tax_pct <= 100)),
  tax_name            text check (tax_name is null or length(tax_name) <= 30),                   -- "VAT", "GST"
  currency            text not null default 'USD' check (currency in ('USD', 'PKR')),            -- PKR: the price is converted at the rate in Settings and tax is worked out in rupees
  withholding_allowed boolean not null default false,
  seller_registration text check (seller_registration is null or length(seller_registration) <= 40),   -- the seller's registration where this scenario applies, for "fixed"
  document_title      text not null default 'Invoice' check (length(document_title) between 2 and 40),
  note                text check (note is null or length(note) <= 300),                          -- printed on the invoice
  active              boolean not null default true,
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  check (sales_tax_mode <> 'fixed' or sales_tax_pct is not null)
);
insert into public.tax_scenarios(code, label, priority, countries, sales_tax_mode, currency, withholding_allowed, document_title, note) values
  ('PK_DOMESTIC', 'Customers in Pakistan', 10, array['PK'], 'authority', 'PKR', true, 'Tax invoice', null),
  ('OUTSIDE_PK', 'Customers outside Pakistan (no tax)', 100000, null, 'none', 'USD', false, 'Invoice', 'No tax is charged on this invoice.')
on conflict (code) do nothing;

-- ------------------------------------------------------------------ the ledger
create table if not exists public.acct_accounts (
  code       text primary key check (code ~ '^[0-9A-Z]{2,12}$'),
  name       text not null check (length(trim(name)) between 2 and 80),
  kind       text not null check (kind in ('asset', 'liability', 'income', 'expense', 'equity')),
  system_key text unique check (system_key is null or system_key in ('BANK', 'REVENUE', 'SALES_TAX', 'WHT_INCOME', 'WHT_SALES', 'DIFFERENCE')),   -- the role the application posts to
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.acct_accounts(code, name, kind, system_key) values
  ('1000', 'Bank', 'asset', 'BANK'),
  ('1200', 'Income tax withheld by customers (recoverable)', 'asset', 'WHT_INCOME'),
  ('1210', 'Sales tax withheld by customers (recoverable)', 'asset', 'WHT_SALES'),
  ('2200', 'Sales tax payable', 'liability', 'SALES_TAX'),
  ('4000', 'Subscription revenue', 'income', 'REVENUE'),
  ('5900', 'Short and over payments', 'expense', 'DIFFERENCE')
on conflict (code) do nothing;

create sequence if not exists public.acct_journal_seq;
create table if not exists public.acct_journals (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique,
  posted_at   timestamptz not null default now(),
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  source_kind text not null check (source_kind in ('invoice', 'manual', 'reversal')),
  source_id   uuid,
  memo        text not null check (length(trim(memo)) between 3 and 300),
  created_by  uuid,
  reverses    uuid references public.acct_journals(id)
);
-- an invoice is posted once
create unique index if not exists acct_journals_invoice_uq on public.acct_journals(source_id) where source_kind = 'invoice';
create unique index if not exists acct_journals_reverses_uq on public.acct_journals(reverses) where reverses is not null;

create table if not exists public.acct_lines (
  id           bigserial primary key,
  journal_id   uuid not null references public.acct_journals(id),
  account_code text not null references public.acct_accounts(code),
  debit_minor  bigint not null default 0 check (debit_minor >= 0),
  credit_minor bigint not null default 0 check (credit_minor >= 0),
  check (debit_minor = 0 or credit_minor = 0),
  check (debit_minor + credit_minor > 0)
);
create index if not exists acct_lines_journal_idx on public.acct_lines(journal_id);
create index if not exists acct_lines_account_idx on public.acct_lines(account_code);

-- Every journal balances, checked when the transaction ends so its lines can be added one by one.
create or replace function public.acct_check_balanced() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare d bigint; c bigint;
begin
  select coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0) into d, c from public.acct_lines where journal_id = new.journal_id;
  if d <> c then raise exception 'journal does not balance: debits % credits %', d, c; end if;
  return null;
end $$;
drop trigger if exists acct_lines_balanced on public.acct_lines;
create constraint trigger acct_lines_balanced after insert on public.acct_lines deferrable initially deferred for each row execute function public.acct_check_balanced();

-- Journals are a record. A mistake is corrected by a reversing journal, never by an edit.
create or replace function public.acct_immutable() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'ledger entries cannot be changed or deleted; post a reversal'; end $$;
drop trigger if exists acct_journals_no_change on public.acct_journals;
create trigger acct_journals_no_change before update or delete on public.acct_journals for each row execute function public.acct_immutable();
drop trigger if exists acct_lines_no_change on public.acct_lines;
create trigger acct_lines_no_change before update or delete on public.acct_lines for each row execute function public.acct_immutable();

-- ------------------------------------------------------------------ withholding certificates issued by the application
create sequence if not exists public.wht_certificate_seq;
create table if not exists public.wht_certificates (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,
  invoice_id       uuid not null references public.invoices(id),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  issued_by        uuid not null,
  issued_by_kind   text not null check (issued_by_kind in ('customer', 'operator')),
  agent            jsonb not null,                                   -- who withheld: name, NTN, address, as on the invoice
  payee            jsonb not null,                                   -- who was paid: the seller
  currency         text not null default 'PKR',
  gross_minor      bigint not null check (gross_minor >= 0),         -- the amount the tax was withheld from (the subtotal, or the total, as the invoice says)
  income_tax_pct   numeric(5,2),
  income_tax_minor bigint not null default 0 check (income_tax_minor >= 0),
  sales_tax_minor  bigint not null default 0 check (sales_tax_minor >= 0),
  section          text check (section is null or length(section) <= 120),
  deposit_reference text check (deposit_reference is null or length(deposit_reference) <= 80),   -- the challan or payment slip the tax was deposited with
  deposit_date     date,
  note             text check (note is null or length(note) <= 300),
  status           text not null default 'issued' check (status in ('issued', 'void')),
  void_reason      text check (void_reason is null or length(void_reason) <= 300),
  voided_at        timestamptz,
  issued_at        timestamptz not null default now(),
  check (income_tax_minor + sales_tax_minor > 0)
);
create index if not exists wht_certificates_tenant_idx on public.wht_certificates(tenant_id, issued_at desc);
-- one live certificate per invoice; a voided one can be replaced
create unique index if not exists wht_certificates_one_issued on public.wht_certificates(invoice_id) where status = 'issued';

-- Only the voiding can change: everything else is fixed once issued.
create or replace function public.wht_certificates_guard() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then raise exception 'certificates cannot be deleted; void them'; end if;
  if old.status = 'void' then raise exception 'a void certificate cannot be changed'; end if;
  if (to_jsonb(new) - 'status' - 'void_reason' - 'voided_at') is distinct from (to_jsonb(old) - 'status' - 'void_reason' - 'voided_at') then
    raise exception 'an issued certificate cannot be edited; void it and issue a new one';
  end if;
  return new;
end $$;
drop trigger if exists wht_certificates_guard_trg on public.wht_certificates;
create trigger wht_certificates_guard_trg before update or delete on public.wht_certificates for each row execute function public.wht_certificates_guard();

-- ------------------------------------------------------------------ access
alter table public.tax_scenarios   enable row level security;
alter table public.acct_accounts   enable row level security;
alter table public.acct_journals   enable row level security;
alter table public.acct_lines      enable row level security;
alter table public.wht_certificates enable row level security;
do $$
declare r text; t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['tax_scenarios', 'acct_accounts', 'acct_journals', 'acct_lines', 'wht_certificates'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
      foreach t in array array['acct_journal_seq', 'wht_certificate_seq', 'acct_lines_id_seq'] loop
        execute format('revoke all on sequence public.%I from %I', t, r);
      end loop;
      foreach t in array array['acct_check_balanced', 'acct_immutable', 'wht_certificates_guard'] loop
        execute format('revoke all on function public.%I() from %I', t, r);
      end loop;
    end if;
  end loop;
end $$;
revoke all on function public.acct_check_balanced() from public;
revoke all on function public.acct_immutable() from public;
revoke all on function public.wht_certificates_guard() from public;

drop trigger if exists tax_scenarios_audit on public.tax_scenarios;
create trigger tax_scenarios_audit after insert or update or delete on public.tax_scenarios for each row execute function public.platform_audit_trigger();
drop trigger if exists acct_accounts_audit on public.acct_accounts;
create trigger acct_accounts_audit after insert or update or delete on public.acct_accounts for each row execute function public.platform_audit_trigger();
drop trigger if exists wht_certificates_audit on public.wht_certificates;
create trigger wht_certificates_audit after insert or update or delete on public.wht_certificates for each row execute function public.platform_audit_trigger();
