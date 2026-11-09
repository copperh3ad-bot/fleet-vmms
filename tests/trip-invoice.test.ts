import { beforeAll, describe, expect, it, vi } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withLinkContext, withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import * as trips from "@/lib/trips/service";
import { hashToken } from "@/lib/odometer/link";
import { lookupWorkshopLink, submitViaTripInvoiceLink, submitViaTripQuoteLink } from "@/lib/vendorflow/link";

// ADR-078 phase B2: the awarded provider invoices a completed trip through a single-use link; Finance checks it.
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
const fin = () => mem("finance", 20);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);
let provA: string;
const at = (day: number, hour: number) => `2031-06-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;
const inv = (over: Record<string, unknown> = {}) => ({ invoice_no: "INV-77", invoice_date: "2031-06-12", amount: "72,500", notes: "Fuel included", ...over });

/** A trip awarded to Alpha Freight at 72,500 and marked completed. The awarding is done by Logistics. */
async function completed(): Promise<string> {
  const trip = await trips.requestTrip(d, req(), { purpose: "Move machinery to Faisalabad", from_place: "Lahore", to_place: "Faisalabad", start_at: at(10, 8), end_at: at(10, 18) });
  await trips.requestTripQuotes(d, mgr(), trip, [provA]);
  const q = (await trips.listTripQuotes(d, mgr(), trip))[0];
  await trips.recordTripQuote(d, mgr(), q.id, { amount: "72500" });
  await trips.awardTripQuote(d, logi(), trip, q.id);
  await trips.transitionTrip(d, mgr(), trip, "started");
  await trips.transitionTrip(d, mgr(), trip, "completed");
  return trip;
}
const invoiceOf = async (trip: string) => (await trips.listTripInvoices(d, fin(), trip))[0];

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Invoice Haul Co", slug: "invhaul", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  for (const [n, name] of [[11, "Requester One"], [12, "Manager One"], [19, "Logistics One"], [20, "Finance One"]] as const) {
    const id = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` })).id;
    await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), id]));
  }
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[11, "requester"], [12, "fleet_manager"], [19, "logistics"], [20, "finance"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  await raw((q) => q.query("insert into settings(key, value) values ('module_trips','1') on conflict (key) do update set value = '1'"));
  provA = (await master.saveVendor(d, owner(), { name: "Alpha Freight", kind: "logistics", phone: "0300 1111111" })).id;
});

describe("making the invoice link", () => {
  it("only for an awarded trip that has been returned, to the provider's own number, by someone who may award", async () => {
    const open = await trips.requestTrip(d, req(), { purpose: "Local move", from_place: "Lahore", to_place: "Kasur", start_at: at(11, 8), end_at: at(11, 18) });
    expect((await trips.createTripInvoiceLink(d, mgr(), open).catch((e) => e)).message).toMatch(/not given to a logistics provider/);
    const trip = await completed();
    const l = await trips.createTripInvoiceLink(d, logi(), trip);
    expect(l.phone.e164).toBe("+923001111111");
    const rows = await withPlatform(d, async (q) => (await q.query<Record<string, unknown>>("select * from public.quotation_links where token_hash = $1", [hashToken(l.token)])).rows);
    expect(rows[0].kind).toBe("trip_invoice");
    expect(JSON.stringify(rows[0])).not.toContain(l.token);
    expect(await trips.createTripInvoiceLink(d, req(), trip).catch((e) => e)).toBeInstanceOf(ForbiddenError);
    expect(await trips.createTripInvoiceLink(d, fin(), trip).catch((e) => e)).toBeInstanceOf(ForbiddenError);
    plan.pro = false;
    try { expect((await trips.createTripInvoiceLink(d, mgr(), trip).catch((e) => e)).message).toMatch(/Pro plan/); } finally { plan.pro = true; }
  });

  it("is refused before the trip is returned, and a new link stops the old one", async () => {
    const trip = await trips.requestTrip(d, req(), { purpose: "Move stock", from_place: "Lahore", to_place: "Multan", start_at: at(12, 8), end_at: at(12, 18) });
    await trips.requestTripQuotes(d, mgr(), trip, [provA]);
    const q = (await trips.listTripQuotes(d, mgr(), trip))[0];
    await trips.recordTripQuote(d, mgr(), q.id, { amount: "50000" });
    await trips.awardTripQuote(d, logi(), trip, q.id);
    expect((await trips.createTripInvoiceLink(d, mgr(), trip).catch((e) => e)).message).toMatch(/marked as returned/);
    await trips.transitionTrip(d, mgr(), trip, "started");
    await trips.transitionTrip(d, mgr(), trip, "completed");
    const a = await trips.createTripInvoiceLink(d, mgr(), trip), b = await trips.createTripInvoiceLink(d, mgr(), trip);
    expect(await lookupWorkshopLink(d, a.token)).toBeNull();
    expect((await lookupWorkshopLink(d, b.token))?.kind).toBe("trip_invoice");
  });
});

describe("sending the invoice without signing in", () => {
  it("shows the trip and the agreed price only; saves the invoice; tells Finance", async () => {
    const trip = await completed();
    const { token } = await trips.createTripInvoiceLink(d, mgr(), trip);
    const found = await lookupWorkshopLink(d, token);
    if (found?.kind !== "trip_invoice") throw new Error("not a trip invoice link");
    expect(found.view.award_amount).toBe("72500.00");
    expect(Object.keys(found.view).sort()).toEqual(["award_amount", "currency", "end_at", "from_place", "purpose", "start_at", "to_place", "trip_no", "vendor_name"]);
    expect(await submitViaTripInvoiceLink(d, token, inv())).toEqual({ ok: true });
    const i = await invoiceOf(trip);
    expect([i.invoice_no, i.amount, i.status, i.notes]).toEqual(["INV-77", "72500.00", "submitted", "Fuel included"]);
    const n = await raw(async (q) => (await q.query<{ n: string }>("select count(*)::text n from notifications where kind = 'trip.invoice_received' and payload->>'trip_id' = $1", [trip])).rows[0].n);
    expect(Number(n)).toBeGreaterThan(0);
    expect((await trips.getTrip(d, mgr(), trip))!.events.some((e) => e.note?.includes("Invoice INV-77 from Alpha Freight through a link"))).toBe(true);
  });

  it("works once, and a refused invoice does not burn it", async () => {
    const trip = await completed();
    const { token } = await trips.createTripInvoiceLink(d, mgr(), trip);
    for (const bad of [inv({ invoice_no: "" }), inv({ amount: "0" }), inv({ amount: "abc" }), inv({ invoice_date: "" })]) expect((await submitViaTripInvoiceLink(d, token, bad)).ok).toBe(false);
    expect(await submitViaTripInvoiceLink(d, token, inv())).toEqual({ ok: true });
    expect(await submitViaTripInvoiceLink(d, token, inv({ invoice_no: "INV-78" }))).toEqual({ ok: false, reason: "invalid" });
  });

  it("a trip quote link is not an invoice link", async () => {
    const trip = await completed();
    const { token } = await trips.createTripInvoiceLink(d, mgr(), trip);
    expect(await submitViaTripQuoteLink(d, token, { amount: "1000" })).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("Finance checks the invoice", () => {
  it("pays the agreed amount when the invoice matches; the record names Finance and the amount", async () => {
    const trip = await completed();
    const { token } = await trips.createTripInvoiceLink(d, mgr(), trip);
    await submitViaTripInvoiceLink(d, token, inv({ amount: "72500" }));
    const i = await invoiceOf(trip);
    expect(await trips.verifyTripInvoice(d, mgr(), i.id, "pay_approved").catch((e) => e)).toBeInstanceOf(ForbiddenError);
    await trips.verifyTripInvoice(d, fin(), i.id, "pay_approved");
    const after = await invoiceOf(trip);
    expect([after.status, after.payable, after.verifier_name]).toEqual(["verified", "72500.00", "Finance One"]);
    expect((await trips.getTrip(d, fin(), trip))!.events.at(-1)?.note).toMatch(/checked, payable 72,500\.00/);
    expect((await trips.verifyTripInvoice(d, fin(), i.id, "pay_approved").catch((e) => e)).message).toMatch(/not waiting for a check/);
    expect((await trips.createTripInvoiceLink(d, mgr(), trip).catch((e) => e)).message).toMatch(/already been sent/);
  });

  it("an invoice that differs needs a note to be paid as billed, and cannot be paid as agreed", async () => {
    const trip = await completed();
    const { token } = await trips.createTripInvoiceLink(d, mgr(), trip);
    await submitViaTripInvoiceLink(d, token, inv({ amount: "80000", notes: "Extra toll" }));
    const i = await invoiceOf(trip);
    expect((await trips.verifyTripInvoice(d, fin(), i.id, "pay_approved").catch((e) => e)).message).toMatch(/differs from the awarded amount/);
    expect((await trips.verifyTripInvoice(d, fin(), i.id, "pay_invoiced").catch((e) => e)).message).toMatch(/note of at least 5/);
    await trips.verifyTripInvoice(d, fin(), i.id, "pay_invoiced", "Toll receipt seen");
    expect((await invoiceOf(trip)).payable).toBe("80000.00");
  });

  it("a returned invoice can be replaced through a new link; a note is required to return", async () => {
    const trip = await completed();
    const first = await trips.createTripInvoiceLink(d, mgr(), trip);
    await submitViaTripInvoiceLink(d, first.token, inv({ invoice_no: "INV-A", amount: "90000" }));
    const i = await invoiceOf(trip);
    expect((await trips.verifyTripInvoice(d, fin(), i.id, "return").catch((e) => e)).message).toMatch(/note of at least 5/);
    await trips.verifyTripInvoice(d, fin(), i.id, "return", "Amount does not match the agreement");
    expect((await invoiceOf(trip)).status).toBe("disputed");
    const second = await trips.createTripInvoiceLink(d, mgr(), trip);
    expect(await submitViaTripInvoiceLink(d, second.token, inv({ invoice_no: "INV-B" }))).toEqual({ ok: true });
    expect((await trips.listTripInvoices(d, fin(), trip)).map((x) => [x.invoice_no, x.status]).sort()).toEqual([["INV-A", "disputed"], ["INV-B", "submitted"]]);
  });

  it("the person who awarded the trip cannot check its invoice (the administrator awards, so cannot verify)", async () => {
    const trip = await trips.requestTrip(d, req(), { purpose: "Move boxes", from_place: "Lahore", to_place: "Sialkot", start_at: at(14, 8), end_at: at(14, 18) });
    await trips.requestTripQuotes(d, owner(), trip, [provA]);
    const q = (await trips.listTripQuotes(d, owner(), trip))[0];
    await trips.recordTripQuote(d, owner(), q.id, { amount: "30000" });
    await trips.awardTripQuote(d, owner(), trip, q.id);
    await trips.transitionTrip(d, owner(), trip, "started");
    await trips.transitionTrip(d, owner(), trip, "completed");
    const { token } = await trips.createTripInvoiceLink(d, owner(), trip);
    await submitViaTripInvoiceLink(d, token, inv({ amount: "30000" }));
    const i = (await trips.listTripInvoices(d, owner(), trip))[0];
    expect((await trips.verifyTripInvoice(d, owner(), i.id, "pay_approved").catch((e) => e)).message).toMatch(/segregation of duties/i);
    await trips.verifyTripInvoice(d, fin(), i.id, "pay_approved");
  });
});

describe("who sees an invoiced trip", () => {
  it("Finance sees a trip once a provider has invoiced it, and not a trip it has no part in", async () => {
    const plain = await trips.requestTrip(d, req(), { purpose: "Plain trip", from_place: "Lahore", to_place: "Kasur", start_at: at(15, 8), end_at: at(15, 18) });
    const trip = await completed();
    const { token } = await trips.createTripInvoiceLink(d, mgr(), trip);
    expect(await trips.getTrip(d, fin(), trip)).toBeNull();                          // no invoice yet
    await submitViaTripInvoiceLink(d, token, inv());
    expect(await trips.getTrip(d, fin(), trip)).not.toBeNull();
    expect(await trips.getTrip(d, fin(), plain)).toBeNull();
    expect((await trips.listTrips(d, fin())).map((x) => x.id)).toContain(trip);
  });
});

describe("what the invoice link's database role can reach", () => {
  it("has no table access, only the two functions", async () => {
    const run = (sql: string) => withLinkContext(d, t.schema, (q) => q.query(sql), "quotation_link").then(() => "ok", (e: Error) => e.message);
    expect(await run("select * from trip_invoices")).toMatch(/permission denied/);
    expect(await run("select trip_invoice_verify('00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', 'return', 'xxxxxx')")).toMatch(/permission denied/);
    expect(await run("select * from trip_invoice_link_info('00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000')")).toBe("ok");
  });
});
