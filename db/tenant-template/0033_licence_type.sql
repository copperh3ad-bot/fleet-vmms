-- Tenant migration 0033: a driving licence is a full one or a learner's permit, and a company chooses whether it accepts learner permits (ADR-055). Idempotent.
alter table driver_licences add column if not exists licence_type text not null default 'full' check (licence_type in ('full', 'learner'));

-- The settings guard must know the new key BEFORE it is inserted.
create or replace function settings_guard() returns trigger language plpgsql as $$
begin
  if new.key = 'doc_reminder_days' then
    if new.value !~ '^[0-9]+(,[0-9]+)*$' then raise exception 'doc_reminder_days must look like 60,30,14'; end if;
  elsif new.key = 'module_trips' then
    if new.value not in ('0','1') then raise exception 'module_trips must be 0 or 1'; end if;
  elsif new.key = 'odometer_whatsapp' then
    if new.value not in ('0','1') then raise exception 'odometer_whatsapp must be 0 or 1'; end if;
  elsif new.key = 'allow_learner_licence' then
    if new.value not in ('0','1') then raise exception 'allow_learner_licence must be 0 or 1'; end if;
  elsif new.key = 'odometer_send_day' then
    if new.value !~ '^[0-9]+$' or new.value::int not between 1 and 28 then raise exception 'odometer_send_day must be a day from 1 to 28'; end if;
  elsif new.key = 'dept_approval_limit' then
    if new.value <> '' and new.value !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'dept_approval_limit must be a number or empty'; end if;
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

insert into settings(key, value) values ('allow_learner_licence', '0') on conflict (key) do nothing;
