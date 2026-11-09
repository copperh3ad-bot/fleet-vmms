import { beforeAll, describe, expect, it, vi } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withLinkContext, withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as trips from "@/lib/trips/service";
import { hashToken } from "@/lib/odometer/link";
import { lookupWorkshopLink, submitViaQuoteLink, submitViaTripQuoteLink } from "@/lib/vendorflow/link";

// ADR-078 phase B: a logistics provider quotes on a trip through a single-use link, without an account.
const plan = vi.hoisted(() => ({ pro: true }));
vi.mock("@/lib/billing/plans", async (orig) => ({ ...(await orig<typeof import("@/lib/billing/plans")>()), tenantPlan: async () => ({ outsourcedTrips: plan.pro }) }));

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const mgr = () => mem("fleet_manager", 12);
const req = () => mem("requester", 11);
const logi = () => mem("logistics", 19);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);
let provA: string, provNoPhone: string;
const at = (day: number, hour: number) => `2031-05-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;

/** A fresh trip already sent to Alpha Freight; returns the trip and Alpha's request row. */
async function asked(vendor = provA) {
  const trip = await trips.requestTrip(d, req(), { purpose: "Move machinery to Faisalabad", from_place: "Lahore", to_place: "Faisalabad", start_at: at(10, 8), end_at: at(10, 18) });
  await trips.requestTripQuotes(d, mgr(), trip, [vendor]);
  const q = (await trips.listTripQuotes(d, mgr(), trip))[0];
  return { trip, quoteId: q.id };
}

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Haul Link Co", slug: "haullink", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  for (const [n, name] of [[11, "Requester One"], [12, "Manager One"], [19, "Logistics One"]] as const) {
    const id = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` })).id;
    await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), id]));
  }
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[11, "requester"], [12, "fleet_manager"], [19, "logistics"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  await raw((q) => q.query("insert into settings(key, value) values ('module_trips','1') on conflict (key) do update set value = '1'"));
  provA = (await master.saveVendor(d, owner(), { name: "Alpha Freight", kind: "logistics", phone: "0300 1111111" })).id;
  provNoPhone = (await master.saveVendor(d, owner(), { name: "Delta Cargo", kind: "logistics" })).id;
});

describe("making a trip quote link", () => {
  it("goes to the provider's own number, stores only a hash, and needs trip.award and Pro", async () => {
    const { quoteId } = await asked();
    const l = await trips.createTripQuoteLink(d, logi(), quoteId);
    expect(l.phone.e164).toBe("+923001111111");
    expect(l.vendor_name).toBe("Alpha Freight");
    const rows = await withPlatform(d, async (q) => (await q.query<Record<string, unknown>>("select * from public.quotation_links where token_hash = $1", [hashToken(l.token)])).rows);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("trip_quote");
    expect(JSON.stringify(rows[0])).not.toContain(l.token);
    expect(await trips.createTripQuoteLink(d, req(), quoteId).catch((e) => e)).toBeInstanceOf(ForbiddenError);
    plan.pro = false;
    try { expect((await trips.createTripQuoteLink(d, mgr(), quoteId).catch((e) => e)).message).toMatch(/Pro plan/); } finally { plan.pro = true; }
  });

  it("is refused when the provider has no number a message can reach", async () => {
    const { quoteId } = await asked(provNoPhone);
    expect((await trips.createTripQuoteLink(d, mgr(), quoteId).catch((e) => e)).message).toMatch(/mobile number/);
  });

  it("a new link stops the old one", async () => {
    const { quoteId } = await asked();
    const a = await trips.createTripQuoteLink(d, mgr(), quoteId);
    const b = await trips.createTripQuoteLink(d, mgr(), quoteId);
    expect(await lookupWorkshopLink(d, a.token)).toBeNull();
    expect((await lookupWorkshopLink(d, b.token))?.kind).toBe("trip_quote");
  });
});

describe("using the link without signing in", () => {
  it("shows the trip only, and records the quote against the request; the people who award are told", async () => {
    const { trip, quoteId } = await asked();
    const { token } = await trips.createTripQuoteLink(d, mgr(), quoteId);
    const found = await lookupWorkshopLink(d, token);
    expect(found?.kind).toBe("trip_quote");
    if (found?.kind !== "trip_quote") throw new Error("not a trip quote link");
    expect(found.view.from_place).toBe("Lahore");
    expect(Object.keys(found.view).sort()).toEqual(["currency", "end_at", "from_place", "passengers", "purpose", "start_at", "stops", "to_place", "trip_no", "vendor_name"]);
    expect(await submitViaTripQuoteLink(d, token, { amount: "72,500", vehicle_text: "Hino LEA-123", driver_text: "Rashid", notes: "Fuel included", valid_until: "2031-05-09" })).toEqual({ ok: true });
    const q = (await trips.listTripQuotes(d, mgr(), trip))[0];
    expect([q.status, q.amount, q.vehicle_text, q.notes]).toEqual(["quoted", "72500.00", "Hino LEA-123", "Fuel included"]);
    const ev = (await trips.getTrip(d, mgr(), trip))!.events.map((e) => e.note);
    expect(ev.some((n) => n?.includes("Quote from Alpha Freight through a link: 72,500.00"))).toBe(true);
    const n = await raw(async (q) => (await q.query<{ n: string }>("select count(*)::text n from notifications where kind = 'trip.quote_received' and payload->>'trip_id' = $1", [trip])).rows[0].n);
    expect(Number(n)).toBeGreaterThan(0);
    // and the fleet office can award it exactly as for a quote it typed in
    await trips.awardTripQuote(d, logi(), trip, q.id);
    expect((await trips.getTrip(d, logi(), trip))!.outsourced_vendor).toBe("Alpha Freight");
  });

  it("works once", async () => {
    const { quoteId } = await asked();
    const { token } = await trips.createTripQuoteLink(d, mgr(), quoteId);
    expect(await submitViaTripQuoteLink(d, token, { amount: "50000" })).toEqual({ ok: true });
    expect(await submitViaTripQuoteLink(d, token, { amount: "40000" })).toEqual({ ok: false, reason: "invalid" });
    expect(await lookupWorkshopLink(d, token)).toBeNull();
  });

  it("a refused quote does not burn the link", async () => {
    const { quoteId } = await asked();
    const { token } = await trips.createTripQuoteLink(d, mgr(), quoteId);
    expect((await submitViaTripQuoteLink(d, token, { amount: "0" })).ok).toBe(false);
    expect((await submitViaTripQuoteLink(d, token, { amount: "abc" })).ok).toBe(false);
    expect(await submitViaTripQuoteLink(d, token, { amount: "61000" })).toEqual({ ok: true });
  });

  it("stops working when the trip is no longer open (rejected) or the provider was declined", async () => {
    const a = await asked();
    const la = await trips.createTripQuoteLink(d, mgr(), a.quoteId);
    await trips.transitionTrip(d, mgr(), a.trip, "rejected", { note: "No budget this month" });
    expect(await lookupWorkshopLink(d, la.token)).toBeNull();
    expect(await submitViaTripQuoteLink(d, la.token, { amount: "50000" })).toEqual({ ok: false, reason: "invalid" });
    const b = await asked();
    const lb = await trips.createTripQuoteLink(d, mgr(), b.quoteId);
    await trips.declineTripQuote(d, mgr(), b.quoteId);
    expect(await submitViaTripQuoteLink(d, lb.token, { amount: "50000" })).toEqual({ ok: false, reason: "invalid" });
  });

  it("a trip quote link cannot be used as a workshop estimate link, and is not made for a trip with no request", async () => {
    const { quoteId } = await asked();
    const { token } = await trips.createTripQuoteLink(d, mgr(), quoteId);
    expect(await submitViaQuoteLink(d, token, { lines: [{ kind: "service", description: "x", qty: "1", unit_cost: "1" }] })).toEqual({ ok: false, reason: "invalid" });
    expect(await trips.createTripQuoteLink(d, mgr(), "00000000-0000-4000-8000-000000000000").catch((e) => e)).toBeInstanceOf(UserError);
  });
});

describe("what the link's database role can reach", () => {
  it("has no table access, only the two functions", async () => {
    const run = (sql: string) => withLinkContext(d, t.schema, (q) => q.query(sql), "quotation_link").then(() => "ok", (e: Error) => e.message);
    expect(await run("select * from trip_quotes")).toMatch(/permission denied/);
    expect(await run("select * from trips")).toMatch(/permission denied/);
    expect(await run("select * from trip_quote_link_info('00000000-0000-4000-8000-000000000000')")).toBe("ok");
  });
});
