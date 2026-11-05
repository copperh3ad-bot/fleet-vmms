// Cost per kilometre and time in the workshop (ADR-044). Read-only; both need report.view (CLAUDE.md rule 3).
// The period is the same as on the Reports page: the last N whole months, this month counting as the last one. Days are UTC calendar days.
import type { Driver, Queryable } from "@/lib/db/types";
import { authorized, type Membership } from "@/lib/auth/can";

const PERM = "report.view";
export const PERIOD_MONTHS = [3, 6, 12, 24];
export const periodMonths = (n: number) => (PERIOD_MONTHS.includes(n) ? n : 12);
const FROM = "(date_trunc('month', now()) - make_interval(months => $1::int - 1))";

export type CostPerKm = {
  vehicle_id: string; registration_no: string; cost: number; jobs: number;
  /** null when fewer than two usable readings exist, or the odometer went backwards */
  km: number | null;
  /** null when km is null or zero, or nothing was spent */
  per_km: number | null;
};
export type CostPerKmReport = { months: number; rows: CostPerKm[]; fleet: { cost: number; km: number; per_km: number | null; vehicles_counted: number } };

export function costPerKmIn(q: Queryable, monthsIn: number): Promise<CostPerKmReport> {
  const months = periodMonths(monthsIn);
  return (async () => {
    const rows = (await q.query<{ vehicle_id: string; registration_no: string; cost: string; jobs: number; start_km: string | null; end_km: string | null; n: number }>(
      `with p as (select ${FROM} as from_at),
       acc as (select r.vehicle_id, r.reading_km, r.read_at from odometer_readings r where r.status = 'accepted'),
       base as (select distinct on (a.vehicle_id) a.vehicle_id, a.reading_km from acc a, p where a.read_at < p.from_at order by a.vehicle_id, a.read_at desc),
       inside as (select a.vehicle_id, count(*)::int as n,
                         (array_agg(a.reading_km order by a.read_at asc))[1] as first_km,
                         (array_agg(a.reading_km order by a.read_at desc))[1] as last_km
                    from acc a, p where a.read_at >= p.from_at group by a.vehicle_id),
       cost as (select c.vehicle_id, sum(c.cost) as cost, count(*)::int as jobs from v_vehicle_job_cost c, p where c.created_at >= p.from_at group by c.vehicle_id)
       select v.id as vehicle_id, v.registration_no, coalesce(c.cost, 0)::text as cost, coalesce(c.jobs, 0) as jobs,
              coalesce(b.reading_km, i.first_km)::text as start_km, i.last_km::text as end_km,
              coalesce(i.n, 0) + (case when b.reading_km is null then 0 else 1 end) as n
         from vehicles v left join cost c on c.vehicle_id = v.id left join base b on b.vehicle_id = v.id left join inside i on i.vehicle_id = v.id
        where v.status <> 'disposed'
        order by v.registration_no`, [months])).rows;
    const out: CostPerKm[] = rows.map((r) => {
      const cost = Number(r.cost);
      // Two readings are needed to measure a distance: one before or at the start, one at the end.
      const km = r.n >= 2 && r.start_km !== null && r.end_km !== null && Number(r.end_km) >= Number(r.start_km) ? Number(r.end_km) - Number(r.start_km) : null;
      return { vehicle_id: r.vehicle_id, registration_no: r.registration_no, cost, jobs: r.jobs, km, per_km: km && km > 0 && cost > 0 ? cost / km : null };
    }).filter((r) => r.cost > 0 || r.km !== null);
    // Worst first; vehicles with no figure go last.
    out.sort((a, b) => (b.per_km ?? -1) - (a.per_km ?? -1) || b.cost - a.cost || a.registration_no.localeCompare(b.registration_no));
    const counted = out.filter((r) => r.km !== null && r.km > 0);
    const cost = counted.reduce((s, r) => s + r.cost, 0), km = counted.reduce((s, r) => s + (r.km ?? 0), 0);
    return { months, rows: out, fleet: { cost, km, per_km: km > 0 && cost > 0 ? cost / km : null, vehicles_counted: counted.length } };
  })();
}

export function costPerKm(driver: Driver, m: Membership, months = 12): Promise<CostPerKmReport> {
  return authorized(driver, m, PERM, (q) => costPerKmIn(q, months));
}

export type Downtime = { vehicle_id: string; registration_no: string; workshop_days: number; visits: number; longest_days: number; days: number; availability: number | null };
export type DowntimeReport = { months: number; rows: Downtime[]; fleet: { workshop_days: number; visits: number; availability: number | null } };

export async function downtimeIn(q: Queryable, monthsIn: number): Promise<DowntimeReport> {
  const months = periodMonths(monthsIn);
  const rows = (await q.query<{ vehicle_id: string; registration_no: string; workshop_days: number; visits: number; longest_days: number; days: number }>(
    `with p as (select ${FROM} as from_at),
     clipped as (select h.vehicle_id, h.status, greatest(h.from_at, p.from_at)::date as d1, least(coalesce(h.to_at, now()), now())::date as d2
                   from vehicle_status_history h, p where coalesce(h.to_at, now()) >= p.from_at),
     per_day as (select c.vehicle_id, c.status, g::date as day from clipped c, generate_series(c.d1, c.d2, interval '1 day') g),
     days as (select vehicle_id,
                     count(distinct day) filter (where status <> 'disposed')::int as days,
                     count(distinct day) filter (where status = 'in_workshop')::int as workshop_days
                from per_day group by vehicle_id),
     visits as (select vehicle_id, count(*)::int as visits, max(d2 - d1 + 1)::int as longest from clipped where status = 'in_workshop' group by vehicle_id)
     select v.id as vehicle_id, v.registration_no, coalesce(d.workshop_days, 0) as workshop_days, coalesce(vi.visits, 0) as visits,
            coalesce(vi.longest, 0) as longest_days, coalesce(d.days, 0) as days
       from vehicles v left join days d on d.vehicle_id = v.id left join visits vi on vi.vehicle_id = v.id
      where v.status <> 'disposed' or coalesce(d.days, 0) > 0
      order by coalesce(d.workshop_days, 0) desc, v.registration_no`, [months])).rows;
  const out: Downtime[] = rows.map((r) => ({ ...r, availability: r.days > 0 ? 1 - r.workshop_days / r.days : null }));
  const measured = out.filter((r) => r.availability !== null);
  return {
    months, rows: out.filter((r) => r.workshop_days > 0 || r.visits > 0),
    fleet: {
      workshop_days: out.reduce((s, r) => s + r.workshop_days, 0), visits: out.reduce((s, r) => s + r.visits, 0),
      availability: measured.length ? measured.reduce((s, r) => s + (r.availability ?? 0), 0) / measured.length : null,
    },
  };
}

export function downtime(driver: Driver, m: Membership, months = 12): Promise<DowntimeReport> {
  return authorized(driver, m, PERM, (q) => downtimeIn(q, months));
}
