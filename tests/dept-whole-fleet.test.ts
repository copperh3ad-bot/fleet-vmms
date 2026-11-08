import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import * as ctl from "@/lib/control/service";
import { getBoard } from "@/lib/master/board";
import { exportCsv } from "@/lib/exports/service";

// ADR-075: Logistics is the fleet-management department. Its role stays tied to the department (approval limit, pool cars, dispatch) but sees and maintains the whole
// fleet. A department role flagged otherwise (a future Administration role) stays limited to its own department's vehicles; tests/dept-scope.test.ts covers that mode.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const mgr = () => mem("fleet_manager", 12);
const l1 = () => mem("logistics", 20);
const l2 = () => mem("logistics", 21);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);

let emps: Record<number, string>;
let truck: string, general: string, admin: string;
let reasonId: string;
const card = (vehicle: string, requested_by: string, amount = "100") => ({ vehicle_id: vehicle, requested_by, reason_code_id: reasonId, cause_text: "Worked on during the test run", lines: [{ kind: "service", description: "Work", qty: "1", unit_cost: amount }] });

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  emps = {};
  for (const [n, name] of [[12, "Manager One"], [20, "Logistics One"], [21, "Logistics Two"]] as const) {
    emps[n] = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` })).id;
    await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), emps[n]]));
  }
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[12, "fleet_manager"], [20, "logistics"], [21, "logistics"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  truck = (await master.addVehicle(d, owner(), { registration_no: "LOG-TRK-1", make: "Isuzu", model: "NPR", vehicle_class: "truck" })).id;
  general = (await master.addVehicle(d, owner(), { registration_no: "GEN-VAN-1", make: "Toyota", model: "Hiace", vehicle_class: "van" })).id;    // no department
  admin = (await master.addVehicle(d, owner(), { registration_no: "ADM-CAR-1", make: "Honda", model: "City", vehicle_class: "car" })).id;
  await master.setVehicleDepartment(d, owner(), truck, "Logistics");
  await master.setVehicleDepartment(d, owner(), admin, "Administration");
  reasonId = await raw(async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'WEAR_BRAKES'")).rows[0].id);
});

describe("Logistics handles the complete fleet", () => {
  it("is flagged as seeing the whole fleet by default", async () => {
    expect((await raw((q) => q.query<{ s: boolean }>("select sees_all_vehicles as s from role_departments where role_key = 'logistics'"))).rows[0].s).toBe(true);
  });

  it("lists, opens and exports every vehicle: its own, the general fleet, and another department's", async () => {
    const all = ["ADM-CAR-1", "GEN-VAN-1", "LOG-TRK-1"];
    expect((await master.listVehicles(d, l1())).map((v) => v.registration_no).sort()).toEqual(all);
    expect((await getBoard(d, l1())).rows.map((r) => r.registration_no).sort()).toEqual(all);
    expect(await master.getVehicle(d, l1(), general)).not.toBeNull();
    expect(await master.getVehicle(d, l1(), admin)).not.toBeNull();
    const csv = (await exportCsv(d, l1(), "vehicles", {})).csv;
    for (const plate of all) expect(csv).toContain(plate);
  });

  it("raises a job card on any vehicle, and another Logistics person approves it", async () => {
    for (const v of [truck, general, admin]) {
      const { id } = await jc.createJobCard(d, l1(), card(v, emps[20]), true);
      expect((await jc.transitionJobCard(d, l1(), id, "approved").catch((e) => e)).message).toMatch(/cannot approve their own/i);
      await jc.transitionJobCard(d, l2(), id, "approved");
      expect((await jc.getJobCard(d, l1(), id))?.status).toBe("approved");
    }
  });

  it("the tenant administrator's own job card is approved by the fleet manager or a Logistics person, never by the administrator", async () => {
    for (const [approver, who] of [[mgr, "Manager One"], [l1, "Logistics One"]] as const) {
      for (const v of [truck, general, admin]) {
        const { id } = await jc.createJobCard(d, owner(), card(v, ""), true);
        expect((await jc.transitionJobCard(d, owner(), id, "approved").catch((e) => e)).message).toMatch(/cannot approve their own/i);
        await jc.transitionJobCard(d, approver(), id, "approved");
        const c = (await jc.getJobCard(d, owner(), id))!;
        expect(c.status).toBe("approved");
        expect(c.approver_name).toBe(who);
      }
    }
  });

  it("is still tied to its department: the approval limit applies to it, and a fleet manager is never limited", async () => {
    await ctl.saveSettings(d, owner(), { dept_approval_limit: "1000" });
    try {
      const big = await jc.createJobCard(d, l1(), card(general, emps[20], "1001"), true);
      const e = await jc.transitionJobCard(d, l2(), big.id, "approved").catch((x) => x);
      expect(e).toBeInstanceOf(UserError);
      expect(e.message).toMatch(/over the approval limit for your department/i);
      await jc.transitionJobCard(d, mgr(), big.id, "approved");
    } finally { await ctl.saveSettings(d, owner(), { dept_approval_limit: "" }); }
  });

  it("rule B: a Logistics approver now counts for every vehicle, so the administrator cannot decide their own card", async () => {
    const asAdmin = (vehicle: string) => withTenant(d, owner(), (q) => q.query<{ ok: boolean }>("select admin_may_decide_own('jobcard.approve', $1::uuid, 100::numeric) as ok", [vehicle]).then((r) => r.rows[0].ok));
    await withPlatform(d, (q) => q.query("update public.tenant_memberships set status = 'disabled' where tenant_id = $1 and role = 'fleet_manager'", [t.tenantId]));
    try {
      expect(await asAdmin(truck)).toBe(false);
      expect(await asAdmin(general)).toBe(false);
      expect(await asAdmin(admin)).toBe(false);
    } finally { await withPlatform(d, (q) => q.query("update public.tenant_memberships set status = 'active' where tenant_id = $1 and role = 'fleet_manager'", [t.tenantId])); }
  });
});

describe("the empty-page notes and labels", () => {
  it("name a department only for a role limited to it, not for a whole-fleet Logistics login", async () => {
    const { departmentOf } = await import("@/lib/auth/can");
    expect(await departmentOf(d, l1())).toBeNull();
    await raw((q) => q.query("update role_departments set sees_all_vehicles = false where role_key = 'logistics'"));
    try { expect(await departmentOf(d, l1())).toBe("Logistics"); }
    finally { await raw((q) => q.query("update role_departments set sees_all_vehicles = true where role_key = 'logistics'")); }
  });
});

describe("a department role that is not flagged stays limited to its own department", () => {
  it("sees only its department's vehicles once the flag is off, and the whole fleet again when it is on", async () => {
    await raw((q) => q.query("update role_departments set sees_all_vehicles = false where role_key = 'logistics'"));
    try {
      expect((await master.listVehicles(d, l1())).map((v) => v.registration_no)).toEqual(["LOG-TRK-1"]);
      expect(await master.getVehicle(d, l1(), admin)).toBeNull();
    } finally { await raw((q) => q.query("update role_departments set sees_all_vehicles = true where role_key = 'logistics'")); }
    expect((await master.listVehicles(d, l1())).length).toBe(3);
  });
});
