// Outsourced trips, phase C (ADR-078): each organization's own reference rates for its logistics providers, and what outsourced trips cost per provider.
// Rates are entered by the organization and never built in; a rate is a reference beside the quotes and never replaces one.
import { z } from "zod";
import type { Driver } from "@/lib/db/types";
import { authorized, authorizedAny, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";
import { requireOutsourcing, requireOn } from "./service";

export const RATE_BASIS: Record<string, string> = { per_trip: "per trip", per_km: "per km", per_day: "per day", per_hour: "per hour" };

export const rateSchema = z.object({
  vendor_id: z.uuid("Choose a provider"),
  label: z.string().trim().min(2, "Say what the rate is for").max(160),
  basis: z.enum(["per_trip", "per_km", "per_day", "per_hour"], "Choose how it is charged"),
  amount: z.preprocess((v) => (typeof v === "string" ? v.replace(/,/g, "").trim() : v), z.coerce.number("Enter the rate").positive("Enter a rate above zero").max(1e9)),
  notes: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(500).optional()),
});

export type ProviderRate = { id: string; vendor_id: string; vendor_name: string; label: string; basis: string; amount: string; notes: string | null };

/** The active reference rates, for one provider or for all. Seen by those who award trips and those who manage vendors. */
export function listProviderRates(driver: Driver, m: Membership, vendorId?: string): Promise<ProviderRate[]> {
  return authorizedAny(driver, m, ["trip.award", "vendor.manage"], async (q) => (await q.query<ProviderRate>(
    `select r.id, r.vendor_id, v.name as vendor_name, r.label, r.basis, r.amount::text, r.notes
       from provider_rates r join vendors v on v.id = r.vendor_id
      where r.active and v.kind = 'logistics' ${vendorId ? "and r.vendor_id = $1" : ""} order by v.name, r.label`, vendorId ? [vendorId] : [])).rows);
}

export async function saveProviderRate(driver: Driver, m: Membership, raw: unknown): Promise<void> {
  const p = rateSchema.safeParse(raw);
  if (!p.success) throw new UserError("Fix the highlighted fields.", fieldErrors(p.error));
  const r = p.data;
  await requireOutsourcing(driver, m);
  return authorized(driver, m, "vendor.manage", async (q) => {
    if (!(await q.query("select 1 from vendors where id = $1 and kind = 'logistics'", [r.vendor_id])).rows.length) throw new UserError("Choose a logistics provider.");
    await q.query("insert into provider_rates(vendor_id, label, basis, amount, notes, created_by) values ($1,$2,$3,$4,$5,$6)", [r.vendor_id, r.label, r.basis, r.amount, r.notes ?? null, m.userId]);
  });
}

export async function removeProviderRate(driver: Driver, m: Membership, id: string): Promise<void> {
  await requireOutsourcing(driver, m);
  return authorized(driver, m, "vendor.manage", async (q) => {
    const r = await q.query("update provider_rates set active = false where id = $1 and active returning id", [id]);
    if (r.rows.length === 0) throw new UserError("That rate is already gone.");
  });
}

export type OutsourcedRow = { vendor_name: string; trips: number; awarded: string; invoiced: string; payable: string; saved: string; waiting_invoice: number };

const REPORT_PERMS = ["trip.award", "trip.read_all", "invoice.verify"];

/**
 * What outsourced trips cost, per provider, over the last N months (by the day the trip was awarded). "Saved" is the highest quote received for each trip
 * minus the price awarded: what choosing among several providers was worth, counted only where more than one quote was given.
 */
export function outsourcedTripReport(driver: Driver, m: Membership, months = 12): Promise<{ rows: OutsourcedRow[]; months: number }> {
  const n = [3, 6, 12, 24].includes(months) ? months : 12;
  return authorizedAny(driver, m, REPORT_PERMS, async (q) => {
    await requireOn(q);
    const rows = (await q.query<OutsourcedRow>(
      `select v.name as vendor_name, count(*)::int as trips,
              sum(t.award_amount)::text as awarded,
              coalesce(sum(inv.amount) filter (where inv.status in ('submitted','verified')), 0)::text as invoiced,
              coalesce(sum(inv.payable) filter (where inv.status = 'verified'), 0)::text as payable,
              coalesce(sum(greatest(top.max_quote - t.award_amount, 0)) filter (where top.n_quotes > 1), 0)::text as saved,
              count(*) filter (where t.status = 'completed' and not exists (select 1 from trip_invoices x where x.trip_id = t.id and x.status in ('submitted','verified')))::int as waiting_invoice
         from trips t join vendors v on v.id = t.outsourced_vendor_id
         left join lateral (select i.amount, i.payable, i.status from trip_invoices i where i.trip_id = t.id and i.status in ('submitted','verified') limit 1) inv on true
         left join lateral (select max(tq.amount) as max_quote, count(*) filter (where tq.amount is not null) as n_quotes from trip_quotes tq where tq.trip_id = t.id) top on true
        where t.decided_at >= now() - ($1 || ' months')::interval and t.status in ('approved','started','completed')
        group by v.id order by sum(t.award_amount) desc`, [String(n)])).rows;
    return { rows, months: n };
  });
}
