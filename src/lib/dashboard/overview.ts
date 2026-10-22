// The numbers behind the designed dashboard ("Fleet overview"). Needs report.view; the approval queue is included
// only if the member can also approve (CLAUDE.md rule 3). Money is in the workspace currency, shown without decimals.
import type { Driver } from "@/lib/db/types";
import { authorizedAny, type Membership } from "@/lib/auth/can";

export type ApprovalRow = { id: string; job_no: string; vehicle_id: string; registration_no: string; reason: string; requester: string; estimate: number | null; waiting_days: number; repeat: boolean };
export type ServiceDueRow = { vehicle_id: string; registration_no: string; driver: string | null; label: string; days: number | null; km: number | null; status: "overdue" | "due_soon" };
export type CostlyRow = { vehicle_id: string; registration_no: string; spent: number; budget: number | null; pct: number | null };
export type DocRow = { entity_id: string; entity_type: string; vehicle_id: string; registration_no: string; doc_type: string; expires_on: string; days_left: number };
export type ScoreRow = { vendor_id: string; name: string; jobs: number; avg_days: number | null; quote_vs_bill_pct: number | null; rework_pct: number | null };

export type Overview = {
  currency: string;
  asOf: string;
  activeVehicles: number;
  approvals: { count: number; oldestDays: number | null; rows: ApprovalRow[] } | null;
  openCards: { count: number; atWorkshop: number };
  spendMonth: { spent: number; monthlyBudget: number | null; projected: number; pacing: "over" | "ok" | null; pctOverPace: number | null; daysElapsed: number; daysInMonth: number };
  overBudget: number;
  serviceDue: { overdue: number; soon: number; warnDays: number; rows: ServiceDueRow[] };
  docsExpiring: { count: number; rows: DocRow[] };
  spendByMonth: { month: string; cost: number }[];
  costliest: CostlyRow[];
  whyJobs: { category: string; jobs: number; pct: number }[];
  scorecard: ScoreRow[];
};

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export function getOverview(driver: Driver, m: Membership): Promise<Overview> {
  return authorizedAny(driver, m, ["report.view"], async (q, held0) => {
    void held0;
    const canApprove = (await q.query("select 1 from role_permissions where role_key = $1 and permission_key = 'jobcard.approve'", [m.role])).rows.length > 0;
    const one = async <T,>(sql: string, p: unknown[] = []) => (await q.query<T & Record<string, unknown>>(sql, p)).rows;
    const now = new Date();
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const daysElapsed = Math.max(1, now.getUTCDate());

    const currency = (await one<{ currency: string }>("select currency from public.tenants where id = $1", [m.tenantId]))[0]?.currency ?? "";
    const activeVehicles = (await one<{ c: number }>("select count(*)::int c from vehicles where status in ('active','in_workshop')"))[0].c;

    // approvals waiting for this person
    let approvals: Overview["approvals"] = null;
    if (canApprove) {
      const rows = (await one<{ id: string; job_no: string; vehicle_id: string; registration_no: string; reason: string; requester: string; estimate: string | null; waiting_days: number; repeat: boolean }>(
        `select jc.id, jc.job_no, jc.vehicle_id, v.registration_no, rc.label as reason, re.full_name as requester, jc.estimated_cost::text as estimate,
                greatest(0, (current_date - jc.created_at::date))::int as waiting_days,
                exists (select 1 from flag_repeat_days r where r.job_card_id = jc.id) as repeat
           from job_cards jc join vehicles v on v.id = jc.vehicle_id join employees re on re.id = jc.requested_by join reason_codes rc on rc.id = jc.reason_code_id
          where jc.status = 'submitted' and jc.requested_by is distinct from actor_employee($1)
          order by jc.created_at limit 5`, [m.userId])).map((r) => ({ ...r, estimate: r.estimate === null ? null : Number(r.estimate) }));
      const agg = (await one<{ c: number; oldest: number | null }>(
        `select count(*)::int c, max(greatest(0, current_date - created_at::date))::int oldest from job_cards jc where jc.status = 'submitted' and jc.requested_by is distinct from actor_employee($1)`, [m.userId]))[0];
      approvals = { count: agg.c, oldestDays: agg.oldest, rows };
    }

    const open = (await one<{ open: number; workshop: number }>(
      `select count(*)::int as open, count(*) filter (where status in ('vendor_assigned','quotation_received','quotation_approved','in_progress'))::int as workshop
         from job_cards where status not in ('draft','closed','cancelled','rejected')`))[0];

    // spending this month against the monthly share of the fleet budget
    const spent = Number((await one<{ s: string }>("select coalesce(sum(cost), 0)::text as s from v_vehicle_job_cost where created_at >= date_trunc('month', now())"))[0].s);
    const mb = (await one<{ monthly_budget: string }>("select monthly_budget::text from v_fleet_budget_now limit 1"))[0];
    const monthlyBudget = mb ? Number(mb.monthly_budget) : null;
    const projected = (spent / daysElapsed) * daysInMonth;
    const spendMonth = {
      spent, monthlyBudget, projected: Math.round(projected), daysElapsed, daysInMonth,
      pacing: monthlyBudget === null ? null : projected > monthlyBudget ? ("over" as const) : ("ok" as const),
      pctOverPace: monthlyBudget ? Math.round(((projected - monthlyBudget) / monthlyBudget) * 100) : null,
    };

    const overBudget = (await one<{ c: number }>("select count(*)::int c from v_vehicle_budget_now where over_budget"))[0].c;

    const warnDays = Number((await one<{ d: string }>("select setting_num('pm_warning_days', 14)::text as d"))[0].d);
    const due = await one<{ vehicle_id: string; registration_no: string; driver: string | null; label: string; days: number | null; km: string | null; status: "overdue" | "due_soon" }>(
      `select distinct on (p.vehicle_id) p.vehicle_id, p.registration_no, h.full_name as driver, p.label, p.days_remaining::int as days, p.km_remaining::text as km, p.pm_status as status
         from v_pm_status p
         join vehicles v on v.id = p.vehicle_id and v.status in ('active','in_workshop')
         left join vehicle_custody c on c.vehicle_id = p.vehicle_id and c.to_date is null left join employees h on h.id = c.employee_id
        where p.pm_status in ('overdue','due_soon')
        order by p.vehicle_id, case p.pm_status when 'overdue' then 0 else 1 end, coalesce(p.days_remaining, 9999)`);
    due.sort((a, b) => (a.status === b.status ? (a.days ?? 9999) - (b.days ?? 9999) : a.status === "overdue" ? -1 : 1));
    const serviceDue = {
      overdue: due.filter((r) => r.status === "overdue").length, soon: due.filter((r) => r.status === "due_soon").length, warnDays,
      rows: due.slice(0, 5).map((r) => ({ ...r, km: r.km === null ? null : Number(r.km) })),
    };

    const docs = await one<{ entity_id: string; entity_type: string; vehicle_id: string; registration_no: string; doc_type: string; expires_on: string; days_left: number }>(
      `select d.entity_id, d.entity_type, d.vehicle_id, v.registration_no, d.doc_type, d.expires_on::text, d.days_left::int
         from v_documents_status d join vehicles v on v.id = d.vehicle_id
        where v.status in ('active','in_workshop') and d.days_left <= 30 order by d.expires_on`);
    const docsExpiring = { count: docs.length, rows: docs.slice(0, 5) };

    const monthly = await one<{ month: string; cost: string }>(
      `select to_char(date_trunc('month', created_at), 'YYYY-MM') as month, sum(cost)::text as cost from v_vehicle_job_cost
        where created_at >= date_trunc('month', now()) - interval '11 months' group by 1`);
    const spendByMonth: Overview["spendByMonth"] = [];
    for (let i = 11; i >= 0; i--) {
      const key = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)));
      spendByMonth.push({ month: key, cost: Number(monthly.find((r) => r.month === key)?.cost ?? 0) });
    }

    const costliest = (await one<{ vehicle_id: string; registration_no: string; spent: string; budget: string | null; pct: string | null }>(
      `select v.id as vehicle_id, v.registration_no, sum(c.cost)::text as spent, b.budget::text as budget, b.pct_used::text as pct
         from v_vehicle_job_cost c join vehicles v on v.id = c.vehicle_id
         left join v_vehicle_budget_now b on b.vehicle_id = v.id
        where c.created_at >= coalesce((select period_start from v_fleet_budget_now limit 1), date_trunc('year', now()))
        group by v.id, b.budget, b.pct_used order by sum(c.cost) desc limit 5`))
      .map((r) => ({ vehicle_id: r.vehicle_id, registration_no: r.registration_no, spent: Number(r.spent), budget: r.budget === null ? null : Number(r.budget), pct: r.pct === null ? null : Number(r.pct) }));

    const reasons = await one<{ category: string; jobs: number }>(
      `select rc.category, count(*)::int as jobs from v_vehicle_job_cost c join reason_codes rc on rc.id = c.reason_code_id
        where c.created_at >= now() - interval '90 days' group by 1 order by 2 desc, 1`);
    const totalJobs = reasons.reduce((s, r) => s + r.jobs, 0);
    const whyJobs = reasons.slice(0, 6).map((r) => ({ category: r.category, jobs: r.jobs, pct: totalJobs ? Math.round((r.jobs / totalJobs) * 100) : 0 }));

    const scorecard = (await one<{ vendor_id: string; name: string; jobs: number; avg_days: string | null; quote_vs_bill_pct: string | null; rework_pct: string | null }>(
      "select vendor_id, name, jobs, avg_days::text, quote_vs_bill_pct::text, rework_pct::text from workshop_scorecard(90) limit 5"))
      .map((r) => ({ ...r, avg_days: r.avg_days === null ? null : Number(r.avg_days), quote_vs_bill_pct: r.quote_vs_bill_pct === null ? null : Number(r.quote_vs_bill_pct), rework_pct: r.rework_pct === null ? null : Number(r.rework_pct) }));

    return {
      currency, asOf: now.toISOString().slice(0, 10), activeVehicles, approvals,
      openCards: { count: open.open, atWorkshop: open.workshop }, spendMonth, overBudget, serviceDue, docsExpiring, spendByMonth, costliest, whyJobs, scorecard,
    };
  });
}
