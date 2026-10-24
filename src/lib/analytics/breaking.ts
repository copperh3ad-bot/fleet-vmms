// "Why it keeps breaking" as the design shows it: is the data good enough to trust, jobs by reason with a running
// total, repeat repairs, jobs by driver / vehicle / workshop, and what drivers wrote grouped by keyword.
// Needs report.view (CLAUDE.md rule 3). Cost is v_vehicle_job_cost: the checked invoice amount once verified,
// otherwise the estimate; drafts, cancelled and rejected cards are not counted.
import type { Driver } from "@/lib/db/types";
import { authorized, type Membership } from "@/lib/auth/can";

export const PERIODS = [30, 90, 180, 365] as const;
export const GROUPS = ["driver", "vehicle", "workshop"] as const;
export type Group = (typeof GROUPS)[number];

export type ReasonRow = { category: string; jobs: number; share: number; running: number; cost: number; avgCost: number; costly: boolean };
export type RepeatRow = { vehicle_id: string; registration_no: string; reason: string; times: number; gapDays: number; cost: number };
export type GroupRow = { key: string; label: string; sub: string | null; vehicle: string | null; vehicle_id: string | null; jobs: number; cost: number; per10k: number | null; misuse: number };
export type Keyword = { label: string; count: number };
export type Quote = { job_id: string; text: string; registration_no: string; keyword: string; repeat: boolean };

export type Breaking = {
  days: number; group: Group; from: string; to: string; jobs: number; cost: number;
  quality: { otherPct: number; otherOk: boolean; shortNotes: number; noReason: number };
  reasons: ReasonRow[]; reasonNote: { top: string; dear: { category: string; avgCost: number; multiple: number } | null } | null;
  repeats: { rows: RepeatRow[]; jobs: number; cost: number };
  groups: GroupRow[];
  keywords: Keyword[]; quotes: Quote[];
};

const KEYWORDS: [string, RegExp][] = [
  ["Brakes", /brake|\bpads?\b|disc/i], ["Tyres", /tyre|tire|puncture|wheel/i], ["Rough roads", /pothole|rough|bypass|bumpy|gravel/i],
  ["Overloading", /overload|too heavy|heavy load|springs?|sagging/i], ["AC", /air.?condition|\ba\/?c\b|cooling|blows warm/i],
  ["Engine", /engine|\boil\b|smoke|overheat/i], ["Electrical", /battery|alternator|wiring|headlight|\blight\b|fuse/i], ["Accident", /reversed|collision|scrape|hit by|hit a|crash|dent/i],
];

export function breakingReport(driver: Driver, m: Membership, opts: { days?: number; group?: string } = {}): Promise<Breaking> {
  const days = (PERIODS as readonly number[]).includes(opts.days ?? 0) ? (opts.days as number) : 90;
  const group = (GROUPS as readonly string[]).includes(opts.group ?? "") ? (opts.group as Group) : "driver";
  return authorized(driver, m, "report.view", async (q) => {
    const since = `now() - interval '${days} days'`;
    const jobs = (await q.query<{ id: string; created_at: string; vehicle_id: string; plate: string; cost: string; category: string; reason: string; cause: string; repeat: boolean;
      emp_id: string | null; emp: string | null; dept: string | null; vendor: string | null; reason_code_id: string }>(
      `select jc.id, jc.created_at::text, jc.vehicle_id, v.registration_no as plate, c.cost::text, rc.category, rc.label as reason, jc.cause_text as cause, coalesce(rr.is_repeat, false) as repeat,
              e.id as emp_id, e.full_name as emp, e.department as dept, vn.name as vendor, jc.reason_code_id
         from v_vehicle_job_cost c join job_cards jc on jc.id = c.job_card_id join vehicles v on v.id = jc.vehicle_id join reason_codes rc on rc.id = jc.reason_code_id
         left join v_repeat_repairs rr on rr.job_card_id = jc.id left join employees e on e.id = c.custodian_id left join vendors vn on vn.id = jc.vendor_id
        where c.created_at >= ${since} order by jc.created_at desc`)).rows.map((r) => ({ ...r, cost: Number(r.cost) }));
    const total = jobs.reduce((s, j) => s + j.cost, 0);
    const avg = jobs.length ? total / jobs.length : 0;

    // 1. is the data good enough to trust
    const other = jobs.filter((j) => j.category === "other").length;
    const otherPct = jobs.length ? Math.round((other / jobs.length) * 100) : 0;
    const quality = { otherPct, otherOk: otherPct < 10, shortNotes: jobs.filter((j) => j.cause.trim().length < 25).length, noReason: 0 };   // a reason is required, so 0 by construction

    // 2. jobs by reason, with running total
    const byCat = new Map<string, { jobs: number; cost: number }>();
    for (const j of jobs) { const e = byCat.get(j.category) ?? { jobs: 0, cost: 0 }; e.jobs++; e.cost += j.cost; byCat.set(j.category, e); }
    let run = 0;
    const reasons: ReasonRow[] = [...byCat].sort((a, b) => b[1].jobs - a[1].jobs || b[1].cost - a[1].cost).map(([category, e]) => {
      const share = jobs.length ? Math.round((e.jobs / jobs.length) * 100) : 0;
      run += e.jobs;
      const avgCost = e.jobs ? e.cost / e.jobs : 0;
      return { category, jobs: e.jobs, share, running: jobs.length ? Math.round((run / jobs.length) * 100) : 0, cost: e.cost, avgCost, costly: avg > 0 && avgCost >= avg * 1.5 && e.jobs >= 2 };
    });
    const top = reasons[0];
    const dear = [...reasons].filter((r) => r.avgCost > 0).sort((a, b) => b.avgCost - a.avgCost)[0];
    const reasonNote = top ? { top: top.category, dear: dear && dear.category !== top.category && avg > 0 ? { category: dear.category, avgCost: Math.round(dear.avgCost), multiple: Math.round((dear.avgCost / avg) * 10) / 10 } : null } : null;

    // 3. repeat repairs: the same vehicle and reason more than once
    const rep = new Map<string, { vehicle_id: string; plate: string; reason: string; dates: number[]; cost: number }>();
    for (const j of jobs.filter((x) => x.category !== "scheduled_service")) {
      const k = `${j.vehicle_id}|${j.reason_code_id}`;
      const e = rep.get(k) ?? { vehicle_id: j.vehicle_id, plate: j.plate, reason: j.reason, dates: [], cost: 0 };
      e.dates.push(new Date(j.created_at).getTime()); e.cost += j.cost; rep.set(k, e);
    }
    const repeatRows: RepeatRow[] = [...rep.values()].filter((e) => e.dates.length >= 2).map((e) => {
      const d = e.dates.sort((a, b) => a - b);
      let gap = Infinity;
      for (let i = 1; i < d.length; i++) gap = Math.min(gap, Math.round((d[i] - d[i - 1]) / 864e5));
      return { vehicle_id: e.vehicle_id, registration_no: e.plate, reason: e.reason, times: e.dates.length, gapDays: gap, cost: e.cost };
    }).sort((a, b) => b.times - a.times || a.gapDays - b.gapDays);

    // 4. jobs per driver, vehicle or workshop; kilometres from accepted readings while the person held the vehicle
    const km = (await q.query<{ emp_id: string; vehicle_id: string; km: string }>(
      `select c.employee_id as emp_id, c.vehicle_id,
              coalesce(max(r.reading_km) - min(r.reading_km), 0)::text as km
         from vehicle_custody c
         join odometer_readings r on r.vehicle_id = c.vehicle_id and r.status = 'accepted'
          and r.read_at::date between greatest(c.from_date, (${since})::date) and least(coalesce(c.to_date, current_date), current_date)
        where coalesce(c.to_date, current_date) >= (${since})::date group by c.employee_id, c.vehicle_id`)).rows;
    const kmOf = (emp: string | null, veh: string | null) => km.filter((k) => (emp === null || k.emp_id === emp) && (veh === null || k.vehicle_id === veh)).reduce((s, k) => s + Number(k.km), 0);
    const bucket = new Map<string, GroupRow & { emp?: string | null }>();
    for (const j of jobs) {
      const key = group === "driver" ? `${j.emp_id ?? "none"}|${j.vehicle_id}` : group === "vehicle" ? j.vehicle_id : (j.vendor ?? "none");
      const e = bucket.get(key) ?? {
        key, label: group === "driver" ? (j.emp ?? "No driver assigned") : group === "vehicle" ? j.plate : (j.vendor ?? "No workshop"),
        sub: group === "driver" ? j.dept : null, vehicle: group === "driver" ? j.plate : null, vehicle_id: group === "driver" || group === "vehicle" ? j.vehicle_id : null,
        jobs: 0, cost: 0, per10k: null, misuse: 0, emp: j.emp_id,
      };
      e.jobs++; e.cost += j.cost; if (j.category === "driver_misuse") e.misuse++;
      bucket.set(key, e);
    }
    const groups: GroupRow[] = [...bucket.values()].map((e) => {
      const driven = group === "driver" ? kmOf(e.emp ?? null, e.vehicle_id) : group === "vehicle" ? kmOf(null, e.vehicle_id) : 0;
      const { emp: _emp, ...row } = e; void _emp;
      return { ...row, per10k: driven > 0 ? Math.round((e.jobs / driven) * 10000 * 10) / 10 : null };
    }).sort((a, b) => b.cost - a.cost).slice(0, 10);

    // 5. what drivers wrote, grouped by keyword
    const counts = new Map<string, number>();
    const quotes: Quote[] = [];
    for (const j of jobs) {
      const hit = KEYWORDS.find(([, re]) => re.test(j.cause));
      if (!hit) continue;
      for (const [label, re] of KEYWORDS) if (re.test(j.cause)) counts.set(label, (counts.get(label) ?? 0) + 1);
      if (quotes.length < 4 && j.cause.trim().length >= 25) quotes.push({ job_id: j.id, text: j.cause.trim().slice(0, 140), registration_no: j.plate, keyword: hit[0], repeat: j.repeat });
    }
    const keywords = [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 6);

    const now = new Date();
    return {
      days, group, from: new Date(now.getTime() - days * 864e5).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10), jobs: jobs.length, cost: total,
      quality, reasons, reasonNote,
      repeats: { rows: repeatRows.slice(0, 8), jobs: repeatRows.reduce((s, r) => s + r.times, 0), cost: repeatRows.reduce((s, r) => s + r.cost, 0) },
      groups, keywords, quotes,
    };
  });
}
