-- Platform migration 0007: who changed whose access. Idempotent.
-- Tenant tables write to their own audit_log; role, scope and status changes and invitations live in public tables, so
-- they get a platform log. Append-only, never readable through Supabase's public API, and an invitation's token hash is
-- never copied into it.
create table if not exists public.platform_audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  table_name text not null,
  action     text not null,
  tenant_id  uuid,
  row_id     text,
  actor_id   uuid,
  old_data   jsonb,
  new_data   jsonb
);
create index if not exists platform_audit_log_tenant_idx on public.platform_audit_log(tenant_id, at desc);
alter table public.platform_audit_log enable row level security;

revoke all on table public.platform_audit_log from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.platform_audit_log from %I', r);
      execute format('revoke all on sequence public.platform_audit_log_id_seq from %I', r);
    end if;
  end loop;
end $$;

create or replace function public.platform_audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'platform_audit_log is append-only'; end $$;
drop trigger if exists platform_audit_log_no_change on public.platform_audit_log;
create trigger platform_audit_log_no_change before update or delete on public.platform_audit_log
  for each row execute function public.platform_audit_immutable();

create or replace function public.platform_audit_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare o jsonb; n jsonb; actor uuid;
begin
  o := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'token_hash' end;
  n := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'token_hash' end;
  begin actor := nullif(current_setting('app.user_id', true), '')::uuid;
  exception when others then actor := null; end;
  insert into public.platform_audit_log(table_name, action, tenant_id, row_id, actor_id, old_data, new_data)
  values (tg_table_name, tg_op, coalesce((n->>'tenant_id')::uuid, (o->>'tenant_id')::uuid),
          coalesce(n->>'id', o->>'id', n->>'user_id', o->>'user_id'), actor, o, n);
  return null;
end $$;
revoke all on function public.platform_audit_trigger() from public;

drop trigger if exists tenant_memberships_audit on public.tenant_memberships;
create trigger tenant_memberships_audit after insert or update or delete on public.tenant_memberships
  for each row execute function public.platform_audit_trigger();
drop trigger if exists invitations_audit on public.invitations;
create trigger invitations_audit after insert or update or delete on public.invitations
  for each row execute function public.platform_audit_trigger();
