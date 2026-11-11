import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as vr from "@/lib/vehicle-requests/service";
import { listNotifications } from "@/lib/jobcards/service";

// ADR-091, owner decisions E1 to E5: Finance confirms a budget, a Fleet Manager or Administrator approves the purchase, dealer quotations are
// recorded, and adding the vehicle closes the request and hands it over.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const hr = () => mem("hr", 61);
const hr2 = () => mem("hr", 66);
const fm = () => mem("fleet_manager", 62);
const fin = () => mem("finance", 63);
const aud = () => mem("auditor", 64);
const logi = () => mem("logistics", 65);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);
let emps: Record<number, string>;
let seq = 0;
const R = async (who: number, by: Membership = hr()) => vr.requestVehicle(d, by, { for_employee: emps[who], reason: "Joins the sales team", needed_from: "2031-04-01" });
const status = (id: string) => raw(async (q) => (await q.query<{ status: string }>("select status from vehicle_requests where id = $1", [id])).rows[0].status);
const quote = (over: Record<string, unknown> = {}) => ({ dealer: "Honda Atlas", vehicle: "Civic Oriel 2031", amount: "6500000", ...over });

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Purchase Ltd", slug: "purchase", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  emps = {};
  for (const [n, name, linked] of [[61, "Hina HR", true], [62, "Manager Two", true], [63, "Fatima Finance", true], [66, "Second HR", true], [71, "Worker A", false], [72, "Worker B", false], [73, "Worker C", false], [74, "Worker D", false], [75, "Worker E", false], [76, "Worker F", false], [77, "Worker G", false]] as const) {
    emps[n] = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `P-${n}` })).id;
    if (linked) await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), emps[n]]));
  }
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[61, "hr"], [62, "fleet_manager"], [63, "finance"], [64, "auditor"], [65, "logistics"], [66, "hr"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
});

describe("the budget step", () => {
  it("lets Finance confirm a budget, and nobody else, and needs an amount", async () => {
    const id = await R(71);
    await expect(vr.transitionVehicleRequest(d, fm(), id, "budget_confirmed", { amount: 1000 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(vr.transitionVehicleRequest(d, hr(), id, "budget_confirmed", { amount: 1000 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(vr.transitionVehicleRequest(d, aud(), id, "budget_confirmed", { amount: 1000 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(vr.transitionVehicleRequest(d, fin(), id, "budget_confirmed", {})).rejects.toBeInstanceOf(UserError);
    await vr.transitionVehicleRequest(d, fin(), id, "budget_confirmed", { amount: 7_000_000, note: "From the 2031 vehicle budget" });
    const x = (await vr.getVehicleRequest(d, fin(), id))!;
    expect(x).toMatchObject({ status: "budget_confirmed", purchase_budget: "7000000.00" });
    expect(x.events.at(-1)!.note).toMatch(/^Budget 7,000,000\.00: From the 2031 vehicle budget$/);
  });

  it("cannot be approved before Finance has confirmed a budget", async () => {
    const id = await R(72);
    await expect(vr.transitionVehicleRequest(d, fm(), id, "purchase_approved", { note: "Buy" })).rejects.toThrow(/illegal vehicle request transition/i);
    await vr.transitionVehicleRequest(d, fin(), id, "budget_confirmed", { amount: 5_000_000 });
    await expect(vr.transitionVehicleRequest(d, fin(), id, "purchase_approved", {})).rejects.toBeInstanceOf(ForbiddenError);      // Finance does not approve
    await vr.transitionVehicleRequest(d, fm(), id, "purchase_approved", { note: "Go ahead" });
    expect(await status(id)).toBe("purchase_approved");
  });

  it("lets Finance change the budget before approval, and tells the people who approve", async () => {
    const id = await R(73);
    await vr.transitionVehicleRequest(d, fin(), id, "budget_confirmed", { amount: 4_000_000 });
    await vr.transitionVehicleRequest(d, fin(), id, "budget_confirmed", { amount: 4_500_000, note: "Revised" });
    expect((await vr.getVehicleRequest(d, fin(), id))!.purchase_budget).toBe("4500000.00");
    expect((await listNotifications(d, fm())).some((n) => n.kind === "vreq.budget_confirmed" && n.payload.request_id === id)).toBe(true);
    expect((await listNotifications(d, hr())).some((n) => n.kind === "vreq.budget_confirmed" && n.payload.request_id === id)).toBe(true);
  });

  it("does not let a person confirm a budget for their own request", async () => {
    const own = await R(63, hr());                                                    // Finance's own employee record
    await expect(vr.transitionVehicleRequest(d, fin(), own, "budget_confirmed", { amount: 100 })).rejects.toThrow(/segregation of duties/i);
  });

  it("lets Finance see the requests it confirms, read-only", async () => {
    const id = await R(74);
    expect((await vr.listVehicleRequests(d, fin())).map((r) => r.id)).toContain(id);
    await expect(vr.transitionVehicleRequest(d, fin(), id, "assigned", { vehicleId: undefined })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("dealer quotations", () => {
  it("are added by HR on its own request and by the people who decide, shown lowest first", async () => {
    const id = await R(75);
    await vr.addDealerQuote(d, hr(), id, quote());
    await vr.addDealerQuote(d, fin(), id, quote({ dealer: "Toyota Indus", vehicle: "Corolla Altis", amount: "5900000", valid_until: "2031-05-01", note: "Includes registration" }));
    await vr.addDealerQuote(d, fm(), id, quote({ dealer: "Suzuki Dealer", vehicle: "Cultus", amount: "3100000" }));
    const qs = (await vr.getVehicleRequest(d, fm(), id))!.quotes;
    expect(qs.map((k) => [k.dealer, k.amount])).toEqual([["Suzuki Dealer", "3100000.00"], ["Toyota Indus", "5900000.00"], ["Honda Atlas", "6500000.00"]]);
  });

  it("are refused for other HR staff, the auditor and bad input", async () => {
    const id = await R(76);
    await expect(vr.addDealerQuote(d, hr2(), id, quote())).rejects.toBeInstanceOf(ForbiddenError);       // someone else's request
    await expect(vr.addDealerQuote(d, aud(), id, quote())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(vr.addDealerQuote(d, mem("requester", 67), id, quote())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(vr.addDealerQuote(d, hr(), id, quote({ amount: "0" }))).rejects.toBeInstanceOf(UserError);
    await expect(vr.addDealerQuote(d, hr(), id, quote({ dealer: "" }))).rejects.toBeInstanceOf(UserError);
  });

  it("can be removed by who added them or who decides, and are locked once the purchase is approved", async () => {
    const id = await R(77);
    await vr.addDealerQuote(d, hr(), id, quote());
    await vr.addDealerQuote(d, hr(), id, quote({ dealer: "Other", amount: "1" }));
    const [a, b] = (await vr.getVehicleRequest(d, hr(), id))!.quotes;
    await expect(vr.removeDealerQuote(d, fin(), a.id)).rejects.toBeInstanceOf(ForbiddenError);       // Finance did not add it and does not decide
    await vr.removeDealerQuote(d, hr(), a.id);
    await vr.removeDealerQuote(d, fm(), b.id);
    await vr.addDealerQuote(d, hr(), id, quote());
    await vr.transitionVehicleRequest(d, fin(), id, "budget_confirmed", { amount: 7_000_000 });
    await vr.transitionVehicleRequest(d, fm(), id, "purchase_approved", {});
    await expect(vr.addDealerQuote(d, hr(), id, quote())).rejects.toThrow(/until the purchase is approved/);
  });
});

describe("adding the vehicle hands it over (E5)", () => {
  const newEmployee = async (name: string) => (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `PB-${++seq}-${name.replace(/\W/g, "").slice(0, 6)}` })).id;
  const opened = async (name: string) => vr.requestVehicle(d, hr(), { for_employee: await newEmployee(name), reason: "Joins the sales team", needed_from: "2031-04-01" });
  async function approved(name: string): Promise<{ id: string; emp: string }> {
    const emp = await newEmployee(name);
    const id = await vr.requestVehicle(d, hr(), { for_employee: emp, reason: "Joins the sales team", needed_from: "2031-04-01" });
    await vr.transitionVehicleRequest(d, fin(), id, "budget_confirmed", { amount: 7_000_000 });
    await vr.transitionVehicleRequest(d, fm(), id, "purchase_approved", { note: "Go" });
    return { id, emp };
  }
  const plate = () => `PUR-${String(++seq).padStart(3, "0")}`;
  const addFor = (m: Membership, id: string, registration_no: string) =>
    master.addVehicle(d, m, { registration_no, make: "Honda", model: "Civic" }, { afterCreate: (q, vid, p) => vr.handOverPurchasedVehicle(q, m, id, vid, p) });
  const holderOf = (vehicle: string) => raw(async (q) => (await q.query<{ employee_id: string }>("select employee_id from vehicle_custody where vehicle_id = $1 and to_date is null", [vehicle])).rows[0]?.employee_id);

  it("closes the request and makes the employee the holder in the same save", async () => {
    const { id, emp } = await approved("New Joiner One");
    const p = plate();
    const v = await addFor(fm(), id, p);
    expect(await status(id)).toBe("assigned");
    expect(await holderOf(v.id)).toBe(emp);
    const x = (await vr.getVehicleRequest(d, fm(), id))!;
    expect(x).toMatchObject({ status: "assigned", registration_no: p });
    expect(x.events.at(-1)).toMatchObject({ to_status: "assigned", note: `Bought and added: ${p}` });
    expect((await listNotifications(d, hr())).some((n) => n.kind === "vreq.assigned" && n.payload.request_id === id)).toBe(true);
  });

  it("saves nothing when the request is not an approved purchase", async () => {
    const open = await opened("Waiting One");                                          // an open request that is only waiting for a decision
    const p = plate();
    await expect(addFor(fm(), open, p)).rejects.toThrow(/not an approved purchase/);
    const vehicles = await raw(async (q) => (await q.query("select 1 from vehicles where registration_no = $1", [p])).rows.length);
    expect(vehicles).toBe(0);                                                         // the vehicle was rolled back with the failed hand-over
  });

  it("refuses a person who may add vehicles but not give them", async () => {
    const { id } = await approved("New Joiner Two");
    const p = plate();
    await expect(addFor(logi(), id, p)).rejects.toBeInstanceOf(Error);                // Logistics cannot add vehicles at all
    expect(await status(id)).toBe("purchase_approved");
  });

  it("stays an approved purchase until the vehicle exists, and a closed request cannot be handed a second vehicle", async () => {
    const { id } = await approved("New Joiner Three");
    expect(await status(id)).toBe("purchase_approved");
    await addFor(fm(), id, plate());
    await expect(addFor(fm(), id, plate())).rejects.toThrow(/not an approved purchase/);
  });

  it("looks up the approved purchase for the Add a vehicle screen", async () => {
    const { id } = await approved("New Joiner Four");
    expect(await vr.purchaseAwaitingVehicle(d, fm(), id)).toMatchObject({ id, for_name: "New Joiner Four" });
    expect(await vr.purchaseAwaitingVehicle(d, fm(), await opened("Waiting Two"))).toBeNull();          // not approved yet
    await expect(vr.purchaseAwaitingVehicle(d, hr(), id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
