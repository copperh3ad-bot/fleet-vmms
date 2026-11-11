-- Tenant migration 0056: owner decisions C2 to C4 of 2026-11-11 (docs/OWNER-DECISIONS-2026-11-11.md). Idempotent.
--  C4 the Fleet Manager rates and flags workshops (permission vendor.rate, table vendor_ratings); the scorecard counts the last 12 months;
--  C3 a quotation more than quote_over_estimate_pct (default 10) above the job card's estimate, or one that would take the vehicle over its budget,
--     can be approved only with a written reason (checked in the service; the percentage is a company setting).

insert into permissions(key, description) values ('vendor.rate', 'Rate and flag workshops (feeds the workshop scorecard)') on conflict (key) do nothing;
insert into role_permissions(role_key, permission_key)
select r, p from (values ('fleet_manager','vendor.rate'),('tenant_admin','vendor.rate')) as x(r, p) on conflict do nothing;

create table if not exists vendor_ratings (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references vendors(id),
  job_card_id uuid references job_cards(id),
  stars       int not null check (stars between 1 and 5),
  flagged     boolean not null default false,
  note        text check (note is null or length(note) <= 500),
  rated_by    uuid,
  created_at  timestamptz not null default now(),
  check (not flagged or (note is not null and length(trim(note)) >= 5))   -- a flag needs a reason
);
create index if not exists vendor_ratings_vendor_idx on vendor_ratings(vendor_id, created_at desc);

drop trigger if exists vendor_ratings_audit on vendor_ratings;
create trigger vendor_ratings_audit after insert or update or delete on vendor_ratings
  for each row execute function audit_trigger();

-- Setting guard (from 0054) with the new key.
create or replace function settings_guard() returns trigger language plpgsql as $$
begin
  if new.key = 'doc_reminder_days' then
    if new.value !~ '^[0-9]+(,[0-9]+)*$' then raise exception 'doc_reminder_days must look like 60,30,14'; end if;
  elsif new.key in ('module_trips','odometer_whatsapp','allow_learner_licence','admin_decides_others') then
    if new.value not in ('0','1') then raise exception '% must be 0 or 1', new.key; end if;
  elsif new.key = 'odometer_send_day' then
    if new.value !~ '^[0-9]+$' or new.value::int not between 1 and 28 then raise exception 'odometer_send_day must be a day from 1 to 28'; end if;
  elsif new.key in ('dept_approval_limit','payment_approval_limit') then
    if new.value <> '' and new.value !~ '^[0-9]+(\.[0-9]+)?$' then raise exception '% must be a number or empty', new.key; end if;
  elsif new.key in ('invoice_over_quote_pct','quote_over_estimate_pct') then
    if new.value !~ '^[0-9]+(\.[0-9]+)?$' or new.value::numeric > 1000 then raise exception '% must be a number up to 1000', new.key; end if;
  elsif new.key in ('pm_warning_days','pm_warning_km','pm_warning_hours','odometer_max_km_per_day','odometer_stale_days','odometer_due_day',
                    'budget_warn_pct','budget_flag_pct','flag_jobs_90d','flag_repeat_days','flag_cost_multiple',
                    'policy_replace_years','policy_free_accidents','policy_accident_gap_months','policy_driver_share_pct') then
    if new.value !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'setting % must be a number', new.key; end if;
    if new.key = 'policy_driver_share_pct' and new.value::numeric > 100 then raise exception 'policy_driver_share_pct cannot be above 100'; end if;
  else
    raise exception 'unknown setting %', new.key;
  end if;
  return new;
end $$;
insert into settings(key, value) values ('quote_over_estimate_pct', '10') on conflict (key) do nothing;
