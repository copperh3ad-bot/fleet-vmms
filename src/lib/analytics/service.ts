// Read-only reports. Every function needs report.view (CLAUDE.md rule 3). Costs come from v_vehicle_job_cost:
// the payable invoice amount once verified, otherwise the estimate. Cards that are drafts, cancelled or rejected
// are not counted.
import type { Driver } from "@/lib/db/types";
import { authorized, type Membership } from "@/lib/auth/can";

const PERM = "report.view";

export type Flag = { vehicle_id: string | null; registration_no: string | null; flag: string; severity: "high" | "medium"; detail: string };

export function getFlags(driver: Driver, m: Membership): Promise<Flag[]> {
  return authorized(driver, m, PERM, async (q) =>
    (await q.query<Flag>("select vehicle_id, registration_no, flag, severity, detail from v_vehicle_flags order by case severity when 'high' then 0 else 1 end, registration_no nulls first, flag")).rows);
}

export type Slice = { label: string; cost: number; jobs: number };
export type CostOverview = {
  months: number; total: number; jobs: number; average: number;
  byMonth: { month: string; cost: number; jobs: number }[];
  byCategory: Slice[]; byVehicle: (Slice & { vehicle_id: string })[]; byVendor: Slice[]; byDriver: Slice[];
};

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/** Spending over the last N whole months (this month counts as the last one). */
export function costOverview(driver: Driver, m: Membership, months = 12): Promise<CostOverview> {
  const n = [3, 6, 12, 24].includes(months) ? months : 12;
  return authorized(driver, m, PERM, async (q) => {
    const from = `(date_trunc('month', now()) - interval '${n - 1} months')`;
    const slices = async (sql: string) => (await q.query<{ label: string; cost: string; jobs: number; vehicle_id?: string }>(sql)).rows
      .map((r) => ({ label: r.label, cost: Number(r.cost), jobs: r.jobs, ...(r.vehicle_id ? { vehicle_id: r.vehicle_id } : {}) }));
    const monthly = (await q.query<{ month: string; cost: string; jobs: number }>(
      `select to_char(date_trunc('month', created_at), 'YYYY-MM') as month, sum(cost)::text as cost, count(*)::int as jobs
         from v_vehicle_job_cost where created_at >= ${from} group by 1`)).rows;
    const byMonth: CostOverview["byMonth"] = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const key = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)));
      const hit = monthly.find((r) => r.month === key);
      byMonth.push({ month: key, cost: hit ? Number(hit.cost) : 0, jobs: hit?.jobs ?? 0 });
    }
    const total = byMonth.reduce((s, r) => s + r.cost, 0), jobs = byMonth.reduce((s, r) => s + r.jobs, 0);
    return {
      months: n, total, jobs, average: jobs ? total / jobs : 0, byMonth,
      byCategory: await slices(`select rc.category as label, sum(c.cost)::text as cost, count(*)::int as jobs
        from v_vehicle_job_cost c join reason_codes rc on rc.id = c.reason_code_id where c.created_at >= ${from} group by 1 order by sum(c.cost) desc`),
      byVehicle: await slices(`select v.registration_no as label, v.id as vehicle_id, sum(c.cost)::text as cost, count(*)::int as jobs
        from v_vehicle_job_cost c join vehicles v on v.id = c.vehicle_id where c.created_at >= ${from} group by v.id order by sum(c.cost) desc limit 10`) as CostOverview["byVehicle"],
      byVendor: await slices(`select coalesce(vn.name, 'No vendor') as label, sum(c.cost)::text as cost, count(*)::int as jobs
        from v_vehicle_job_cost c join job_cards jc on jc.id = c.job_card_id left join vendors vn on vn.id = jc.vendor_id
        where c.created_at >= ${from} group by 1 order by sum(c.cost) desc limit 10`),
      byDriver: await slices(`select coalesce(e.full_name, 'No driver assigned') as label, sum(c.cost)::text as cost, count(*)::int as jobs
        from v_vehicle_job_cost c left join employees e on e.id = c.custodian_id where c.created_at >= ${from} group by 1 order by sum(c.cost) desc limit 10`),
    };
  });
}

export type RepeatRow = {
  job_card_id: string; previous_job_card_id: string; job_no: string; previous_job_no: string; vehicle_id: string; registration_no: string;
  reason: string; days_since: number; previous_vendor: string | null; vendor: string | null; created_at: string;
};
export type Retag = { job_card_id: string; job_no: string; registration_no: string; requested: string; final: string; requester: string };
export type WhyBreaks = {
  flags: Flag[];
  repeats: RepeatRow[];
  repeatThresholdDays: number;
  /** repeat repairs by the workshop that did the earlier job: work that came back */
  cameBackByVendor: { vendor: string; repeats: number }[];
  categories: Slice[];
  retagged: { total: number; changed: number; examples: Retag[] };
  busiest: { vehicle_id: string; registration_no: string; jobs: number; cost: number; top_reason: string }[];
};

/** The one screen that answers "why does this keep going wrong". Looks back 12 months. */
export function whyItKeepsBreaking(driver: Driver, m: Membership): Promise<WhyBreaks> {
  return authorized(driver, m, PERM, async (q) => {
    const since = "now() - interval '12 months'";
    const repeats = (await q.query<RepeatRow>(
      `select r.job_card_id, r.previous_job_card_id, jc.job_no, pj.job_no as previous_job_no, r.vehicle_id, r.registration_no, r.reason, r.days_since,
              pv.name as previous_vendor, cv.name as vendor, r.created_at::text
         from flag_repeat_days r
         join job_cards jc on jc.id = r.job_card_id
         join job_cards pj on pj.id = r.previous_job_card_id
         left join vendors pv on pv.id = pj.vendor_id
         left join vendors cv on cv.id = jc.vendor_id
        where r.created_at >= ${since} order by r.created_at desc limit 100`)).rows;
    const cameBack = (await q.query<{ vendor: string; repeats: number }>(
      `select pv.name as vendor, count(*)::int as repeats
         from flag_repeat_days r join job_cards pj on pj.id = r.previous_job_card_id join vendors pv on pv.id = pj.vendor_id
        where r.created_at >= ${since} group by pv.name order by 2 desc, 1 limit 10`)).rows;
    const categories = (await q.query<{ label: string; cost: string; jobs: number }>(
      `select rc.category as label, sum(c.cost)::text as cost, count(*)::int as jobs
         from v_vehicle_job_cost c join reason_codes rc on rc.id = c.reason_code_id where c.created_at >= ${since} group by 1 order by 3 desc, 1`)).rows
      .map((r) => ({ label: r.label, cost: Number(r.cost), jobs: r.jobs }));
    const tag = (await q.query<{ total: number; changed: number }>(
      `select count(*)::int as total, count(*) filter (where jc.reason_code_id <> jc.requested_reason_code_id)::int as changed
         from job_cards jc where jc.status not in ('draft','cancelled','rejected') and jc.created_at >= ${since}`)).rows[0];
    const examples = (await q.query<Retag>(
      `select jc.id as job_card_id, jc.job_no, v.registration_no, rq.label as requested, rf.label as final, re.full_name as requester
         from job_cards jc join vehicles v on v.id = jc.vehicle_id
         join reason_codes rq on rq.id = jc.requested_reason_code_id join reason_codes rf on rf.id = jc.reason_code_id
         join employees re on re.id = jc.requested_by
        where jc.status not in ('draft','cancelled','rejected') and jc.created_at >= ${since} and jc.reason_code_id <> jc.requested_reason_code_id
        order by jc.created_at desc limit 20`)).rows;
    const busiest = (await q.query<{ vehicle_id: string; registration_no: string; jobs: number; cost: string; top_reason: string }>(
      `select v.id as vehicle_id, v.registration_no, count(*)::int as jobs, sum(c.cost)::text as cost,
              (select rc2.label from v_vehicle_job_cost c2 join reason_codes rc2 on rc2.id = c2.reason_code_id
                where c2.vehicle_id = v.id and c2.created_at >= ${since} group by rc2.label order by count(*) desc, rc2.label limit 1) as top_reason
         from v_vehicle_job_cost c join vehicles v on v.id = c.vehicle_id where c.created_at >= ${since}
        group by v.id having count(*) >= 2 order by count(*) desc, sum(c.cost) desc limit 10`)).rows
      .map((r) => ({ ...r, cost: Number(r.cost) }));
    const threshold = (await q.query<{ d: number }>("select setting_num('flag_repeat_days', 60)::int as d")).rows[0].d;
    const flags = (await q.query<Flag>(
      "select vehicle_id, registration_no, flag, severity, detail from v_vehicle_flags where flag in ('repeat_repair','too_many_jobs','cost_vs_peers') order by registration_no")).rows;
    return { flags, repeats, repeatThresholdDays: threshold, cameBackByVendor: cameBack, categories, retagged: { total: tag.total, changed: tag.changed, examples }, busiest };
  });
}
