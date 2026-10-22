-- Tenant migration 0012: plan limit on vehicles. Idempotent.
-- Limits live on the plan (public.plans.limits, no prices). No plan, or a plan without the key, means no limit.

create or replace function plan_limit(p_key text) returns int language sql stable as $$
  select (p.limits->>p_key)::int
    from public.tenant_subscriptions s
    join public.plans p on p.id = s.plan_id
    join public.tenants t on t.id = s.tenant_id
   where t.schema_name = current_schema() and s.status in ('trial','active')
$$;

-- Vehicles that are sold or scrapped ('disposed') do not count against the limit.
create or replace function vehicle_plan_guard() returns trigger language plpgsql as $$
declare lim int;
begin
  lim := plan_limit('max_vehicles');
  if lim is null then return new; end if;
  perform 1 from public.tenants where schema_name = current_schema() for update;     -- one at a time, so a CSV import and a hand entry cannot both slip in
  if (select count(*) from vehicles where status <> 'disposed') >= lim then
    raise exception 'plan limit: vehicles (%)', lim;
  end if;
  return new;
end $$;
drop trigger if exists vehicles_plan_guard on vehicles;
create trigger vehicles_plan_guard before insert on vehicles for each row execute function vehicle_plan_guard();
