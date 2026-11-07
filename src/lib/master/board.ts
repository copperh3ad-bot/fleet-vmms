// The designed Vehicles list ("Fleet"): one row per vehicle with service status, odometer freshness, spend against
// budget, recent jobs and flags. Needs vehicle.read and respects the member's "own" scope (CLAUDE.md rule 3).
import type { Driver } from "@/lib/db/types";
import { authorized, type Membership } from "@/lib/auth/can";

export const PAGE_SIZE = 25;
export type ServiceFilter = "all" | "overdue" | "due_soon" | "scheduled" | "no_history" | "ok";
export const FILTERS: ServiceFilter[] = ["all", "overdue", "due_soon", "scheduled", "no_history", "ok"];

export type BoardRow = {
  id: string; registration_no: string; make: string | null; model: string | null; year: number | null; status: string;
  holder: string | null;
  /** the vehicle's operating department (ADR-048), not the holder's */
  department: string | null;
  odometer_km: number; odometer_age_days: number | null; odometer_stale: boolean;
  service: ServiceFilter; service_label: string | null; last_done_on: string | null; due_on: string | null; days_remaining: number | null; open_job_no: string | null;
  spent: number; budget: number | null; pct: number | null;
  jobs_90d: number;
  flags: { text: string; tone: "bad" | "warn" | "neutral" }[];
  /** documents already expired or expiring within 30 days */
  docs: { type: string; expires_on: string; days_left: number }[];
};

export type Board = {
  rows: BoardRow[]; total: number; page: number; pages: number;
  counts: Record<ServiceFilter, number>; warnDays: number; staleDays: number; ruleText: string | null;
  /** departments among the vehicles this person can see, and whether some have none; the filter shows only when there is a choice */
  departments: string[]; hasGeneral: boolean; dept: string;
};

/** The filter value for vehicles that belong to no department. */
export const NO_DEPARTMENT = "_none";

const FLAG_TEXT: Record<string, { text: string; tone: "bad" | "warn" }> = {
  over_budget: { text: "Over budget", tone: "bad" }, near_budget: { text: "Near budget limit", tone: "warn" },
  repeat_repair: { text: "Repeat repair", tone: "warn" }, too_many_jobs: { text: "Many jobs", tone: "warn" }, cost_vs_peers: { text: "Costly vs similar vehicles", tone: "warn" }, replacement_due: { text: "Due for replacement", tone: "warn" },
};

export function getBoard(driver: Driver, m: Membership, opts: { q?: string; filter?: string; page?: number; dept?: string } = {}): Promise<Board> {
  const filter = (FILTERS as string[]).includes(opts.filter ?? "") ? (opts.filter as ServiceFilter) : "all";
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  return authorized(driver, m, "vehicle.read", async (q) => {
    const params: unknown[] = [];
    const where: string[] = ["v.status in ('active','in_workshop')", "dept_ok(v.id)"];
    if (m.vehicleScope === "own") { params.push(m.userId); where.push(`h.user_id = $${params.length}`); }
    if (opts.q) {
      params.push(`%${opts.q.replace(/[%_\\]/g, "\\$&").slice(0, 80)}%`);
      where.push(`(v.registration_no ilike $${params.length} or v.make ilike $${params.length} or v.model ilike $${params.length} or h.full_name ilike $${params.length})`);
    }
    const deptWanted = (opts.dept ?? "").trim().slice(0, 60);
    if (deptWanted === NO_DEPARTMENT) where.push("(v.department is null or btrim(v.department) = '')");
    else if (deptWanted) { params.push(deptWanted); where.push(`lower(btrim(v.department)) = lower($${params.length})`); }
    const warnDays = Number((await q.query<{ d: string }>("select setting_num('pm_warning_days', 14)::text d")).rows[0].d);
    const staleDays = Number((await q.query<{ d: string }>("select setting_num('odometer_stale_days', 45)::text d")).rows[0].d);

    const base = `
      with base as (
        select v.id, v.registration_no, v.make, v.model, v.year, v.status, v.odometer_km, v.odometer_updated_at,
               h.full_name as holder, nullif(btrim(v.department), '') as department,
               coalesce((select p.pm_status from v_pm_status p where p.vehicle_id = v.id
                 order by case p.pm_status when 'overdue' then 0 when 'due_soon' then 1 when 'no_history' then 2 when 'scheduled' then 3 else 4 end, coalesce(p.days_remaining, 99999) limit 1), 'ok') as service
          from vehicles v
          left join vehicle_custody c on c.vehicle_id = v.id and c.to_date is null
          left join employees h on h.id = c.employee_id
         where ${where.join(" and ")}
      )`;
    // the choices for the department filter: what this person can see, before any department is picked
    const seen = (await q.query<{ d: string | null }>(
      `select distinct on (lower(btrim(coalesce(v.department, '')))) nullif(btrim(v.department), '') as d
         from vehicles v left join vehicle_custody c on c.vehicle_id = v.id and c.to_date is null left join employees h on h.id = c.employee_id
        where v.status in ('active','in_workshop') and dept_ok(v.id)${m.vehicleScope === "own" ? " and h.user_id = $1" : ""}
        order by lower(btrim(coalesce(v.department, ''))), 1`, m.vehicleScope === "own" ? [m.userId] : [])).rows;
    const departments = seen.map((r) => r.d).filter((d): d is string => d !== null).sort((a, b) => a.localeCompare(b));
    const hasGeneral = seen.some((r) => r.d === null);
    const countRows = (await q.query<{ service: string | null; c: number }>(`${base} select service, count(*)::int c from base group by service`, params)).rows;
    const counts: Record<ServiceFilter, number> = { all: 0, overdue: 0, due_soon: 0, scheduled: 0, no_history: 0, ok: 0 };
    for (const r of countRows) { counts.all += r.c; counts[(r.service ?? "ok") as ServiceFilter] += r.c; }   // a vehicle no rule applies to counts as on track

    const filtered = filter === "all" ? "" : `where service = $${params.length + 1}`;
    const fParams = filter === "all" ? params : [...params, filter];
    const total = filter === "all" ? counts.all : counts[filter];
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const cur = Math.min(page, pages);

    const rows = (await q.query<{
      id: string; registration_no: string; make: string | null; model: string | null; year: number | null; status: string; holder: string | null; department: string | null;
      odometer_km: string; age: number | null; service: string | null; service_label: string | null; last_done_on: string | null; due_on: string | null; days_remaining: number | null;
      open_job_no: string | null; spent: string; budget: string | null; pct: string | null; jobs_90d: number; flags: string[] | null; docs: { t: string; d: string; left: number }[] | null;
    }>(
      `${base}
       select b.id, b.registration_no, b.make, b.model, b.year, b.status, b.holder, b.department, b.odometer_km::text,
              (current_date - b.odometer_updated_at::date)::int as age, b.service,
              p.label as service_label, p.last_done_on::text, p.due_on::text, p.days_remaining::int,
              (select jc.job_no from job_cards jc join job_card_lines l on l.job_card_id = jc.id and l.service_type_key = p.service_type_key
                where jc.vehicle_id = b.id and jc.status in ('submitted','approved','returned_for_edit','vendor_assigned','quotation_received','quotation_approved','in_progress') limit 1) as open_job_no,
              coalesce(bn.spent, (select coalesce(sum(c.cost), 0) from v_vehicle_job_cost c where c.vehicle_id = b.id and c.created_at >= date_trunc('year', now())), 0)::text as spent,
              bn.budget::text as budget, bn.pct_used::text as pct,
              (select count(*)::int from v_vehicle_job_cost c where c.vehicle_id = b.id and c.created_at > now() - interval '90 days') as jobs_90d,
              (select array_agg(f.flag order by f.flag) from v_vehicle_flags f where f.vehicle_id = b.id and f.flag in ('over_budget','near_budget','repeat_repair','too_many_jobs','cost_vs_peers','replacement_due')) as flags,
              (select json_agg(json_build_object('t', d.doc_type, 'd', d.expires_on::text, 'left', d.days_left) order by d.expires_on)
                 from v_documents_status d where d.vehicle_id = b.id and d.days_left <= 30) as docs
         from (select * from base ${filtered} order by registration_no limit ${PAGE_SIZE} offset ${(cur - 1) * PAGE_SIZE}) b
         left join lateral (select * from v_pm_status x where x.vehicle_id = b.id
                             order by case x.pm_status when 'overdue' then 0 when 'due_soon' then 1 when 'no_history' then 2 when 'scheduled' then 3 else 4 end, coalesce(x.days_remaining, 99999) limit 1) p on true
         left join v_vehicle_budget_now bn on bn.vehicle_id = b.id
        order by b.registration_no`, fParams)).rows;

    const out: BoardRow[] = rows.map((r) => {
      const stale = r.age !== null && r.age > staleDays;
      const flags: BoardRow["flags"] = (r.flags ?? []).map((f) => ({ ...FLAG_TEXT[f] }));
      if (stale) flags.push({ text: "Odometer stale", tone: "warn" });
      return {
        id: r.id, registration_no: r.registration_no, make: r.make, model: r.model, year: r.year, status: r.status, holder: r.holder, department: r.department,
        odometer_km: Number(r.odometer_km), odometer_age_days: r.age, odometer_stale: stale,
        service: (r.service ?? "ok") as ServiceFilter, service_label: r.service_label, last_done_on: r.last_done_on, due_on: r.due_on, days_remaining: r.days_remaining, open_job_no: r.open_job_no,
        spent: Number(r.spent), budget: r.budget === null ? null : Number(r.budget), pct: r.pct === null ? null : Number(r.pct), jobs_90d: r.jobs_90d, flags,
        docs: (r.docs ?? []).map((d) => ({ type: d.t, expires_on: d.d, days_left: d.left })),
      };
    });
    const rule = (await q.query<{ label: string; interval_months: number | null; interval_km: string | null }>(
      "select label, interval_months, interval_km::text from service_types where active and is_preventive order by label limit 1")).rows[0];
    const ruleText = rule ? `${rule.label.toLowerCase()} rule: every ${[rule.interval_months ? `${rule.interval_months} months` : null, rule.interval_km ? `${Number(rule.interval_km).toLocaleString("en-US")} km` : null].filter(Boolean).join(" or ")}` : null;
    return { rows: out, total, page: cur, pages, counts, warnDays, staleDays, ruleText, departments, hasGeneral, dept: deptWanted };
  });
}
