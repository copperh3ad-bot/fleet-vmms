import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import * as vf from "@/lib/vendorflow/service";
import * as trips from "@/lib/trips/service";
import * as ctl from "@/lib/control/service";
import { getDashboard } from "@/lib/dashboard/service";
import { exportCsv } from "@/lib/exports/service";
import { getVehicleRecord } from "@/lib/master/record";
import { getBoard } from "@/lib/master/board";

// ADR-048 phase 48a: operating departments. A logistics login reaches only the vehicles of the Logistics department, everywhere.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const mgr = () => mem("fleet_manager", 12);
const l1 = () => mem("logistics", 20);          // raises
const l2 = () => mem("logistics", 21);          // approves
const req = () => mem("requester", 11);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);

let emps: Record<number, string>;
let truck: string, loader: string, van: string, poolCar: string, opsLoader: string;
let reasonId: string;
const card = (vehicle: string, requested_by: string, amount = "100") => ({ vehicle_id: vehicle, requested_by, reason_code_id: reasonId, cause_text: "Worked on during the test run", lines: [{ kind: "service", description: "Work", qty: "1", unit_cost: amount }] });
const at = (day: number, hour: number) => `2031-04-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;
const T = (extra: Record<string, unknown> = {}) => ({ purpose: "Move pallets", from_place: "Depot", to_place: "Port", start_at: at(10, 8), end_at: at(10, 18), ...extra });

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  emps = {};
  for (const [n, name, dept] of [[11, "Requester One", "Sales"], [12, "Manager One", null], [20, "Logistics One", "Logistics"], [21, "Logistics Two", "Logistics"], [22, "Warehouse Hand", "Operations"]] as const) {
    emps[n] = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}`, department: dept ?? undefined })).id;
    await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), emps[n]]));
  }
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[11, "requester"], [12, "fleet_manager"], [20, "logistics"], [21, "logistics"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  truck = (await master.addVehicle(d, owner(), { registration_no: "LOG-TRK-1", make: "Isuzu", model: "NPR", vehicle_class: "truck" })).id;
  loader = (await master.addVehicle(d, owner(), { registration_no: "LOG-LDR-1", make: "Komatsu", model: "WA", vehicle_class: "forklift" })).id;
  poolCar = (await master.addVehicle(d, owner(), { registration_no: "LOG-POOL-1", make: "Toyota", model: "Corolla", vehicle_class: "car" })).id;
  opsLoader = (await master.addVehicle(d, owner(), { registration_no: "OPS-LDR-1", make: "Komatsu", model: "WA", vehicle_class: "forklift" })).id;
  van = (await master.addVehicle(d, owner(), { registration_no: "GEN-VAN-1", make: "Toyota", model: "Hiace", vehicle_class: "van" })).id;
  for (const id of [truck, loader, poolCar]) await master.setVehicleDepartment(d, owner(), id, "Logistics");
  await master.setVehicleDepartment(d, owner(), opsLoader, "operations");
  await ctl.saveSettings(d, owner(), { module_trips: "1" });
  reasonId = await raw(async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'WEAR_BRAKES'")).rows[0].id);
});

describe("which vehicles belong to a department", () => {
  it("sets and clears the department, keeps one spelling per name, and is for people who manage vehicles", async () => {
    await expect(master.setVehicleDepartment(d, req(), van, "Logistics")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(master.setVehicleDepartment(d, l1(), truck, "")).rejects.toBeInstanceOf(ForbiddenError);       // logistics cannot move its own vehicles out
    await master.setVehicleDepartment(d, mgr(), van, "LOGISTICS");                                              // spelled differently, same department
    expect((await master.listVehicles(d, mgr())).find((v) => v.id === van)?.department).toBe("Logistics");
    await master.setVehicleDepartment(d, mgr(), van, "");
    expect((await master.listVehicles(d, mgr())).find((v) => v.id === van)?.department).toBeNull();
    expect((await master.setVehicleDepartment(d, mgr(), van, "x".repeat(70)).catch((e) => e))).toBeInstanceOf(UserError);
    expect(await master.listDepartments(d, mgr())).toEqual(["Logistics", "operations"]);
  });
});

describe("what a logistics login can see", () => {
  it("lists, opens and exports only Logistics vehicles", async () => {
    const mine = (await master.listVehicles(d, l1())).map((v) => v.registration_no).sort();
    expect(mine).toEqual(["LOG-LDR-1", "LOG-POOL-1", "LOG-TRK-1"]);
    expect((await master.listVehicles(d, mgr())).length).toBe(5);
    expect(await master.getVehicle(d, l1(), van)).toBeNull();
    expect(await master.getVehicle(d, l1(), opsLoader)).toBeNull();
    expect(await master.getVehicle(d, l1(), truck)).not.toBeNull();
    expect(await getVehicleRecord(d, l1(), opsLoader)).toBeNull();
    expect((await getVehicleRecord(d, l1(), truck))?.department).toBe("Logistics");
    const board = await getBoard(d, l1());
    expect(board.rows.map((r) => r.registration_no).sort()).toEqual(["LOG-LDR-1", "LOG-POOL-1", "LOG-TRK-1"]);
    const csv = (await exportCsv(d, l1(), "vehicles", {})).csv;
    expect(csv).toContain("LOG-TRK-1");
    expect(csv).not.toContain("OPS-LDR-1");
    expect(csv).not.toContain("GEN-VAN-1");
  });

  it("has none of the cost, report, budget or admin screens", async () => {
    for (const fn of [() => exportCsv(d, l1(), "invoices", {}), () => exportCsv(d, l1(), "cost-per-km", {}), () => exportCsv(d, l1(), "budgets", {}), () => ctl.saveSettings(d, l1(), { module_trips: "1" })])
      await expect(fn()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("maintenance by logistics", () => {
  it("raises a job card on a Logistics vehicle and cannot on anyone else's", async () => {
    const mine = await jc.createJobCard(d, l1(), card(truck, emps[20]), true);
    expect((await jc.getJobCard(d, l1(), mine.id))?.job_no).toBe(mine.job_no);
    for (const v of [opsLoader, van]) {
      const e = await jc.createJobCard(d, l1(), card(v, emps[20]), true).catch((x) => x);
      expect(e).toBeInstanceOf(UserError);
      expect(e.message).toMatch(/belongs to another department/);
    }
  });

  it("sees only the job cards of its vehicles, and the fleet manager's cards on other vehicles stay hidden", async () => {
    const other = await jc.createJobCard(d, mgr(), card(van, emps[12]), true);
    const opsCard = await jc.createJobCard(d, mgr(), card(opsLoader, emps[12]), true);
    const rows = await jc.listJobCards(d, l1());
    expect(rows.every((r) => r.registration_no.startsWith("LOG-"))).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(await jc.getJobCard(d, l1(), other.id)).toBeNull();
    expect(await jc.getJobCard(d, l1(), opsCard.id)).toBeNull();
    expect(await jc.getReviewContext(d, l1(), other.id)).toBeNull();
    const csv = (await exportCsv(d, l1(), "job-cards", {})).csv;
    expect(csv).toContain("LOG-TRK-1");
    expect(csv).not.toContain("GEN-VAN-1");
    expect((await jc.getJobContext(d, l1(), van))).toBeNull();
    // and cannot act on them even with the id in hand
    await expect(jc.transitionJobCard(d, l2(), other.id, "approved")).rejects.toThrow();
    expect((await getDashboard(d, l2())).actions.flatMap((a) => a.samples.map((s) => s.text)).join(" ")).not.toMatch(/GEN-VAN-1|OPS-LDR-1/);
  });

  it("one logistics person raises and another approves and chooses the workshop; nobody approves their own", async () => {
    const vendor = await raw(async (q) => (await q.query<{ id: string }>("insert into vendors(name) values ('Truck Works') returning id")).rows[0].id);
    const { id } = await jc.createJobCard(d, l1(), card(truck, emps[20], "400"), true);
    expect((await jc.transitionJobCard(d, l1(), id, "approved").catch((e) => e)).message).toMatch(/cannot approve their own/i);
    await jc.transitionJobCard(d, l2(), id, "approved");
    await jc.transitionJobCard(d, l2(), id, "vendor_assigned", { vendorId: vendor });
    expect((await jc.getJobCard(d, l1(), id))?.status).toBe("vendor_assigned");
    expect((await vf.getJobFlow(d, l2(), id)).quotations).toEqual([]);
  });

  it("cannot see another department's quotations, workshop emails or files", async () => {
    const vendor = await raw(async (q) => (await q.query<{ id: string }>("insert into vendors(name) values ('Van Works') returning id")).rows[0].id);
    const other = await jc.createJobCard(d, mgr(), card(van, emps[12], "50"), true);
    const qid = await raw(async (q) => (await q.query<{ id: string }>("insert into quotations(job_card_id, vendor_id, amount) values ($1, $2, 50) returning id", [other.id, vendor])).rows[0].id);
    expect((await vf.listQuotations(d, l2())).every((r) => r.registration_no.startsWith("LOG-"))).toBe(true);
    expect((await vf.listQuotations(d, mgr())).some((r) => r.id === qid)).toBe(true);
    expect(await vf.getJobFlow(d, l2(), other.id)).toEqual({ quotations: [], workOrder: null, invoices: [] });
    await expect(vf.decideQuotation(d, l2(), qid, "approve")).rejects.toBeInstanceOf(UserError);
    expect(await vf.listWorkshopEmails(d, l2(), other.id)).toEqual([]);
    expect((await vf.createWorkshopLink(d, l2(), other.id, "quotation").catch((e) => e))).toBeInstanceOf(UserError);
  });
});

describe("the spending limit", () => {
  it("applies to a department user only, blank means no limit, and over it a fleet manager must approve", async () => {
    await ctl.saveSettings(d, owner(), { dept_approval_limit: "" });                     // not set: no limit
    const free = await jc.createJobCard(d, l1(), card(truck, emps[20], "9000"), true);
    await jc.transitionJobCard(d, l2(), free.id, "approved");                           // allowed, no limit
    await ctl.saveSettings(d, owner(), { dept_approval_limit: "1000" });
    const small = await jc.createJobCard(d, l1(), card(truck, emps[20], "1000"), true);
    await jc.transitionJobCard(d, l2(), small.id, "approved");                          // at the limit: allowed
    const big = await jc.createJobCard(d, l1(), card(truck, emps[20], "1001"), true);
    const e = await jc.transitionJobCard(d, l2(), big.id, "approved").catch((x) => x);
    expect(e).toBeInstanceOf(UserError);
    expect(e.message).toMatch(/over the approval limit for your department/i);
    expect((await jc.getJobCard(d, l2(), big.id))?.status).toBe("submitted");
    await jc.transitionJobCard(d, mgr(), big.id, "approved");                           // a fleet manager is never limited
    expect((await jc.getJobCard(d, mgr(), big.id))?.status).toBe("approved");
    const waiting = await jc.createJobCard(d, l1(), card(truck, emps[20], "5000"), true);
    const dash = (await getDashboard(d, l2())).actions.find((a) => a.key === "approve");
    expect(dash?.samples.some((s) => s.href.endsWith(waiting.id)) ?? false).toBe(false); // not offered to someone who cannot approve it
  });

  it("zero means a department user approves nothing; the setting is validated and audited", async () => {
    await ctl.saveSettings(d, owner(), { dept_approval_limit: "0" });
    const c = await jc.createJobCard(d, l1(), card(truck, emps[20], "1"), true);
    expect((await jc.transitionJobCard(d, l2(), c.id, "approved").catch((e) => e)).message).toMatch(/over the approval limit/i);
    expect((await ctl.saveSettings(d, owner(), { dept_approval_limit: "lots" }).catch((e) => e))).toBeInstanceOf(UserError);
    await expect(raw((q) => q.query("update settings set value = 'lots' where key = 'dept_approval_limit'"))).rejects.toThrow(/number or empty/);
    expect((await raw((q) => q.query("select count(*)::int c from audit_log where table_name = 'settings' and new_data->>'key' = 'dept_approval_limit'"))).rows[0].c).toBeGreaterThan(1);
    await ctl.saveSettings(d, owner(), { dept_approval_limit: "" });
  });

  it("holds at the quotation step too, whatever the page does", async () => {
    await ctl.saveSettings(d, owner(), { dept_approval_limit: "1000" });
    const vendor = await raw(async (q) => (await q.query<{ id: string }>("insert into vendors(name) values ('Quote Works') returning id")).rows[0].id);
    const c = await jc.createJobCard(d, l1(), card(truck, emps[20], "10"), true);
    const mk = (amount: number) => raw(async (q) => (await q.query<{ id: string }>("insert into quotations(job_card_id, vendor_id, amount) values ($1, $2, $3) returning id", [c.id, vendor, amount])).rows[0].id);
    const over = await mk(1500), under = await mk(900);
    await expect(withTenant(d, l2(), (q) => q.query("update quotations set status = 'approved' where id = $1", [over]))).rejects.toThrow(/over the approval limit for your department/);
    await withTenant(d, l2(), (q) => q.query("update quotations set status = 'approved' where id = $1", [under]));
    await withTenant(d, mgr(), (q) => q.query("update quotations set status = 'approved' where id = $1", [over]));      // not limited
    await ctl.saveSettings(d, owner(), { dept_approval_limit: "" });
  });
});

describe("pool cars are Logistics vehicles", () => {
  it("only a Logistics vehicle can be a pool car, and a pool car cannot be given to someone outside logistics", async () => {
    const e = await trips.setPoolCar(d, mgr(), van, true).catch((x) => x);
    expect(e).toBeInstanceOf(UserError);
    expect(e.message).toMatch(/pool cars belong to the Logistics department/i);
    await trips.setPoolCar(d, l1(), poolCar, true);
    expect((await trips.listPoolCandidates(d, l1())).every((c) => c.registration_no.startsWith("LOG-"))).toBe(true);
    await expect(master.changeCustody(d, mgr(), { vehicle_id: poolCar, employee_id: emps[22] })).rejects.toThrow(/pool car can only be held by someone in the Logistics department/i);
    await master.changeCustody(d, l1(), { vehicle_id: poolCar, employee_id: emps[21] });                               // a logistics driver: fine
    const moved = await master.setVehicleDepartment(d, mgr(), poolCar, "Operations").catch((x) => x);
    expect(moved).toBeInstanceOf(UserError);
    await trips.setPoolCar(d, l1(), poolCar, false);
    await master.endCustody(d, l1(), poolCar);
    await master.changeCustody(d, mgr(), { vehicle_id: poolCar, employee_id: emps[22] });                              // out of the pool, anyone may hold it
    await master.endCustody(d, mgr(), poolCar);
    await trips.setPoolCar(d, l1(), poolCar, true);
  });
});

describe("trips and assignment by logistics", () => {
  it("dispatches pick and drop runs and trips on its own vehicles, not trips on other vehicles", async () => {
    const run = await trips.requestTrip(d, req(), T({ kind: "pick_drop", purpose: "Staff pick up", start_at: at(11, 6), end_at: at(11, 9), preferred_vehicle_id: poolCar }));
    const onTruck = await trips.requestTrip(d, req(), T({ purpose: "Haul stock", start_at: at(12, 8), end_at: at(12, 18), preferred_vehicle_id: truck }));
    const onVan = await trips.requestTrip(d, req(), T({ purpose: "Sales visit", start_at: at(13, 8), end_at: at(13, 18), preferred_vehicle_id: van }));
    const rows = await trips.listTrips(d, l1());
    expect(rows.some((r) => r.id === run && r.dispatchable)).toBe(true);
    expect(rows.some((r) => r.id === onTruck && r.dispatchable)).toBe(true);
    expect(rows.some((r) => r.id === onVan)).toBe(false);
    expect(await trips.getTrip(d, l1(), onVan)).toBeNull();
    await trips.transitionTrip(d, l1(), run, "approved", { driverId: emps[21] });
    await trips.transitionTrip(d, l1(), onTruck, "approved", { driverId: emps[20] });
    expect((await trips.getTrip(d, l1(), onTruck))?.registration_no).toBe("LOG-TRK-1");
    await expect(trips.transitionTrip(d, l1(), onVan, "approved", { vehicleId: van, driverId: emps[20] })).rejects.toBeInstanceOf(ForbiddenError);
    const other = await trips.requestTrip(d, req(), T({ purpose: "Needs a manager", start_at: at(14, 8), end_at: at(14, 18) }));    // no vehicle named: the fleet manager's
    expect(await trips.getTrip(d, l1(), other)).toBeNull();
    const e = await trips.transitionTrip(d, l1(), other, "approved", { vehicleId: truck, driverId: emps[20] }).catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect((await trips.assignables(d, l1())).vehicles.every((v) => v.registration_no.startsWith("LOG-"))).toBe(true);
  });
});

describe("the write guard holds even when a page forgets", () => {
  it("refuses a direct change to another department's vehicle, job card or custody as a logistics role", async () => {
    const other = await jc.createJobCard(d, mgr(), card(van, emps[12]), false);
    await expect(withTenant(d, l1(), (q) => q.query("update vehicles set status = 'inactive' where id = $1", [van]))).rejects.toThrow(/belongs to another department/);
    await expect(withTenant(d, l1(), (q) => q.query("update job_cards set priority = 'urgent' where id = $1", [other.id]))).rejects.toThrow(/belongs to another department/);
    await expect(withTenant(d, l1(), (q) => q.query("insert into vehicle_custody(vehicle_id, employee_id) values ($1, $2)", [van, emps[20]]))).rejects.toThrow(/belongs to another department/);
    await withTenant(d, mgr(), (q) => q.query("update vehicles set status = 'active' where id = $1", [van]));          // others are not affected
  });

  it("gives the role the permissions and none of the money ones", async () => {
    const perms = (await raw((q) => q.query<{ permission_key: string }>("select permission_key from role_permissions where role_key = 'logistics' order by 1"))).rows.map((r) => r.permission_key);
    expect(perms).toEqual(expect.arrayContaining(["jobcard.create", "jobcard.approve", "jobcard.assign_vendor", "quotation.approve", "trip.dispatch", "vehicle.read"]));
    for (const forbidden of ["invoice.verify", "budget.manage", "report.view", "admin.users", "admin.settings", "employee.manage", "vehicle.write", "compliance.manage"]) expect(perms).not.toContain(forbidden);
  });
});

// ADR-074: the administrator's "nobody else could decide" test looks at what each other approver can actually decide for THIS card.
describe("the administrator deciding their own card when the only other approvers are department approvers", () => {
  const onlyLogisticsApprovers = async <T,>(fn: () => Promise<T>): Promise<T> => {
    const set = (status: string, from: string) => withPlatform(d, async (q) => (await q.query<{ user_id: string }>("update public.tenant_memberships set status = $1 where tenant_id = $2 and role in ('fleet_manager','requester') and status = $3 returning user_id", [status, t.tenantId, from])).rows);
    const off = await set("disabled", "active");
    try { return await fn(); }
    finally { await withPlatform(d, async (q) => { for (const r of off) await q.query("update public.tenant_memberships set status = 'active' where tenant_id = $1 and user_id = $2", [t.tenantId, r.user_id]); }); }
  };
  const asAdmin = (vehicle: string, amount: number) => withTenant(d, owner(), (q) => q.query<{ ok: boolean }>("select admin_may_decide_own('jobcard.approve', $1::uuid, $2::numeric) as ok", [vehicle, amount]).then((r) => r.rows[0].ok));

  it("a logistics approver counts for a logistics vehicle but not for another department's vehicle", async () => {
    await onlyLogisticsApprovers(async () => {
      expect(await asAdmin(truck, 100)).toBe(false);          // logistics could decide it: the administrator may not decide their own
      expect(await asAdmin(van, 100)).toBe(true);             // no logistics approver can touch a general vehicle: the administrator may
      expect(await asAdmin(opsLoader, 100)).toBe(true);       // nor another named department
    });
    expect(await asAdmin(van, 100)).toBe(false);              // with a fleet manager active again, the exception ends everywhere
  });

  it("a department approver over their limit does not count, and the administrator can then decide", async () => {
    await ctl.saveSettings(d, owner(), { dept_approval_limit: "1000" });
    try {
      await onlyLogisticsApprovers(async () => {
        expect(await asAdmin(truck, 1000)).toBe(false);       // at the limit: logistics could decide it
        expect(await asAdmin(truck, 1001)).toBe(true);        // over it: only the administrator or a fleet manager could
      });
    } finally { await ctl.saveSettings(d, owner(), { dept_approval_limit: "" }); }
  });

  it("the database accepts the administrator's own approval on a vehicle no department approver could decide, and refuses it where one could", async () => {
    await onlyLogisticsApprovers(async () => {
      const onVan = await jc.createJobCard(d, owner(), card(van, "", "100"), true);
      await jc.transitionJobCard(d, owner(), onVan.id, "approved");
      expect((await jc.getJobCard(d, owner(), onVan.id))?.status).toBe("approved");
      const onTruck = await jc.createJobCard(d, owner(), card(truck, "", "100"), true);
      expect((await jc.transitionJobCard(d, owner(), onTruck.id, "approved").catch((e) => e)).message).toMatch(/cannot approve their own/i);
      expect((await jc.getJobCard(d, owner(), onTruck.id))?.status).toBe("submitted");
    });
  });

  it("the one-argument form still counts any holder of the permission (older callers)", async () => {
    await onlyLogisticsApprovers(async () => {
      const ok = await withTenant(d, owner(), (q) => q.query<{ ok: boolean }>("select admin_may_decide_own('jobcard.approve') as ok").then((r) => r.rows[0].ok));
      expect(ok).toBe(false);
    });
  });
});
