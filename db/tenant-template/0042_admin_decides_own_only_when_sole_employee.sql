-- Tenant migration 0042: the administrator decides their own job card, quotation or invoice check only when they are the only employee (ADR-077). Idempotent.
--
-- Owner decision 2026-11-09: the tenant administrator handles settings, sign-in and onboarding. Their own job card is approved by a Fleet manager. Only a company in which the
-- administrator is the only active employee lets them decide their own work, so a one-person company is not stuck. Migrations 0038, 0040 and 0041 asked instead whether anyone
-- else held the permission (and could decide that card); a company with other employees but no approver let the administrator through. It no longer does.
--
-- "Employee" means any other active member of the organization who is not a workshop (a workshop is an outside party, ADR-033). An invited person who has not joined is not
-- a member yet and does not count; a disabled member does not count.

create or replace function admin_may_decide_own(p_permission text, p_vehicle uuid, p_amount numeric) returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('app.role', true), ''), '') = 'tenant_admin'
     and not exists (
       select 1 from public.tenant_memberships m
        where m.tenant_id = (select t.id from public.tenants t where t.schema_name = current_schema())
          and m.status = 'active'
          and m.role <> 'vendor'
          and m.user_id::text is distinct from nullif(current_setting('app.user_id', true), ''))
$$;

-- The one-argument form stays for callers without a card in hand; it gives the same answer now.
create or replace function admin_may_decide_own(p_permission text) returns boolean language sql stable as $$
  select admin_may_decide_own(p_permission, null::uuid, null::numeric)
$$;

revoke execute on function admin_may_decide_own(text) from public;
revoke execute on function admin_may_decide_own(text, uuid, numeric) from public;
