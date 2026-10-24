-- Control-plane migration 0011: sign-in names for people who have no email (ADR-025). Idempotent.
-- Supabase Auth signs people in by email, so a person invited without an email gets a made-up address that nothing is ever sent to
-- (login_email), and signs in with a short name instead (username). This table is the only place that links the two. It is global
-- because a name must find exactly one person whichever company they belong to. The application is its only client: row security
-- is on and the public API roles hold no privileges.
create table if not exists public.login_names (
  username      text primary key check (username ~ '^[a-z0-9][a-z0-9._-]{2,29}$'),
  user_id       uuid not null unique,
  login_email   text not null unique,
  invitation_id uuid,                 -- the invitation that made it, so a half-finished set-up can be retried by the same link
  created_at    timestamptz not null default now()
);

alter table public.login_names enable row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table public.login_names from %I', r); end if;
  end loop;
end $$;
