import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { adminMayDecideOwn, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import { inviteUser } from "@/lib/admin/service";

// ADR-077: the tenant administrator decides their own job card, quotation or invoice check only when they are the only active employee. Otherwise a Fleet manager
// (or a Logistics person) decides. A workshop is not an employee; an invited person who has not joined, and a disabled member, do not count.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const mgr = () => mem("fleet_manager", 12);
const driverRole = () => mem("requester", 11);
let veh: string, reasonId: string;
const card = (requested_by = "") => ({ vehicle_id: veh, requested_by, reason_code_id: reasonId, cause_text: "Worked on during the test run", lines: [{ kind: "service", description: "Work", qty: "1", unit_cost: "100" }] });
const may = (permission = "jobcard.approve") => withTenant(d, owner(), (q) => q.query<{ ok: boolean }>("select admin_may_decide_own($1) as ok", [permission]).then((r) => r.rows[0].ok));
const setStatus = (n: number, status: string) => withPlatform(d, (q) => q.query("update public.tenant_memberships set status = $3 where tenant_id = $1 and user_id = $2", [t.tenantId, U(n), status]));

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Solo Co", slug: "solo", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  for (const [n, name] of [[11, "Driver One"], [12, "Manager One"]] as const) {
    const id = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` })).id;
    await withTenant(d, owner(), (q) => q.query("update employees set user_id = $1 where id = $2", [U(n), id]));
  }
  veh = (await master.addVehicle(d, owner(), { registration_no: "SOLO-1", make: "Toyota", model: "Hiace", vehicle_class: "van" })).id;
  reasonId = await withTenant(d, owner(), async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'WEAR_BRAKES'")).rows[0].id);
});

describe("the administrator is the only employee", () => {
  it("may decide their own card, quotation and invoice check, and the record names them", async () => {
    for (const p of ["jobcard.approve", "quotation.approve", "invoice.verify"]) expect(await may(p)).toBe(true);
    const { id } = await jc.createJobCard(d, owner(), card(), true);
    await jc.transitionJobCard(d, owner(), id, "approved");
    const c = (await jc.getJobCard(d, owner(), id))!;
    expect(c.status).toBe("approved");
    expect(c.approver_name).toBeTruthy();
    expect(await adminMayDecideOwn(d, owner(), "jobcard.approve")).toBe(true);
  });

  it("an invited person who has not joined yet does not count", async () => {
    await inviteUser(d, owner(), { full_name: "Not Yet", employee_no: "E-INV", email: "notyet@example.com", phone: "+92 300 1234567", role: "fleet_manager" });
    expect(await may()).toBe(true);
  });
});

describe("there is another employee", () => {
  it("a requester is enough: the administrator may no longer decide their own card, even though a requester cannot approve", async () => {
    await withPlatform(d, (q) => q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'requester')", [U(11), t.tenantId]));
    for (const p of ["jobcard.approve", "quotation.approve", "invoice.verify"]) expect(await may(p)).toBe(false);
    const { id } = await jc.createJobCard(d, owner(), card(), true);
    expect((await jc.transitionJobCard(d, owner(), id, "approved").catch((e) => e)).message).toMatch(/cannot approve their own/i);
    expect(await adminMayDecideOwn(d, owner(), "jobcard.approve")).toBe(false);
  });

  it("a Fleet manager approves the administrator's card, and the record names the manager", async () => {
    await withPlatform(d, (q) => q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'fleet_manager')", [U(12), t.tenantId]));
    const { id } = await jc.createJobCard(d, owner(), card(), true);
    expect((await jc.transitionJobCard(d, owner(), id, "approved").catch((e) => e)).message).toMatch(/cannot approve their own/i);
    await jc.transitionJobCard(d, mgr(), id, "approved");
    const c = (await jc.getJobCard(d, owner(), id))!;
    expect(c.status).toBe("approved");
    expect(c.approver_name).toBe("Manager One");
  });

  it("a disabled employee does not count, so the administrator is alone again", async () => {
    await setStatus(11, "disabled");
    await setStatus(12, "disabled");
    expect(await may()).toBe(true);
    await setStatus(11, "active");
    expect(await may()).toBe(false);                                   // the requester is back
    await setStatus(12, "active");
  });

  it("a workshop is not an employee", async () => {
    await setStatus(11, "disabled");
    await setStatus(12, "disabled");
    await withPlatform(d, (q) => q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'vendor')", [U(30), t.tenantId]));
    expect(await may()).toBe(true);
    await setStatus(11, "active");
    await setStatus(12, "active");
  });

  it("no other role has the exception, however many employees there are", async () => {
    const asMgr = (p: string) => withTenant(d, mgr(), (q) => q.query<{ ok: boolean }>("select admin_may_decide_own($1) as ok", [p]).then((r) => r.rows[0].ok));
    const asRequester = (p: string) => withTenant(d, driverRole(), (q) => q.query<{ ok: boolean }>("select admin_may_decide_own($1) as ok", [p]).then((r) => r.rows[0].ok));
    for (const p of ["jobcard.approve", "quotation.approve", "invoice.verify"]) { expect(await asMgr(p)).toBe(false); expect(await asRequester(p)).toBe(false); }
  });
});
