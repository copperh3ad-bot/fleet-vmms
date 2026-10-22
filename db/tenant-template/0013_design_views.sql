-- Tenant migration 0013: numbers the design screens show that were not computed anywhere yet. Idempotent.

-- Workshop scorecard (dashboard, review screen): for work finished in the last p_days days,
--  avg_days          how long from "vendor assigned" to "work done"
--  quote_vs_bill_pct how far the latest invoice was above (+) or below (-) the approved amount, on average
--  rework_pct        share of that workshop's jobs where the same fault came back inside the repeat window
create or replace function workshop_scorecard(p_days int default 90)
returns table (vendor_id uuid, name text, jobs int, avg_days numeric, quote_vs_bill_pct numeric, rework_pct numeric)
language sql stable as $$
  with done as (
    select wo.id as wo_id, wo.job_card_id, wo.vendor_id, wo.approved_amount, wo.completed_at,
           (select min(e.created_at) from job_card_events e where e.job_card_id = wo.job_card_id and e.to_status = 'vendor_assigned') as assigned_at
      from work_orders wo
     where wo.status = 'completed' and wo.completed_at >= now() - make_interval(days => p_days)
  )
  select v.id, v.name, count(*)::int,
         round(avg(extract(epoch from (d.completed_at - d.assigned_at)) / 86400.0)::numeric, 1),
         round(avg(case when d.approved_amount > 0 then (i.amount - d.approved_amount) / d.approved_amount * 100 end)::numeric, 0),
         round(100.0 * count(*) filter (where exists (select 1 from flag_repeat_days r where r.previous_job_card_id = d.job_card_id)) / count(*), 0)
    from done d
    join vendors v on v.id = d.vendor_id
    left join lateral (select amount from invoices where work_order_id = d.wo_id and status in ('submitted','verified','paid') order by invoice_date desc limit 1) i on true
   group by v.id, v.name
   order by count(*) desc, v.name
$$;

-- The budget that applies to a vehicle today, with what has been spent against it.
create or replace view v_vehicle_budget_now as
select u.vehicle_id, u.budget_id, u.period_start, u.period_end, u.budget, u.spent, u.pct_used, u.over_budget
  from v_budget_utilisation u
 where u.vehicle_id is not null and current_date between u.period_start and u.period_end;

-- The whole-fleet budget that applies today, and the share of it that is one month's worth.
create or replace view v_fleet_budget_now as
select u.budget_id, u.period_start, u.period_end, u.budget, u.spent, u.pct_used,
       round(u.budget / greatest(1, extract(year from age(u.period_end + 1, u.period_start)) * 12 + extract(month from age(u.period_end + 1, u.period_start))), 0) as monthly_budget
  from v_budget_utilisation u
 where u.vehicle_id is null and current_date between u.period_start and u.period_end;
