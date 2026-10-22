-- Plan limits on users, and invitations for workshops. Idempotent.

-- A workshop invitation names the vendor record it will be linked to.
alter table public.invitations add column if not exists vendor_id uuid;

-- ---------- max_users ----------
-- Counted per workspace over active memberships, not counting workshop logins (role 'vendor'). A workspace with no plan,
-- or a plan without max_users, has no limit. Enforced here so no code path can add a member past it.
create or replace function public.membership_plan_guard() returns trigger language plpgsql as $$
declare lim int; used int;
begin
  if new.status <> 'active' or new.role = 'vendor' then return new; end if;
  select (p.limits->>'max_users')::int into lim
    from public.tenant_subscriptions s join public.plans p on p.id = s.plan_id
   where s.tenant_id = new.tenant_id and s.status in ('trial','active');
  if lim is null then return new; end if;
  perform 1 from public.tenants where id = new.tenant_id for update;      -- one at a time, so two accepts cannot both slip in
  select count(*) into used from public.tenant_memberships m
   where m.tenant_id = new.tenant_id and m.status = 'active' and m.role <> 'vendor' and m.user_id <> new.user_id;
  if used >= lim then raise exception 'plan limit: users (%)', lim; end if;
  return new;
end $$;
drop trigger if exists tenant_memberships_plan_guard on public.tenant_memberships;
create trigger tenant_memberships_plan_guard before insert or update of status, role on public.tenant_memberships
  for each row execute function public.membership_plan_guard();

-- Only the server's own connection may call it; Supabase would otherwise expose it through its public API.
revoke all on function public.membership_plan_guard() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.membership_plan_guard() from %I', r);
    end if;
  end loop;
end $$;
