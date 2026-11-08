-- Control-plane migration 0021: one log of what the software did (ADR-070). Idempotent.
--
-- Every action a person takes, every sign-in and refusal, every webhook, every background job and every error the server could not handle is one row here: who, where,
-- what, whether it worked, how long it took, and (for an error) what kind. The change to a company's own data is still written by the audit triggers in that
-- company's schema (audit_log); this table says what was asked and what came of it, so an investigation can start from either end.
--
-- It holds no password, token, code, message text or file. Append-only: a row can be neither changed nor deleted, except by purge_activity_log() after the retention period.
-- Never readable through Supabase's public API.

create table if not exists public.activity_log (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  kind          text not null check (kind in ('action', 'page', 'auth', 'security', 'webhook', 'job', 'error', 'billing', 'system')),
  name          text not null,
  outcome       text not null check (outcome in ('ok', 'denied', 'invalid', 'error', 'info')),
  actor_id      uuid,
  /** who it was when nobody was signed in yet: the email or sign-in name typed at the sign-in or sign-up form */
  subject       text,
  tenant_id     uuid,
  role          text,
  request_id    text,
  path          text,
  method        text,
  status        integer,
  duration_ms   integer,
  ip            text,
  user_agent    text,
  error_class   text,
  error_message text,
  error_digest  text,
  details       jsonb
);
create index if not exists activity_log_at_idx      on public.activity_log(at desc);
create index if not exists activity_log_tenant_idx  on public.activity_log(tenant_id, at desc);
create index if not exists activity_log_actor_idx   on public.activity_log(actor_id, at desc);
create index if not exists activity_log_kind_idx    on public.activity_log(kind, name, at desc);
create index if not exists activity_log_problem_idx on public.activity_log(at desc) where outcome in ('denied', 'error');
create index if not exists activity_log_request_idx on public.activity_log(request_id);

alter table public.activity_log enable row level security;

revoke all on table public.activity_log from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.activity_log from %I', r);
      execute format('revoke all on sequence public.activity_log_id_seq from %I', r);
    end if;
  end loop;
end $$;

-- Append-only. The only way a row goes is purge_activity_log() below, which says so with a setting that lasts one transaction.
create or replace function public.activity_log_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then raise exception 'the activity log cannot be changed'; end if;
  if tg_op = 'DELETE' and coalesce(current_setting('app.activity_purge', true), '') <> 'on' then raise exception 'the activity log cannot be deleted from'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists activity_log_guard on public.activity_log;
create trigger activity_log_guard before update or delete on public.activity_log for each row execute function public.activity_log_guard();

-- Clears rows older than the retention period. At least 30 days are always kept. Returns how many went.
create or replace function public.purge_activity_log(keep_days integer) returns bigint
language plpgsql set search_path = public, pg_temp as $$
declare n bigint;
begin
  if keep_days is null or keep_days < 30 then raise exception 'keep at least 30 days of the activity log'; end if;
  perform set_config('app.activity_purge', 'on', true);
  delete from public.activity_log where at < now() - make_interval(days => keep_days);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.purge_activity_log(integer) from public;
