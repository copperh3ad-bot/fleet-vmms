-- Control-plane migration 0005: the company code (ADR-016). Idempotent.
-- A company turns on a code; a person or a workshop who knows it can ask to join. Only the registry (here) maps a code to a
-- company; the requests themselves live with the company (db/public 0009). The index below lets a person who has asked see,
-- after signing in, that the request is waiting, without searching every company.
alter table public.tenants add column if not exists join_code text;
do $$ begin
  alter table public.tenants drop constraint if exists tenants_join_code_check;
  alter table public.tenants add constraint tenants_join_code_check check (join_code is null or join_code ~ '^[A-HJ-NP-Z2-9]{10}$');
end $$;
create unique index if not exists tenants_join_code_uq on public.tenants(join_code) where join_code is not null;

create table if not exists public.join_index (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null,
  email      text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, request_id)
);
create index if not exists join_index_email_idx on public.join_index(lower(email));

alter table public.join_index enable row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table public.join_index from %I', r); end if;
  end loop;
end $$;
