// What a plan would charge an organization right now, read from the owner's tables (CLAUDE.md rule 7: no figure is written in code). A payment claim stores this quote
// when it is filed (ADR-068), so what the customer sent is what is confirmed even if a price changes in between. Kept free of other billing modules so the
// customer's side (payments), the owner's side (operator) and the switching rules can all use it without importing each other.
import type { Driver, Queryable } from "@/lib/db/types";
import { withTenant } from "@/lib/db/tenant";

export const BASIC = "standard";
export const PRO = "pro";
/** The free Pro trial a Basic customer may take once (ADR-068). */
export const PRO_TRIAL_DAYS = 7;

export type Quote = { planKey: string; priceCents: number; currency: string; aiReadsPerDay: number | null };

/** How many vehicles an organization has, which decides its Pro band. Counted in its own workspace. */
export async function vehicleCount(driver: Driver, tenantId: string, schema: string): Promise<number> {
  return withTenant(driver, { schema, userId: "00000000-0000-0000-0000-000000000000", role: "billing" }, async (q) => Number((await q.query<{ n: string }>("select count(*)::text n from vehicles")).rows[0].n)).catch(() => 0);
}

/** The quote for a plan, or null when it is not on sale: Basic has no price, or Pro's bands do not cover every fleet size (the last must have no upper limit). */
export async function quoteIn(q: Queryable, planKey: string, vehicles: number): Promise<Quote | null> {
  if (planKey === BASIC) {
    const p = (await q.query<{ price_cents: number | null; currency: string }>("select price_cents, currency from public.plans where key = 'standard'")).rows[0];
    return p && p.price_cents !== null ? { planKey, priceCents: p.price_cents, currency: p.currency, aiReadsPerDay: null } : null;
  }
  if (planKey !== PRO) return null;
  const open = (await q.query<{ n: string }>("select count(*)::text n from public.plan_bands where plan_key = 'pro' and up_to_vehicles is null")).rows[0];
  if (Number(open.n) === 0) return null;
  const band = (await q.query<{ price_cents: number; currency: string; ai_reads_per_day: number }>(
    `select price_cents, currency, ai_reads_per_day from public.plan_bands where plan_key = 'pro' and (up_to_vehicles is null or up_to_vehicles >= $1)
      order by coalesce(up_to_vehicles, 2147483647) limit 1`, [vehicles])).rows[0];
  return band ? { planKey, priceCents: band.price_cents, currency: band.currency, aiReadsPerDay: band.ai_reads_per_day } : null;
}
