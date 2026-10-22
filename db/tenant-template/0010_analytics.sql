-- Tenant migration 0010: flag rules and the views behind "Why it keeps breaking". Idempotent.
-- Thresholds come from settings (flag_jobs_90d, flag_repeat_days, flag_cost_multiple, budget_warn_pct, budget_flag_pct).
-- Costs are what v_vehicle_job_cost says: the payable invoice amount once verified, otherwise the estimate lines.

create or replace function setting_num(p_key text, p_default numeric) returns numeric language sql stable as $$
  select coalesce((select value::numeric from settings where key = p_key), p_default)
$$;

-- Repeat repair: same vehicle, same reason, within flag_repeat_days of the previous job. Routine scheduled service
-- is expected to come back, so it never counts. Columns are appended to the 0001 view, so old readers still work.
create or replace view v_repeat_repairs as
select x.job_card_id, x.vehicle_id, x.reason_code_id, x.created_at, x.since_previous,
       (x.since_previous is not null
        and rc.category <> 'scheduled_service'
        and x.since_previous <= (setting_num('flag_repeat_days', 60)::int || ' days')::interval) as is_repeat,
       x.previous_job_card_id
from (
  select c.job_card_id, c.vehicle_id, c.reason_code_id, c.created_at,
         c.created_at - lag(c.created_at) over w as since_previous,
         lag(c.job_card_id) over w as previous_job_card_id
    from v_vehicle_job_cost c
  window w as (partition by c.vehicle_id, c.reason_code_id order by c.created_at, c.job_card_id)
) x join reason_codes rc on rc.id = x.reason_code_id;

-- Too many jobs in the last 90 days.
create or replace view flag_jobs_90d as
select s.vehicle_id, s.registration_no, s.jobs_last_90d as jobs, setting_num('flag_jobs_90d', 3)::int as threshold
from v_vehicle_maintenance_summary s join vehicles v on v.id = s.vehicle_id
where v.status in ('active','in_workshop') and s.jobs_last_90d >= setting_num('flag_jobs_90d', 3);

-- The same fault came back inside the window.
create or replace view flag_repeat_days as
select r.job_card_id, r.previous_job_card_id, r.vehicle_id, v.registration_no, r.reason_code_id, rc.label as reason,
       r.created_at, extract(day from r.since_previous)::int as days_since, setting_num('flag_repeat_days', 60)::int as threshold
from v_repeat_repairs r
join vehicles v on v.id = r.vehicle_id
join reason_codes rc on rc.id = r.reason_code_id
where r.is_repeat;

-- Cost over the last 12 months is a multiple of the median for the same make and model. Needs at least 3 vehicles of
-- that make and model, otherwise there is nothing fair to compare with.
create or replace view flag_cost_multiple as
with cost as (
  select v.id as vehicle_id, v.registration_no, v.make, v.model, coalesce(sum(c.cost), 0) as cost_12m
    from vehicles v
    left join v_vehicle_job_cost c on c.vehicle_id = v.id and c.created_at > now() - interval '12 months'
   where v.status in ('active','in_workshop')
   group by v.id
), peers as (
  select lower(make) as mk, lower(model) as md, count(*) as peers,
         (percentile_cont(0.5) within group (order by cost_12m))::numeric as median
    from cost where make is not null and model is not null
   group by 1, 2
)
select c.vehicle_id, c.registration_no, c.make, c.model, c.cost_12m, p.median as peer_median, p.peers::int as peers,
       round(c.cost_12m / p.median, 1) as multiple, setting_num('flag_cost_multiple', 2.0) as threshold
from cost c
join peers p on p.mk = lower(c.make) and p.md = lower(c.model)
where p.peers >= 3 and p.median > 0 and c.cost_12m >= p.median * setting_num('flag_cost_multiple', 2.0);

-- Everything that deserves a look, one row per flag. vehicle_id is null for a fleet-wide budget.
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
 where v.status in ('active','in_workshop') and d.doc_status in ('expired','due_30');
