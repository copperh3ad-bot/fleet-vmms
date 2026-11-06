// The designed vehicle record: header, four KPIs, history and costs, budget, servicing, who held it, papers.
// Needs vehicle.read and respects the member's "own" scope (CLAUDE.md rule 3). Cost figures follow
// v_vehicle_job_cost: the checked invoice amount once verified, otherwise the estimate.
import type { Driver } from "@/lib/db/types";
import { authorized, type Membership } from "@/lib/auth/can";

export type RecordJob = { id: string; job_no: string; created_at: string; status: string; reason: string; category: string; repeat: boolean; cause_text: string; vendor: string | null; cost: number };
export type RecordService = { label: string; status: string; last_done_on: string | null; last_km: number | null; due_on: string | null; days_remaining: number | null; km_remaining: number | null; hours_remaining: number | null };
export type RecordHolder = { employee_id: string; name: string; department: string | null; from_date: string; to_date: string | null; cost: number };
export type RecordDoc = { entity_id: string; entity_type: string; doc_type: string; expires_on: string; days_left: number; doc_status: string };
export type RecordReading = { read_at: string; reading_km: number; source: string; status: string };

export type VehicleRecord = {
  id: string; registration_no: string; make: string | null; model: string | null; year: number | null; status: string; vehicle_class: string | null; fuel_type: string | null;
  colour: string | null; vin: string | null; engine_no: string | null; base_location: string | null; department: string | null; odometer_km: number; odometer_updated_at: string | null;
  tracksHours: boolean; engineHours: number | null;
  holder: { employee_id: string; name: string; department: string | null; since: string } | null;
  period: { start: string; end: string; fromBudget: boolean };
  spend: number; budget: number | null; pct: number | null; budgetUsedUpOn: string | null; monthsRemaining: number | null;
  jobs90: number; fleetAvgJobs90: number;
  repeats: { count: number; text: string | null };
  nextService: RecordService | null; serviceRuleText: string | null;
  services: RecordService[];
  jobs: RecordJob[];
  reasons: { category: string; jobs: number; cost: number }[];
  holders: RecordHolder[];
  docs: RecordDoc[];
  readings: RecordReading[];
  lastService: { label: string; date: string; km: number | null } | null;
  sinceServiceKm: number | null;
};

export function getVehicleRecord(driver: Driver, m: Membership, id: string): Promise<VehicleRecord | null> {
  return authorized(driver, m, "vehicle.read", async (q) => {
    const own = m.vehicleScope === "own";
    const v = (await q.query<{
      id: string; registration_no: string; make: string | null; model: string | null; year: number | null; status: string; vehicle_class: string | null; fuel_type: string | null;
      colour: string | null; vin: string | null; engine_no: string | null; base_location: string | null; department: string | null; odometer_km: string; odometer_updated_at: string | null; tracks_hours: boolean; engine_hours: string | null;
      holder_id: string | null; holder_name: string | null; holder_dept: string | null; holder_since: string | null;
    }>(
      `select v.id, v.registration_no, v.make, v.model, v.year, v.status, v.vehicle_class, v.fuel_type, v.colour, v.vin, v.engine_no, v.base_location, v.department,
              v.odometer_km::text, v.odometer_updated_at::text, v.tracks_hours, v.engine_hours::text, h.id as holder_id, h.full_name as holder_name, h.department as holder_dept, c.from_date::text as holder_since
         from vehicles v left join vehicle_custody c on c.vehicle_id = v.id and c.to_date is null left join employees h on h.id = c.employee_id
        where v.id = $1 and dept_ok(v.id) ${own ? "and h.user_id = $2" : ""}`, own ? [id, m.userId] : [id])).rows[0];
    if (!v) return null;

    const bud = (await q.query<{ period_start: string; period_end: string; budget: string }>(
      "select period_start::text, period_end::text, budget::text from v_vehicle_budget_now where vehicle_id = $1", [id])).rows[0];
    const year = new Date().getUTCFullYear();
    const period = bud ? { start: bud.period_start, end: bud.period_end, fromBudget: true } : { start: `${year}-01-01`, end: `${year}-12-31`, fromBudget: false };

    const jobs = (await q.query<{ id: string; job_no: string; created_at: string; status: string; reason: string; category: string; repeat: boolean; cause_text: string; vendor: string | null; cost: string }>(
      `select jc.id, jc.job_no, jc.created_at::text, jc.status, rc.label as reason, rc.category, coalesce(rr.is_repeat, false) as repeat, jc.cause_text, vn.name as vendor,
              coalesce(c.cost, 0)::text as cost
         from job_cards jc join reason_codes rc on rc.id = jc.reason_code_id
         left join v_repeat_repairs rr on rr.job_card_id = jc.id left join vendors vn on vn.id = jc.vendor_id left join v_vehicle_job_cost c on c.job_card_id = jc.id
        where jc.vehicle_id = $1 and jc.status not in ('draft','cancelled') order by jc.created_at desc limit 100`, [id])).rows
      .map((r) => ({ ...r, cost: Number(r.cost) }));

    const inPeriod = jobs.filter((j) => j.created_at.slice(0, 10) >= period.start && j.created_at.slice(0, 10) <= period.end && !["rejected"].includes(j.status));
    const spend = inPeriod.reduce((s, j) => s + j.cost, 0);
    const budget = bud ? Number(bud.budget) : null;

    // the day the budget ran out: walk the jobs oldest first until the running total passes it
    let usedUp: string | null = null;
    if (budget !== null) {
      let run = 0;
      for (const j of [...inPeriod].reverse()) { run += j.cost; if (run >= budget) { usedUp = j.created_at.slice(0, 10); break; } }
    }
    const monthsRemaining = bud ? Math.max(0, (new Date(`${bud.period_end}T00:00:00Z`).getUTCFullYear() - new Date().getUTCFullYear()) * 12 + new Date(`${bud.period_end}T00:00:00Z`).getUTCMonth() - new Date().getUTCMonth()) : null;

    const fleet = (await q.query<{ jobs: number; vehicles: number }>(
      `select (select count(*)::int from v_vehicle_job_cost where created_at > now() - interval '90 days') as jobs,
              (select count(*)::int from vehicles where status in ('active','in_workshop')) as vehicles`)).rows[0];
    const jobs90 = jobs.filter((j) => new Date(j.created_at).getTime() > Date.now() - 90 * 864e5).length;

    const rep = inPeriod.filter((j) => j.repeat);
    let repeatText: string | null = null;
    if (rep.length) {
      const last = (await q.query<{ reason: string; days: number }>(
        "select rc.label as reason, extract(day from rr.since_previous)::int as days from v_repeat_repairs rr join reason_codes rc on rc.id = rr.reason_code_id where rr.vehicle_id = $1 and rr.is_repeat order by rr.created_at desc limit 1", [id])).rows[0];
      if (last) repeatText = `${last.reason} twice in ${last.days} days`;
    }

    const services = (await q.query<{ label: string; status: string; last_done_on: string | null; last_km: string | null; due_on: string | null; days_remaining: number | null; km_remaining: string | null; hours_remaining: string | null }>(
      `select label, pm_status as status, last_done_on::text, last_km::text, due_on::text, days_remaining::int, km_remaining::text, hours_remaining::text from v_pm_status where vehicle_id = $1
        order by case pm_status when 'overdue' then 0 when 'due_soon' then 1 when 'no_history' then 2 when 'scheduled' then 3 else 4 end, coalesce(days_remaining, 99999), label`, [id])).rows
      .map((s) => ({ ...s, last_km: s.last_km === null ? null : Number(s.last_km), km_remaining: s.km_remaining === null ? null : Number(s.km_remaining), hours_remaining: s.hours_remaining === null ? null : Number(s.hours_remaining) }));
    const rule = (await q.query<{ label: string; interval_months: number | null; interval_km: string | null }>(
      "select label, interval_months, interval_km::text from service_types where active and is_preventive order by label limit 1")).rows[0];

    const reasons = (await q.query<{ category: string; jobs: number; cost: string }>(
      `select rc.category, count(*)::int as jobs, sum(c.cost)::text as cost from v_vehicle_job_cost c join reason_codes rc on rc.id = c.reason_code_id
        where c.vehicle_id = $1 and c.created_at::date between $2 and $3 group by 1 order by sum(c.cost) desc`, [id, period.start, period.end])).rows.map((r) => ({ ...r, cost: Number(r.cost) }));

    const holders = (await q.query<{ employee_id: string; name: string; department: string | null; from_date: string; to_date: string | null; cost: string }>(
      `select e.id as employee_id, e.full_name as name, e.department, c.from_date::text, c.to_date::text,
              coalesce((select sum(x.cost) from v_vehicle_job_cost x where x.vehicle_id = c.vehicle_id and x.custodian_id = e.id and x.created_at::date >= c.from_date and (c.to_date is null or x.created_at::date <= c.to_date)), 0)::text as cost
         from vehicle_custody c join employees e on e.id = c.employee_id where c.vehicle_id = $1 order by c.from_date desc`, [id])).rows.map((r) => ({ ...r, cost: Number(r.cost) }));

    const docs = (await q.query<RecordDoc>(
      "select entity_id, entity_type, doc_type, expires_on::text, days_left::int, doc_status from v_documents_status where vehicle_id = $1 order by expires_on", [id])).rows;
    const readings = (await q.query<{ read_at: string; reading_km: string; source: string; status: string }>(
      "select read_at::text, reading_km::text, source, status from odometer_readings where vehicle_id = $1 order by read_at desc, created_at desc limit 30", [id])).rows
      .map((r) => ({ ...r, reading_km: Number(r.reading_km) }));

    const nextService = services[0] ?? null;                    // already sorted most urgent first
    const lastDone = services.filter((s) => s.last_done_on).sort((a, b) => (b.last_done_on ?? "").localeCompare(a.last_done_on ?? ""))[0];
    const km = Number(v.odometer_km);

    return {
      id: v.id, registration_no: v.registration_no, make: v.make, model: v.model, year: v.year, status: v.status, vehicle_class: v.vehicle_class, fuel_type: v.fuel_type,
      colour: v.colour, vin: v.vin, engine_no: v.engine_no, base_location: v.base_location, department: v.department, odometer_km: km, odometer_updated_at: v.odometer_updated_at,
      tracksHours: v.tracks_hours, engineHours: v.engine_hours === null ? null : Number(v.engine_hours),
      holder: v.holder_id ? { employee_id: v.holder_id, name: v.holder_name!, department: v.holder_dept, since: v.holder_since! } : null,
      period, spend, budget, pct: budget ? Math.round((spend / budget) * 1000) / 10 : null, budgetUsedUpOn: usedUp, monthsRemaining,
      jobs90, fleetAvgJobs90: fleet.vehicles ? Math.round((fleet.jobs / fleet.vehicles) * 10) / 10 : 0,
      repeats: { count: rep.length, text: repeatText },
      nextService, serviceRuleText: rule ? `every ${[rule.interval_months ? `${rule.interval_months} months` : null, rule.interval_km ? `${Number(rule.interval_km).toLocaleString("en-US")} km` : null].filter(Boolean).join(" or ")}` : null,
      services, jobs, reasons, holders, docs, readings,
      lastService: lastDone ? { label: lastDone.label, date: lastDone.last_done_on!, km: lastDone.last_km } : null,
      sinceServiceKm: lastDone?.last_km != null ? Math.max(0, km - lastDone.last_km) : null,
    };
  });
}
