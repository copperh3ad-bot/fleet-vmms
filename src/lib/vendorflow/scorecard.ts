// Workshop scorecard and quotation warnings (owner decisions C2 to C4, 2026-11-11). Read-only maths over the last 12 months, plus the
// Fleet Manager's rating and flag. Nothing here changes a job card.
import { z } from "zod";
import type { Driver, Queryable } from "@/lib/db/types";
import { authorized, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";

export type Scorecard = {
  vendor_id: string;
  jobs: number;                    // completed work orders in the last 12 months
  avg_days: number | null;         // issue to completion
  on_time_pct: number | null;      // of the jobs whose quotation promised a number of days
  bill_vs_quote_pct: number | null; // average of (checked invoice / approved amount); 100 = billed as quoted
  rework: number;                  // a later job card for the same vehicle and reason within 30 days of this workshop finishing
  rating: number | null;           // average stars given by the Fleet Manager
  ratings: number;
  flagged: boolean;                // the latest rating carries a flag
  flag_note: string | null;
};

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/** One scorecard per vendor id, for the last 12 months. A vendor with no history gets zero jobs and nulls. */
export async function scorecardsIn(q: Queryable, vendorIds: string[]): Promise<Map<string, Scorecard>> {
  const out = new Map<string, Scorecard>();
  if (vendorIds.length === 0) return out;
  const rows = (await q.query<{
    vendor_id: string; jobs: number; avg_days: string | null; on_time_pct: string | null; bill_vs_quote_pct: string | null; rework: number;
    rating: string | null; ratings: number; flagged: boolean | null; flag_note: string | null;
  }>(
    `select v.id as vendor_id,
            (select count(*)::int from work_orders w where w.vendor_id = v.id and w.status = 'completed' and w.issued_at > now() - interval '12 months') as jobs,
            (select avg(extract(epoch from w.completed_at - w.issued_at) / 86400)::text from work_orders w
              where w.vendor_id = v.id and w.status = 'completed' and w.issued_at > now() - interval '12 months') as avg_days,
            (select (100.0 * count(*) filter (where w.completed_at <= w.issued_at + make_interval(days => qt.days_needed)) / nullif(count(*), 0))::text
               from work_orders w join quotations qt on qt.id = w.quotation_id
              where w.vendor_id = v.id and w.status = 'completed' and qt.days_needed is not null and w.issued_at > now() - interval '12 months') as on_time_pct,
            (select avg(100.0 * i.amount / nullif(w.approved_amount, 0))::text from invoices i join work_orders w on w.id = i.work_order_id
              where w.vendor_id = v.id and i.status in ('verified','paid') and w.issued_at > now() - interval '12 months') as bill_vs_quote_pct,
            (select count(*)::int from work_orders w join job_cards jc on jc.id = w.job_card_id
              where w.vendor_id = v.id and w.status = 'completed' and w.issued_at > now() - interval '12 months'
                and exists (select 1 from job_cards j2 where j2.vehicle_id = jc.vehicle_id and j2.reason_code_id = jc.reason_code_id and j2.id <> jc.id
                               and j2.status <> 'cancelled' and j2.created_at > w.completed_at and j2.created_at <= w.completed_at + interval '30 days')) as rework,
            (select avg(r.stars)::text from vendor_ratings r where r.vendor_id = v.id and r.created_at > now() - interval '12 months') as rating,
            (select count(*)::int from vendor_ratings r where r.vendor_id = v.id and r.created_at > now() - interval '12 months') as ratings,
            (select r.flagged from vendor_ratings r where r.vendor_id = v.id order by r.created_at desc, r.id limit 1) as flagged,
            (select case when r.flagged then r.note end from vendor_ratings r where r.vendor_id = v.id order by r.created_at desc, r.id limit 1) as flag_note
       from vendors v where v.id = any($1::uuid[])`, [vendorIds])).rows;
  for (const r of rows) out.set(r.vendor_id, {
    vendor_id: r.vendor_id, jobs: r.jobs, avg_days: round1(r.avg_days === null ? null : Number(r.avg_days)),
    on_time_pct: r.on_time_pct === null ? null : Math.round(Number(r.on_time_pct)), bill_vs_quote_pct: r.bill_vs_quote_pct === null ? null : Math.round(Number(r.bill_vs_quote_pct)),
    rework: r.rework, rating: round1(r.rating === null ? null : Number(r.rating)), ratings: r.ratings, flagged: !!r.flagged, flag_note: r.flag_note,
  });
  return out;
}

/** C3: why approving this quotation deserves a second look. Empty when nothing is wrong. */
export async function quotationWarningsIn(q: Queryable, quotationId: string): Promise<string[]> {
  const r = (await q.query<{ amount: string; est: string | null; vehicle_id: string; pct: string | null }>(
    `select qt.amount::text, jc.estimated_cost::text as est, jc.vehicle_id,
            (select s.value from settings s where s.key = 'quote_over_estimate_pct') as pct
       from quotations qt join job_cards jc on jc.id = qt.job_card_id where qt.id = $1`, [quotationId])).rows[0];
  if (!r) return [];
  const out: string[] = [];
  const amount = Number(r.amount), pct = r.pct === null || r.pct === "" ? 10 : Number(r.pct);
  if (r.est !== null && Number(r.est) > 0 && amount > Number(r.est) * (1 + pct / 100)) {
    out.push(`the quotation is ${Math.round((amount / Number(r.est) - 1) * 100)}% above the estimate of ${Number(r.est).toLocaleString("en-US")}`);
  }
  const b = (await q.query<{ budget: string; spent: string }>("select budget::text, spent::text from v_vehicle_budget_now where vehicle_id = $1", [r.vehicle_id])).rows[0];
  if (b && Number(b.spent) + amount > Number(b.budget)) {
    out.push(`it takes the vehicle over its budget (${Number(b.spent).toLocaleString("en-US")} spent of ${Number(b.budget).toLocaleString("en-US")})`);
  }
  return out;
}

export const vendorRatingSchema = z.object({
  stars: z.coerce.number().int().min(1, "Choose 1 to 5 stars").max(5, "Choose 1 to 5 stars"),
  flagged: z.boolean().default(false),
  note: z.string().trim().max(500).optional(),
  job_card_id: z.uuid().optional(),
}).refine((v) => !v.flagged || (v.note ?? "").length >= 5, { message: "Say why you flag this workshop", path: ["note"] });

/** The Fleet Manager rates a workshop (1 to 5 stars), optionally against a job card, and may flag it with a reason. */
export function rateVendor(driver: Driver, m: Membership, vendorId: string, raw: unknown): Promise<void> {
  const p = vendorRatingSchema.safeParse(raw);
  return authorized(driver, m, "vendor.rate", async (q) => {
    if (!p.success) throw new UserError(p.error.issues[0].message);
    if ((await q.query("select 1 from vendors where id = $1", [vendorId])).rows.length === 0) throw new UserError("Workshop not found.");
    await q.query("insert into vendor_ratings(vendor_id, job_card_id, stars, flagged, note, rated_by) values ($1,$2,$3,$4,$5,$6)",
      [vendorId, p.data.job_card_id ?? null, p.data.stars, p.data.flagged, p.data.note || null, m.userId]);
  });
}

export function vendorScorecard(driver: Driver, m: Membership, vendorId: string): Promise<Scorecard | null> {
  return authorized(driver, m, "jobcard.read_all", async (q) => (await scorecardsIn(q, [vendorId])).get(vendorId) ?? null);
}
