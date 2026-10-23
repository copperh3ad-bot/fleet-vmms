-- Tenant migration 0018: the parts of a company's vehicle policy the system can apply, as settings each company tunes.
-- Every rule starts switched off (0), so no company changes behaviour until it chooses. Idempotent.
--   policy_replace_years        flag a vehicle whose model year is this many years back or more (0 = off)
--   policy_free_accidents       accidents per driver the company absorbs (0 = off)
--   policy_accident_gap_months  months that must pass since the driver's previous accident for it to be absorbed
--   policy_driver_share_pct     percent of a repair (not routine service, not an accident) the driver bears (0 = off)
create or replace function settings_guard() returns trigger language plpgsql as $$
begin
  if new.key = 'doc_reminder_days' then
    if new.value !~ '^[0-9]+(,[0-9]+)*$' then raise exception 'doc_reminder_days must look like 60,30,14'; end if;
  elsif new.key in ('pm_warning_days','pm_warning_km','odometer_max_km_per_day','odometer_stale_days','odometer_due_day',
                    'budget_warn_pct','budget_flag_pct','flag_jobs_90d','flag_repeat_days','flag_cost_multiple',
                    'policy_replace_years','policy_free_accidents','policy_accident_gap_months','policy_driver_share_pct') then
    if new.value !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'setting % must be a number', new.key; end if;
    if new.key = 'policy_driver_share_pct' and new.value::numeric > 100 then raise exception 'policy_driver_share_pct cannot be above 100'; end if;
  else
    raise exception 'unknown setting %', new.key;
  end if;
  return new;
end $$;

-- The guard now knows the keys, so the starting values can go in.
insert into settings(key, value) values
  ('policy_replace_years', '0'), ('policy_free_accidents', '0'), ('policy_accident_gap_months', '12'), ('policy_driver_share_pct', '0')
on conflict (key) do nothing;

-- One more flag on the existing list: a vehicle past the replacement age the company set.
create or replace view v_vehicle_flags as
select vehicle_id, registration_no, 'too_many_jobs'::text as flag, 'medium'::text as severity,
       jobs || ' jobs in 90 days (limit ' || threshold || ')' as detail
  from flag_jobs_90d
union all
select vehicle_id, registration_no, 'repeat_repair', 'high',
       count(*) || ' repeat' || case when count(*) > 1 then 's' else '' end || ': ' || string_agg(distinct reason, ', ')
       || ' came back within ' || max(threshold) || ' days'
  from flag_repeat_days group by vehicle_id, registration_no
union all
select vehicle_id, registration_no, 'cost_vs_peers', 'medium',
       multiple || ' times the median of ' || peers || ' similar vehicles over 12 months'
  from flag_cost_multiple
union all
select u.vehicle_id, v.registration_no,
       case when u.pct_used >= setting_num('budget_flag_pct', 100) then 'over_budget' else 'near_budget' end,
       case when u.pct_used >= setting_num('budget_flag_pct', 100) then 'high' else 'medium' end,
       u.pct_used || '% of the budget used'
  from v_budget_utilisation u left join vehicles v on v.id = u.vehicle_id
 where current_date between u.period_start and u.period_end and u.pct_used >= setting_num('budget_warn_pct', 80)
union all
select d.vehicle_id, v.registration_no,
       case when d.doc_status = 'expired' then 'document_expired' else 'document_due' end,
       case when d.doc_status = 'expired' then 'high' else 'medium' end,
       d.doc_type || ' ' || case when d.days_left < 0 then 'expired ' || (-d.days_left) || ' days ago' else 'expires in ' || d.days_left || ' days' end
  from v_documents_status d join vehicles v on v.id = d.vehicle_id
 where v.status in ('active','in_workshop') and d.doc_status in ('expired','due_30')
union all
select v.id, v.registration_no, 'replacement_due', 'medium',
       (extract(year from current_date)::int - v.year) || ' years old (model ' || v.year || '); your policy replaces at ' || setting_num('policy_replace_years', 0)::int
  from vehicles v
 where setting_num('policy_replace_years', 0) > 0 and v.year is not null and v.status in ('active','in_workshop')
   and extract(year from current_date)::int - v.year >= setting_num('policy_replace_years', 0);
