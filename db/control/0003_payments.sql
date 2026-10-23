-- Control-plane migration 0003: paying by bank transfer (ADR-014). Runs on the control database only. Idempotent.
--
-- The organization tells us it has paid (a claim, with the receipt). An operator checks the bank and confirms or rejects
-- it. Confirming records an invoice and moves the paid-until date forward. Nothing here is charged automatically.

create sequence if not exists public.invoice_number_seq;

create table if not exists public.payment_claims (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  submitted_by    uuid not null,
  amount_minor    bigint not null check (amount_minor > 0),            -- what was sent, in the smallest unit of `currency`
  currency        text not null check (currency ~ '^[A-Z]{3}$'),
  paid_on         date not null,
  bank_reference  text not null check (length(bank_reference) between 1 and 80),
  months          int not null default 1 check (months between 1 and 12),
  note            text check (note is null or length(note) <= 500),
  proof_path      text check (proof_path is null or proof_path ~ '^tenant_[a-z0-9_]{1,50}/billing/'),   -- inside the organization's own folder of the file bucket
  status          text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text check (decision_note is null or length(decision_note) <= 500),
  invoice_id      uuid,
  created_at      timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null))
);
-- One claim waiting at a time per organization; they send the next after this one is decided.
create unique index if not exists payment_claims_one_pending on public.payment_claims(tenant_id) where status = 'pending';
create index if not exists payment_claims_status_idx on public.payment_claims(status, created_at);

create table if not exists public.invoices (
  id             uuid primary key default gen_random_uuid(),
  number         text not null unique,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  claim_id       uuid unique references public.payment_claims(id),
  billed_to      text not null,                                       -- the organization's name when it was issued
  period_start   date not null,
  period_end     date not null,
  months         int not null check (months between 1 and 12),
  amount_cents   bigint not null check (amount_cents >= 0),           -- the subscription price for those months
  currency       text not null,
  received_minor bigint,                                              -- what actually arrived, if different
  received_currency text,
  issued_at      timestamptz not null default now(),
  issued_by      uuid,
  note           text
);
create index if not exists invoices_tenant_idx on public.invoices(tenant_id, issued_at desc);
do $$ begin
  alter table public.payment_claims drop constraint if exists payment_claims_invoice_fk;
  alter table public.payment_claims add constraint payment_claims_invoice_fk foreign key (invoice_id) references public.invoices(id);
end $$;

-- Which reminders were already sent, so a daily job never sends one twice.
create table if not exists public.billing_reminders (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key       text not null,
  sent_at   timestamptz not null default now(),
  primary key (tenant_id, key)
);

alter table public.payment_claims    enable row level security;
alter table public.invoices          enable row level security;
alter table public.billing_reminders enable row level security;
do $$
declare r text; t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['payment_claims', 'invoices', 'billing_reminders'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
      execute format('revoke all on sequence public.invoice_number_seq from %I', r);
    end if;
  end loop;
end $$;

-- Money and access changes are written to the platform audit log.
drop trigger if exists payment_claims_audit on public.payment_claims;
create trigger payment_claims_audit after insert or update or delete on public.payment_claims
  for each row execute function public.platform_audit_trigger();
drop trigger if exists invoices_audit on public.invoices;
create trigger invoices_audit after insert or update or delete on public.invoices
  for each row execute function public.platform_audit_trigger();

-- Invoices are a record: they are not edited or removed once issued.
create or replace function public.invoices_immutable() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'invoices cannot be changed or deleted'; end $$;
revoke all on function public.invoices_immutable() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on function public.invoices_immutable() from %I', r); end if;
  end loop;
end $$;
drop trigger if exists invoices_no_change on public.invoices;
create trigger invoices_no_change before update or delete on public.invoices for each row execute function public.invoices_immutable();
