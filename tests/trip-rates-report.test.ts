import { beforeAll, describe, expect, it, vi } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import * as trips from "@/lib/trips/service";
import { listProviderRates, outsourcedTripReport, removeProviderRate, saveProviderRate } from "@/lib/trips/outsourced";
import { exportCsv } from "@/lib/exports/service";
import { submitViaTripInvoiceLink } from "@/lib/vendorflow/link";

// ADR-078 phase C: each organization's own reference rates for its providers, and what outsourced trips cost per provider.
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
const aud = () => mem("auditor", 16);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);
let alpha: string, bravo: string, workshop: string;
const at = (day: number, hour: number) => `2031-07-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;

/** A trip quoted by both providers, awarded to `winner` at its quote, returned. */
async function awarded(quotes: Record<string, string>, winner: string, day: number): Promise<string> {
  const trip = await trips.requestTrip(d, req(), { purpose: "Move stock", from_place: "Lahore", to_place: "Multan", start_at: at(day, 8), end_at: at(day, 18) });
  await trips.requestTripQuotes(d, mgr(), trip, Object.keys(quotes));
  for (const q of await trips.listTripQuotes(d, mgr(), trip)) await trips.recordTripQuote(d, mgr(), q.id, { amount: quotes[q.vendor_id] });
  await trips.awardTripQuote(d, logi(), trip, (await trips.listTripQuotes(d, mgr(), trip)).find((q) => q.vendor_id === winner)!.id);
  await trips.transitionTrip(d, mgr(), trip, "started");
  await trips.transitionTrip(d, mgr(), trip, "completed");
  return trip;
}

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Rates Co", slug: "ratesco", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  for (const [n, name] of [[11, "Requester One"], [12, "Manager One"], [19, "Logistics One"], [20, "Finance One"], [16, "Auditor One"]] as const) {
    const id = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` })).id;
    await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), id]));
  }
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[11, "requester"], [12, "fleet_manager"], [19, "logistics"], [20, "finance"], [16, "auditor"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  await raw((q) => q.query("insert into settings(key, value) values ('module_trips','1') on conflict (key) do update set value = '1'"));
  alpha = (await master.saveVendor(d, owner(), { name: "Alpha Freight", kind: "logistics", phone: "0300 1111111" })).id;
  bravo = (await master.saveVendor(d, owner(), { name: "Bravo Haulage", kind: "logistics", phone: "0300 2222222" })).id;
  workshop = (await master.saveVendor(d, owner(), { name: "Auto Works", kind: "workshop" })).id;
});

describe("each organization's own rate cards", () => {
  it("are entered by whoever manages vendors, for logistics providers only, and listed beside the quotes", async () => {
    await saveProviderRate(d, owner(), { vendor_id: alpha, label: "Lahore to Karachi, 10-tonne truck", basis: "per_trip", amount: "185,000", notes: "Fuel extra" });
    await saveProviderRate(d, owner(), { vendor_id: alpha, label: "Local run", basis: "per_km", amount: "95" });
    await saveProviderRate(d, owner(), { vendor_id: bravo, label: "Day hire, pickup", basis: "per_day", amount: "22000" });
    expect((await saveProviderRate(d, owner(), { vendor_id: workshop, label: "Oil change", basis: "per_trip", amount: "1000" }).catch((e) => e)).message).toMatch(/logistics provider/);
    const all = await listProviderRates(d, logi());
    expect(all.map((r) => [r.vendor_name, r.label, r.basis, r.amount])).toEqual([
      ["Alpha Freight", "Local run", "per_km", "95.00"], ["Alpha Freight", "Lahore to Karachi, 10-tonne truck", "per_trip", "185000.00"], ["Bravo Haulage", "Day hire, pickup", "per_day", "22000.00"],
    ].sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1])).map((x) => x) as never);
    expect((await listProviderRates(d, owner(), bravo)).map((r) => r.label)).toEqual(["Day hire, pickup"]);
  });

  it("are checked: a label, a basis and a positive rate; a requester cannot enter or read them; Basic cannot enter them", async () => {
    expect((await saveProviderRate(d, owner(), { vendor_id: alpha, label: "x", basis: "per_trip", amount: "0" }).catch((e) => e)).message).toMatch(/Fix the highlighted/);
    expect((await saveProviderRate(d, owner(), { vendor_id: alpha, label: "Run", basis: "weekly", amount: "10" }).catch((e) => e)).message).toMatch(/Fix the highlighted/);
    expect(await saveProviderRate(d, req(), { vendor_id: alpha, label: "Run", basis: "per_trip", amount: "10" }).catch((e) => e)).toBeInstanceOf(ForbiddenError);
    expect(await listProviderRates(d, req()).catch((e) => e)).toBeInstanceOf(ForbiddenError);
    plan.pro = false;
    try { expect((await saveProviderRate(d, owner(), { vendor_id: alpha, label: "Run", basis: "per_trip", amount: "10" }).catch((e) => e)).message).toMatch(/Pro plan/); } finally { plan.pro = true; }
  });

  it("can be removed, and one organization's rates are not another's", async () => {
    const [first] = await listProviderRates(d, owner(), bravo);
    await removeProviderRate(d, owner(), first.id);
    expect(await listProviderRates(d, owner(), bravo)).toEqual([]);
    expect((await removeProviderRate(d, owner(), first.id).catch((e) => e)).message).toMatch(/already gone/);
  });
});

describe("what outsourced trips cost per provider", () => {
  let tripA: string, tripB: string;
  beforeAll(async () => {
    tripA = await awarded({ [alpha]: "80000", [bravo]: "95000" }, alpha, 10);           // saved 15,000 by choosing Alpha
    tripB = await awarded({ [alpha]: "60000", [bravo]: "55000" }, bravo, 11);           // saved 5,000
    await awarded({ [alpha]: "40000" }, alpha, 12);                                    // only one quote: nothing saved, and no invoice yet
    for (const [trip, amount] of [[tripA, "80000"], [tripB, "57000"]] as const) {
      const { token } = await trips.createTripInvoiceLink(d, mgr(), trip);
      await submitViaTripInvoiceLink(d, token, { invoice_no: `INV-${amount}`, invoice_date: "2031-07-20", amount });
    }
    const a = (await trips.listTripInvoices(d, fin(), tripA))[0], b = (await trips.listTripInvoices(d, fin(), tripB))[0];
    await trips.verifyTripInvoice(d, fin(), a.id, "pay_approved");
    await trips.verifyTripInvoice(d, fin(), b.id, "pay_invoiced", "Extra toll receipt seen");
  });

  it("counts trips, the awarded and invoiced amounts, what Finance has checked, what comparing saved, and trips still waiting for an invoice", async () => {
    // the test trips were awarded just now, whatever dates they carry
    const { rows } = await outsourcedTripReport(d, owner(), 12);
    const by = Object.fromEntries(rows.map((r) => [r.vendor_name, r]));
    expect(by["Alpha Freight"]).toMatchObject({ trips: 2, awarded: "120000.00", invoiced: "80000.00", payable: "80000.00", saved: "15000.00", waiting_invoice: 1 });
    expect(by["Bravo Haulage"]).toMatchObject({ trips: 1, awarded: "55000.00", invoiced: "57000.00", payable: "57000.00", saved: "5000.00", waiting_invoice: 0 });
    expect(rows[0].vendor_name).toBe("Alpha Freight");                                 // largest awarded first
  });

  it("is open to those who award, read all trips or check invoices, and to no one else; an unlisted period means twelve months", async () => {
    for (const who of [logi(), aud(), fin(), mgr()]) expect((await outsourcedTripReport(d, who, 99)).months).toBe(12);
    expect(await outsourcedTripReport(d, req(), 12).catch((e) => e)).toBeInstanceOf(ForbiddenError);
    expect((await outsourcedTripReport(d, owner(), 3)).rows.length).toBe(2);
  });

  it("downloads as CSV with the same people and a trip per row", async () => {
    const r = await exportCsv(d, fin(), "outsourced-trips", { months: "12" });
    expect(r.rows).toBe(3);
    expect(r.csv).toContain("Alpha Freight");
    expect(r.csv.split("\n")[0]).toContain("Awarded price");
    expect(await exportCsv(d, req(), "outsourced-trips").catch((e) => e)).toBeInstanceOf(ForbiddenError);
  });
});
