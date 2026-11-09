import { beforeAll, describe, expect, it, vi } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import * as trips from "@/lib/trips/service";

// ADR-078 phase A: a trip goes to several logistics providers, each quotes, one is awarded. A Pro feature.
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
let provA: string, provB: string, provC: string, workshop: string;
const at = (day: number, hour: number) => `2031-04-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;
const trip = (requester = req()) => trips.requestTrip(d, requester, { purpose: "Move machinery to Faisalabad", from_place: "Lahore", to_place: "Faisalabad", start_at: at(10, 8), end_at: at(10, 18) });
const quotes = (id: string) => trips.listTripQuotes(d, mgr(), id);
const byName = async (id: string, name: string) => (await quotes(id)).find((x) => x.vendor_name === name)!;

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Haul Co", slug: "haul", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
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
  provB = (await master.saveVendor(d, owner(), { name: "Bravo Haulage", kind: "logistics", phone: "0300 2222222" })).id;
  provC = (await master.saveVendor(d, owner(), { name: "Charlie Cargo", kind: "logistics" })).id;
  workshop = (await master.saveVendor(d, owner(), { name: "Auto Works", kind: "workshop" })).id;
});

describe("vendor types", () => {
  it("a vendor is a workshop unless it is made a logistics provider, and the type can be changed", async () => {
    const rows = await master.listVendors(d, owner());
    expect(rows.find((v) => v.name === "Auto Works")?.kind).toBe("workshop");
    expect(rows.find((v) => v.name === "Alpha Freight")?.kind).toBe("logistics");
    const plain = (await master.saveVendor(d, owner(), { name: "No Type Given" })).id;
    expect((await master.listVendors(d, owner())).find((v) => v.id === plain)?.kind).toBe("workshop");
    await master.saveVendor(d, owner(), { name: "No Type Given", kind: "logistics" }, plain);
    expect((await master.listVendors(d, owner())).find((v) => v.id === plain)?.kind).toBe("logistics");
  });
  it("only logistics providers are listed for trips", async () => {
    const names = (await trips.listLogisticsProviders(d, mgr())).map((p) => p.name);
    expect(names).toContain("Alpha Freight");
    expect(names).not.toContain("Auto Works");
  });
});

describe("asking for quotes", () => {
  it("is a Pro feature", async () => {
    const id = await trip();
    plan.pro = false;
    try {
      expect((await trips.requestTripQuotes(d, mgr(), id, [provA]).catch((e) => e)).message).toMatch(/Pro plan/);
      expect(await trips.outsourcingOn(d, mgr())).toBe(false);
    } finally { plan.pro = true; }
    expect(await trips.outsourcingOn(d, mgr())).toBe(true);
  });

  it("needs trip.award: a requester cannot ask providers or read the quotes", async () => {
    const id = await trip();
    expect(await trips.requestTripQuotes(d, req(), id, [provA]).catch((e) => e)).toBeInstanceOf(ForbiddenError);
    expect(await trips.listTripQuotes(d, req(), id).catch((e) => e)).toBeInstanceOf(ForbiddenError);
  });

  it("one trip goes to several providers; asking again does not duplicate; a workshop is refused", async () => {
    const id = await trip();
    expect(await trips.requestTripQuotes(d, mgr(), id, [provA, provB, provC])).toBe(3);
    expect(await trips.requestTripQuotes(d, mgr(), id, [provA, provB])).toBe(0);
    expect((await quotes(id)).map((x) => x.status)).toEqual(["requested", "requested", "requested"]);
    expect((await trips.requestTripQuotes(d, mgr(), id, [workshop]).catch((e) => e)).message).toMatch(/logistics providers only/);
    expect((await trips.requestTripQuotes(d, mgr(), id, []).catch((e) => e)).message).toMatch(/at least one/);
  });
});

describe("recording and awarding quotes", () => {
  let id: string;
  it("each provider's quote is recorded against its request, and the trip history says so", async () => {
    id = await trip();
    await trips.requestTripQuotes(d, logi(), id, [provA, provB, provC]);
    await trips.recordTripQuote(d, logi(), (await byName(id, "Alpha Freight")).id, { amount: "85,000", vehicle_text: "Hino truck LEA-123", driver_text: "Rashid", valid_until: "2031-04-09" });
    await trips.recordTripQuote(d, logi(), (await byName(id, "Bravo Haulage")).id, { amount: "72000", notes: "Fuel included" });
    expect((await trips.recordTripQuote(d, logi(), (await byName(id, "Bravo Haulage")).id, { amount: "0" }).catch((e) => e)).message).toMatch(/Fix the highlighted/);
    const q = await quotes(id);
    expect(q.map((x) => [x.vendor_name, x.status, x.amount])).toEqual([["Bravo Haulage", "quoted", "72000.00"], ["Alpha Freight", "quoted", "85000.00"], ["Charlie Cargo", "requested", null]]);
    const ev = (await trips.getTrip(d, logi(), id))!.events.map((e) => e.note);
    expect(ev.some((n) => n?.includes("Quote asked from"))).toBe(true);
    expect(ev.some((n) => n?.includes("Quote from Bravo Haulage: 72,000.00"))).toBe(true);
  });

  it("a provider that says no is out; a quote can still be corrected before the award", async () => {
    await trips.declineTripQuote(d, logi(), (await byName(id, "Charlie Cargo")).id);
    expect((await byName(id, "Charlie Cargo")).status).toBe("declined");
    await trips.recordTripQuote(d, logi(), (await byName(id, "Bravo Haulage")).id, { amount: "70000", notes: "Fuel included" });
    expect((await byName(id, "Bravo Haulage")).amount).toBe("70000.00");
  });

  it("the requester cannot award their own trip, and a quote not yet given cannot be awarded", async () => {
    const own = await trip(mgr());
    await trips.requestTripQuotes(d, logi(), own, [provA]);
    await trips.recordTripQuote(d, logi(), (await byName(own, "Alpha Freight")).id, { amount: "50000" });
    expect((await trips.awardTripQuote(d, mgr(), own, (await byName(own, "Alpha Freight")).id).catch((e) => e)).message).toMatch(/cannot award your own/i);
    expect((await trips.awardTripQuote(d, logi(), id, (await byName(id, "Charlie Cargo")).id).catch((e) => e)).message).toMatch(/not available to award/);
    expect(await trips.awardTripQuote(d, req(), id, (await byName(id, "Alpha Freight")).id).catch((e) => e)).toBeInstanceOf(ForbiddenError);
  });

  it("Logistics awards: the trip is approved as outsourced, the others close (one that said no stays declined), and no vehicle or driver of ours is needed", async () => {
    await trips.awardTripQuote(d, logi(), id, (await byName(id, "Bravo Haulage")).id, "Cheapest, fuel included");
    const q = await quotes(id);
    expect(q.map((x) => [x.vendor_name, x.status])).toEqual([["Bravo Haulage", "awarded"], ["Alpha Freight", "closed"], ["Charlie Cargo", "declined"]]);
    const tr = (await trips.getTrip(d, logi(), id))!;
    expect(tr.status).toBe("approved");
    expect(tr.outsourced_vendor).toBe("Bravo Haulage");
    expect(tr.award_amount).toBe("70000.00");
    expect(tr.registration_no).toBeNull();
    expect(tr.events.at(-1)?.note).toMatch(/^Awarded to Bravo Haulage at 70,000\.00\. Cheapest, fuel included/);
    expect((await trips.recordTripQuote(d, logi(), q[0].id, { amount: "1" }).catch((e) => e)).message).toMatch(/no longer takes quotes/);
  });

  it("an outsourced trip leaves and returns with no odometer, and writes no reading", async () => {
    await trips.transitionTrip(d, mgr(), id, "started");
    await trips.transitionTrip(d, mgr(), id, "completed");
    expect((await trips.getTrip(d, mgr(), id))!.status).toBe("completed");
    expect((await raw((q) => q.query<{ n: string }>("select count(*)::text n from odometer_readings where source = 'trip'"))).rows[0].n).toBe("0");
  });

  it("a rejected trip closes its open quote requests; the same provider can be asked on another trip", async () => {
    const other = await trip();
    await trips.requestTripQuotes(d, mgr(), other, [provA]);
    await trips.transitionTrip(d, mgr(), other, "rejected", { note: "No budget this month" });
    expect((await quotes(other)).map((x) => x.status)).toEqual(["closed"]);
  });

  it("a trip with our own vehicle still works exactly as before", async () => {
    const veh = (await master.addVehicle(d, owner(), { registration_no: "HAUL-1", make: "Toyota", model: "Hiace" })).id;
    const emp = (await master.saveEmployee(d, owner(), { full_name: "Driver Own", employee_no: "E-90" })).id;
    const own = await trip();
    expect((await trips.transitionTrip(d, mgr(), own, "approved", {}).catch((e) => e)).message).toMatch(/choose a vehicle/i);
    await trips.transitionTrip(d, mgr(), own, "approved", { vehicleId: veh, driverId: emp });
    expect((await trips.transitionTrip(d, mgr(), own, "started", {}).catch((e) => e)).message).toMatch(/odometer/i);
  });
});

describe("the sole-employee administrator (ADR-077)", () => {
  it("trip.award is granted to the Fleet manager, Logistics and the administrator, to nobody else", async () => {
    const r = await raw((q) => q.query<{ role_key: string }>("select role_key from role_permissions where permission_key = 'trip.award' order by role_key"));
    expect(r.rows.map((x) => x.role_key)).toEqual(["fleet_manager", "logistics", "tenant_admin"]);
  });
});

describe("who sees an outsourced trip", () => {
  it("Logistics sees a trip once it has gone to providers, and not an ordinary trip it has no part in", async () => {
    await withTenant(d, owner(), (q) => q.query("update role_departments set sees_all_vehicles = false where role_key = 'logistics'"));
    const plain = await trip(), sent = await trip();
    await trips.requestTripQuotes(d, mgr(), sent, [provA]);
    const ids = (await trips.listTrips(d, logi())).map((x) => x.id);
    expect(ids).toContain(sent);
    expect(ids).not.toContain(plain);
    expect(await trips.getTrip(d, logi(), plain)).toBeNull();
    expect((await trips.getTrip(d, logi(), sent))?.outsourced_visible).toBe(true);
  });
});
