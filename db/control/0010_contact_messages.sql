-- Control-plane migration 0010: messages from the public Contact us page (ADR-021). Idempotent.
-- Anyone can leave a message, so the table holds only what the person typed and a status. It is read and marked handled by the
-- operator through the application; the public API roles have no access (row security on, privileges revoked).
create table if not exists public.contact_messages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 2 and 120),
  email      text not null check (char_length(email) between 5 and 200),
  company    text check (company is null or char_length(company) <= 120),
  topic      text not null check (topic in ('sales', 'support', 'billing', 'other')),
  message    text not null check (char_length(message) between 10 and 2000),
  status     text not null default 'new' check (status in ('new', 'handled')),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid
);
create index if not exists contact_messages_status_idx on public.contact_messages(status, created_at desc);

alter table public.contact_messages enable row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table public.contact_messages from %I', r); end if;
  end loop;
end $$;
