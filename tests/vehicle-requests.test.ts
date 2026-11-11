import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as vr from "@/lib/vehicle-requests/service";
import { listNotifications } from "@/lib/jobcards/service";

// ADR-059: HR vehicle requests. HR asks; an administrator or fleet manager gives a pool vehicle or approves a purchase.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const hr = () => mem("hr", 31);
const mgr = () => mem("fleet_manager", 32);
const worker = () => mem("requester", 33);
const auditor = () => mem("auditor", 34);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);

let emps: Record<number, string>;
let pool: string, held: string, workshop: string;
const R = (n: number, extra: Record<string, unknown> = {}) => ({ for_employee: emps[n], reason: "Joins the sales team", needed_from: "2031-04-01", ...extra });

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Vehicle Requests Ltd", slug: "vreq", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  emps = {};
  for (const [n, name] of [[31, "Hina HR"], [32, "Manager Two"], [33, "Worker Three"], [35, "Worker Five"], [36, "Worker Six"]] as const) {
    emps[n] = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `V-${n}` })).id;
    if (n <= 33) await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), emps[n]]));
  }
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[31, "hr"], [32, "fleet_manager"], [33, "requester"], [34, "auditor"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  pool = (await master.addVehicle(d, owner(), { registration_no: "VRQ-001", make: "Suzuki", model: "Alto" })).id;
  held = (await master.addVehicle(d, owner(), { registration_no: "VRQ-002", make: "Honda", model: "City", employee_id: emps[32], holding_since: "2026-01-01" })).id;
  workshop = (await master.addVehicle(d, owner(), { registration_no: "VRQ-003", make: "Toyota", model: "Hilux" })).id;
  await raw((q) => q.query("update vehicles set status = 'in_workshop' where id = $1", [workshop]));
});

const status = (id: string) => raw(async (q) => (await q.query<{ status: string }>("select status from vehicle_requests where id = $1", [id])).rows[0].status);
const holder = (vehicle: string) => raw(async (q) => (await q.query<{ employee_id: string }>("select employee_id from vehicle_custody where vehicle_id = $1 and to_date is null", [vehicle])).rows[0]?.employee_id);

describe("asking for a vehicle", () => {
  it("lets HR ask for an employee, and records who asked and when", async () => {
    const id = await vr.requestVehicle(d, hr(), R(35));
    expect(await status(id)).toBe("requested");
    const detail = await vr.getVehicleRequest(d, hr(), id);
    expect(detail).toMatchObject({ for_name: "Worker Five", requester_name: "Hina HR", status: "requested" });
    expect(detail!.events).toHaveLength(1);
    expect(detail!.events[0].actor_name).toBe("Hina HR");
  });

  it("refuses a person without the permission", async () => {
    await expect(vr.requestVehicle(d, worker(), R(36))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(vr.requestVehicle(d, auditor(), R(36))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a second open request for the same employee", async () => {
    const e = await vr.requestVehicle(d, hr(), R(35)).catch((x) => x);
    expect(e).toBeInstanceOf(UserError);
    expect(String(e.message)).toMatch(/already has an open vehicle request/);
  });

  it("needs a reason and a date", async () => {
    const e = await vr.requestVehicle(d, hr(), R(36, { reason: "x", needed_from: "" })).catch((x) => x);
    expect(e).toBeInstanceOf(UserError);
    expect(e.fields).toMatchObject({ reason: expect.any(String), needed_from: expect.any(String) });
  });

  it("tells the people who decide", async () => {
    const n = await listNotifications(d, mgr());
    expect(n.some((x: { kind: string }) => x.kind === "vreq.requested")).toBe(true);
  });
});

describe("an HR login", () => {
  it("can load what the home page and menu ask for, without a permission error", async () => {
    const { getOnboarding } = await import("@/lib/dashboard/onboarding");
    const { getNavCounts, getDashboard } = await import("@/lib/dashboard/service");
    const { permissionsOf } = await import("@/lib/auth/can");
    expect(await getOnboarding(d, hr()).catch((e) => e)).not.toBeInstanceOf(Error);
    expect(await getNavCounts(d, hr()).catch((e) => e)).not.toBeInstanceOf(Error);
    await getDashboard(d, hr()).catch((e) => { expect(e).toBeInstanceOf(ForbiddenError); });   // the page treats this as "no dashboard"
    const perms = await permissionsOf(d, hr());
    expect([...perms].sort()).toEqual(["vreq.read_all", "vreq.request", "vreq.see_pool"]);     // HR sees the pool read-only (A5)
  });
});

describe("who sees what", () => {
  it("shows HR and deciders every request, and a worker none", async () => {
    expect((await vr.listVehicleRequests(d, hr())).length).toBeGreaterThan(0);
    expect((await vr.listVehicleRequests(d, mgr())).length).toBeGreaterThan(0);
    expect((await vr.listVehicleRequests(d, auditor())).length).toBeGreaterThan(0);
    await expect(vr.listVehicleRequests(d, worker())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("deciding", () => {
  it("gives a pool vehicle: the employee becomes its holder and the request records it", async () => {
    const id = (await vr.listVehicleRequests(d, mgr(), { status: "requested" }))[0].id;
    await vr.transitionVehicleRequest(d, mgr(), id, "assigned", { vehicleId: pool });
    expect(await status(id)).toBe("assigned");
    expect(await holder(pool)).toBe(emps[35]);
    const detail = await vr.getVehicleRequest(d, mgr(), id);
    expect(detail).toMatchObject({ registration_no: "VRQ-001", status: "assigned" });
    expect(detail!.events.map((e) => e.to_status)).toEqual(["requested", "assigned"]);
    expect((await listNotifications(d, hr())).some((x: { kind: string }) => x.kind === "vreq.assigned")).toBe(true);
  });

  it("will not give a vehicle somebody holds, or one that is in the workshop", async () => {
    const id = await vr.requestVehicle(d, hr(), R(36));
    await expect(vr.transitionVehicleRequest(d, mgr(), id, "assigned", { vehicleId: held })).rejects.toThrow(/already held by someone/);
    await expect(vr.transitionVehicleRequest(d, mgr(), id, "assigned", { vehicleId: workshop })).rejects.toThrow(/not available/);
    await expect(vr.transitionVehicleRequest(d, mgr(), id, "assigned", {})).rejects.toThrow(/choose a vehicle/i);
    expect(await status(id)).toBe("requested");
  });

  it("lists only vehicles nobody holds in the pool", async () => {
    const regs = (await vr.poolVehicles(d, mgr())).map((v) => v.registration_no);
    expect(regs).not.toContain("VRQ-001");   // given above
    expect(regs).not.toContain("VRQ-002");   // held
    expect(regs).not.toContain("VRQ-003");   // in the workshop
  });

  it("approves a purchase, then gives the vehicle once it exists", async () => {
    const id = (await vr.listVehicleRequests(d, mgr(), { status: "requested" }))[0].id;
    await vr.transitionVehicleRequest(d, owner(), id, "budget_confirmed", { amount: 2_500_000 });
    await vr.transitionVehicleRequest(d, owner(), id, "purchase_approved", { note: "Budget approved for a new car" });
    expect(await status(id)).toBe("purchase_approved");
    const fresh = (await master.addVehicle(d, owner(), { registration_no: "VRQ-004", make: "Toyota", model: "Corolla" })).id;
    await vr.transitionVehicleRequest(d, mgr(), id, "assigned", { vehicleId: fresh });
    expect(await status(id)).toBe("assigned");
    expect(await holder(fresh)).toBe(emps[36]);
  });

  it("needs a reason to reject or cancel, and a decided request cannot change again", async () => {
    const e1 = await vr.requestVehicle(d, hr(), R(35));
    await expect(vr.transitionVehicleRequest(d, mgr(), e1, "rejected", { note: "no" })).rejects.toThrow(/reason of at least 5/);
    await vr.transitionVehicleRequest(d, mgr(), e1, "rejected", { note: "No vehicle in the budget" });
    expect(await status(e1)).toBe("rejected");
    await expect(vr.transitionVehicleRequest(d, mgr(), e1, "assigned", { vehicleId: workshop })).rejects.toThrow(/illegal vehicle request transition/i);
  });

  it("lets HR cancel its own request but not decide one", async () => {
    const id = await vr.requestVehicle(d, hr(), R(35));
    await expect(vr.transitionVehicleRequest(d, hr(), id, "assigned", { vehicleId: pool })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(vr.transitionVehicleRequest(d, worker(), id, "cancelled", { note: "Changed my mind" })).rejects.toBeInstanceOf(ForbiddenError);
    await vr.transitionVehicleRequest(d, hr(), id, "cancelled", { note: "Employee no longer needs it" });
    expect(await status(id)).toBe("cancelled");
  });

  it("will not let a manager decide a request for themselves", async () => {
    const id = await vr.requestVehicle(d, hr(), R(32));
    const free = (await master.addVehicle(d, owner(), { registration_no: "VRQ-005", make: "Suzuki", model: "Cultus" })).id;
    await expect(vr.transitionVehicleRequest(d, mgr(), id, "assigned", { vehicleId: free })).rejects.toThrow(/segregation of duties/i);
    await expect(vr.transitionVehicleRequest(d, mgr(), id, "budget_confirmed", { amount: 100 })).rejects.toBeInstanceOf(ForbiddenError);      // the manager does not confirm budgets
    await vr.transitionVehicleRequest(d, owner(), id, "budget_confirmed", { amount: 900_000 });
    await expect(vr.transitionVehicleRequest(d, mgr(), id, "purchase_approved", {})).rejects.toThrow(/segregation of duties/i);
    await vr.transitionVehicleRequest(d, owner(), id, "assigned", { vehicleId: free });
    expect(await holder(free)).toBe(emps[32]);
  });
});

// Owner decision D1 and D2 (2026-11-11): warn, never block; vehicles carry seats and load capacity.
describe("pool vehicle warnings and capacity", () => {
  it("stores seats and load capacity and shows them with the pool", async () => {
    const id = (await master.addVehicle(d, owner(), { registration_no: "VRQ-W01", make: "Isuzu", model: "NPR", vehicle_class: "truck", base_location: "Lahore", seats: 3, load_capacity_kg: 4500 })).id;
    const row = (await vr.poolVehicles(d, mgr())).find((v) => v.id === id)!;
    expect(row).toMatchObject({ seats: 3, load_capacity_kg: "4500.0", vehicle_class: "truck", base_location: "Lahore", warnings: [] });
  });

  it("warns about expired papers, and lets the vehicle go only with a written reason", async () => {
    const id = (await master.addVehicle(d, owner(), { registration_no: "VRQ-W02", make: "Suzuki", model: "Bolan", documents: [{ doc_type: "fitness", expires_on: "2020-01-01" }] })).id;
    expect((await vr.poolVehicles(d, mgr())).find((v) => v.id === id)!.warnings.join()).toMatch(/papers expired: fitness/);
    const req = await vr.requestVehicle(d, hr(), R(35));
    await expect(vr.transitionVehicleRequest(d, mgr(), req, "assigned", { vehicleId: id })).rejects.toThrow(/has a warning/);
    expect(await status(req)).toBe("requested");
    await vr.transitionVehicleRequest(d, mgr(), req, "assigned", { vehicleId: id, warnReason: "Fitness renewal booked for Monday" });
    expect(await status(req)).toBe("assigned");
    const note = await raw(async (q) => (await q.query<{ decision_note: string }>("select decision_note from vehicle_requests where id = $1", [req])).rows[0].decision_note);
    expect(note).toMatch(/Warning accepted \(papers expired: fitness\): Fitness renewal booked for Monday/);
  });

  it("warns about an open repair", async () => {
    const id = (await master.addVehicle(d, owner(), { registration_no: "VRQ-W03", make: "Honda", model: "Civic" })).id;
    await raw(async (q) => {
      const rc = (await q.query<{ id: string }>("select id from reason_codes limit 1")).rows[0].id;
      const jc = (await q.query<{ id: string }>("insert into job_cards(vehicle_id, requested_by, reason_code_id, cause_text) values ($1,$2,$3,'Brakes are squealing badly') returning id", [id, emps[31], rc])).rows[0].id;
      await q.query("insert into job_card_events(job_card_id, from_status, to_status) values ($1, null, 'draft')", [jc]);
    });
    expect((await vr.poolVehicles(d, mgr())).find((v) => v.id === id)!.warnings.join()).toMatch(/open repair: JC-/);
  });
});
