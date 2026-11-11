import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import * as vr from "@/lib/vehicle-requests/service";
import * as ctl from "@/lib/control/service";
import { listCargo } from "@/lib/cargo/service";

// Owner decisions A1 to A5 of 2026-11-11 (docs/OWNER-DECISIONS-2026-11-11.md, ADR-088): the strict administrator, Logistics on HR requests,
// HR seeing the pool, and the auditor reading cargo. A3 (trips) is in tests/trips.test.ts; A6 (own vehicles) is a page rule.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const req = () => mem("requester", 11);
const fm = () => mem("fleet_manager", 12);
const logi = () => mem("logistics", 20);
const hr = () => mem("hr", 31);
const aud = () => mem("auditor", 34);
const fin = () => mem("finance", 40);
type Q = import("@/lib/db/types").Queryable;
const raw = <T,>(fn: (q: Q) => Promise<T>) => withTenant(d, owner(), fn);
const asRole = <T,>(role: string, userId: string, fn: (q: Q) => Promise<T>) => withTenant(d, { ...t, userId, role, vehicleScope: "all" } as Membership, fn);
const blocked = (m: Membership, permission: string) => withTenant(d, m, async (q) => (await q.query<{ b: boolean }>("select admin_blocked_from_others($1) as b", [permission])).rows[0].b);

let emps: Record<number, string>;
let truck: string, pool: string, reasonId: string;
const card = (requested_by: string, amount = "100") => ({ vehicle_id: truck, requested_by, reason_code_id: reasonId, cause_text: "Worked on during the test run", lines: [{ kind: "service", description: "Work", qty: "1", unit_cost: amount }] });
const setOpen = (v: "0" | "1") => ctl.saveSettings(d, owner(), { admin_decides_others: v });

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Strict Co", slug: "strictco", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  emps = {};
  for (const [n, name] of [[11, "Requester One"], [12, "Manager One"], [20, "Logistics One"], [31, "Hina HR"], [51, "Worker Five"], [52, "Worker Six"], [53, "Worker Seven"], [54, "Worker Eight"]] as const) {
    emps[n] = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `S-${n}` })).id;
    if (n <= 31) await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), emps[n]]));
  }
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[11, "requester"], [12, "fleet_manager"], [20, "logistics"], [31, "hr"], [34, "auditor"], [40, "finance"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  truck = (await master.addVehicle(d, owner(), { registration_no: "STR-TRK-1", make: "Isuzu", model: "NPR", vehicle_class: "truck" })).id;
  pool = (await master.addVehicle(d, owner(), { registration_no: "STR-POOL-1", make: "Suzuki", model: "Alto" })).id;
  reasonId = await raw(async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'WEAR_BRAKES'")).rows[0].id);
});

describe("A1: the administrator and other people's decisions", () => {
  it("the company setting exists, is off (strict) by default, and only the administrator can change it", async () => {
    const s = (await ctl.getSettings(d, owner())).find((x) => x.key === "admin_decides_others")!;
    expect(s).toMatchObject({ value: "0", editable: true });
    await expect(ctl.saveSettings(d, fm(), { admin_decides_others: "1" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ctl.saveSettings(d, owner(), { admin_decides_others: "2" })).rejects.toBeInstanceOf(UserError);
  });

  it("strict: while a fleet manager or Logistics can decide, the administrator may not approve someone else's job card", async () => {
    const id = (await jc.createJobCard(d, req(), card(emps[11]), true)).id;
    const e = await jc.transitionJobCard(d, owner(), id, "approved").catch((x) => x);
    expect(e).toBeInstanceOf(UserError);
    expect((e as UserError).message).toMatch(/administrator does not decide job cards/i);
    await jc.transitionJobCard(d, fm(), id, "approved");                                      // the fleet manager still can
    expect((await jc.getJobCard(d, fm(), id))!.status).toBe("approved");
  });

  it("open: switched on, the administrator may decide too", async () => {
    await setOpen("1");
    try {
      const id = (await jc.createJobCard(d, req(), card(emps[11]), true)).id;
      await jc.transitionJobCard(d, owner(), id, "approved");
      expect((await jc.getJobCard(d, owner(), id))!.status).toBe("approved");
      expect(await blocked(owner(), "jobcard.approve")).toBe(false);
    } finally { await setOpen("0"); }
  });

  it("the same rule covers quotations and invoice checks, and only the administrator is held to it", async () => {
    expect(await blocked(owner(), "jobcard.approve")).toBe(true);
    expect(await blocked(owner(), "quotation.approve")).toBe(true);       // a fleet manager can decide quotations
    expect(await blocked(owner(), "invoice.verify")).toBe(true);          // Finance can check invoices
    for (const m of [fm(), logi(), fin(), req(), aud()]) expect(await blocked(m, "jobcard.approve")).toBe(false);
  });

  it("a company with nobody else who could decide is never stuck: only a person who holds the permission counts, and a workshop, a disabled or an invited person does not", async () => {
    const solo = await provisionTenant(d, { name: "Solo Co", slug: "soloco", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
    const soloAdmin = { ...solo, userId: U(1), role: "tenant_admin", vehicleScope: "all" } as Membership;
    const check = (perm: string) => withTenant(d, soloAdmin, async (q) => (await q.query<{ b: boolean }>("select admin_blocked_from_others($1) as b", [perm])).rows[0].b);
    expect(await check("jobcard.approve")).toBe(false);                                         // nobody else at all
    await withPlatform(d, async (q) => {
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'requester'), ($3, $2, 'vendor')", [U(61), solo.tenantId, U(62)]);
    });
    expect(await check("jobcard.approve")).toBe(false);                                         // a requester cannot approve; a workshop never counts
    await withPlatform(d, async (q) => { await q.query("insert into public.tenant_memberships(user_id, tenant_id, role, status) values ($1, $2, 'fleet_manager', 'disabled')", [U(63), solo.tenantId]); });
    expect(await check("jobcard.approve")).toBe(false);                                         // a disabled manager does not count
    await withPlatform(d, async (q) => { await q.query("update public.tenant_memberships set status = 'active' where user_id = $1 and tenant_id = $2", [U(63), solo.tenantId]); });
    expect(await check("jobcard.approve")).toBe(true);                                          // now a manager is active: strict applies
  });
});

describe("A2 and A5: HR requests, Logistics and the pool", () => {
  it("HR sees the vehicles nobody holds, read-only; a requester and the auditor do not", async () => {
    const free = await vr.poolVehicles(d, hr());
    expect(free.map((v) => v.registration_no)).toContain("STR-POOL-1");
    for (const m of [req(), aud(), fin()]) await expect(vr.poolVehicles(d, m)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(vr.transitionVehicleRequest(d, hr(), await vr.requestVehicle(d, hr(), { for_employee: emps[51], reason: "Joins sales", needed_from: "2031-04-01" }), "assigned", { vehicleId: pool })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("Logistics sees every request and may give a pool vehicle, but may not approve a purchase or reject", async () => {
    const id = await vr.requestVehicle(d, hr(), { for_employee: emps[52], reason: "Joins sales", needed_from: "2031-04-01" });
    expect((await vr.listVehicleRequests(d, logi())).map((r) => r.id)).toContain(id);
    await expect(vr.transitionVehicleRequest(d, logi(), id, "purchase_approved", { note: "buy one" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(vr.transitionVehicleRequest(d, logi(), id, "rejected", { note: "not needed now" })).rejects.toBeInstanceOf(ForbiddenError);
    await vr.transitionVehicleRequest(d, logi(), id, "assigned", { vehicleId: pool, note: "From the pool" });
    expect((await vr.getVehicleRequest(d, logi(), id))).toMatchObject({ status: "assigned", registration_no: "STR-POOL-1" });
  });

  it("the fleet manager and the administrator can still approve a purchase or reject", async () => {
    const a = await vr.requestVehicle(d, hr(), { for_employee: emps[53], reason: "Joins sales", needed_from: "2031-04-01" });
    await vr.transitionVehicleRequest(d, fm(), a, "purchase_approved", { note: "Buy a car" });
    const b = await vr.requestVehicle(d, hr(), { for_employee: emps[54], reason: "Joins sales", needed_from: "2031-04-01" });
    await vr.transitionVehicleRequest(d, owner(), b, "rejected", { note: "No budget this quarter" });
    expect((await vr.getVehicleRequest(d, fm(), a))!.status).toBe("purchase_approved");
    expect((await vr.getVehicleRequest(d, fm(), b))!.status).toBe("rejected");
  });

  it("the people who give vehicles are told of a new request: Logistics, the fleet manager and the administrator", async () => {
    const who = await vr.requestVehicle(d, hr(), { for_employee: emps[11], reason: "Needs a car", needed_from: "2031-05-01" });
    const users = await raw(async (q) => (await q.query<{ user_id: string }>("select user_id from notifications where kind = 'vreq.requested' and payload->>'request_id' = $1 order by user_id", [who])).rows.map((r) => r.user_id));
    expect(users).toEqual([U(1), U(12), U(20)]);
  });
});

describe("A4: the auditor reads cargo", () => {
  it("reads every request and changes nothing; Finance still sees none", async () => {
    expect(Array.isArray(await listCargo(d, aud()))).toBe(true);
    await expect(listCargo(d, fin())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the permissions as the database has them", () => {
  it("lists exactly who holds each new permission", async () => {
    const who = async (p: string) => (await raw((q) => q.query<{ role_key: string }>("select role_key from role_permissions where permission_key = $1 order by 1", [p]))).rows.map((r) => r.role_key);
    expect(await who("vreq.assign")).toEqual(["fleet_manager", "logistics", "tenant_admin"]);
    expect(await who("vreq.see_pool")).toEqual(["fleet_manager", "hr", "logistics", "tenant_admin"]);
    expect(await who("cargo.read_all")).toEqual(["auditor"]);
    expect(await who("vreq.decide")).toEqual(["fleet_manager", "tenant_admin"]);          // purchases and rejections stay with them
    expect((await who("vreq.read_all")).includes("logistics")).toBe(true);
  });
});
