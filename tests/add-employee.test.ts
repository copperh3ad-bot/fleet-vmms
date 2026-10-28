// Adding an employee and inviting them are one step (ADR-041): every detail is required, the record and the invitation are made together or not at all.
import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import * as ad from "@/lib/admin/service";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const admin = () => mem("tenant_admin", 1);
const tenant = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, admin(), fn);
const plat = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withPlatform(d, fn);
const full = (over: Record<string, unknown> = {}) => ({ full_name: "Sana Malik", employee_no: "E-500", department: "Operations", phone: "0300 1234567", email: "sana@example.com", role: "requester", ...over });
const count = (sql: string, args: unknown[] = []) => tenant(async (q) => Number((await q.query<{ c: string }>(sql, args)).rows[0].c));

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Echo Textiles", slug: "echo", ownerUserId: U(1), ownerName: "Owner", ownerEmail: "owner@example.com" }, tenantMigrations(), { transform: stripExt });
});

describe("adding an employee with an invitation", () => {
  it("makes the employee record and the invitation together, with the phone in one format", async () => {
    const inv = await ad.addEmployeeWithInvite(d, admin(), full());
    expect(inv).toMatchObject({ full_name: "Sana Malik", employee_no: "E-500", email: "sana@example.com", reset: false });
    expect(inv.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const e = await tenant(async (q) => (await q.query<Record<string, string>>("select full_name, employee_no, department, email, phone, user_id from employees where employee_no = 'E-500'")).rows[0]);
    expect(e).toMatchObject({ full_name: "Sana Malik", department: "Operations", email: "sana@example.com", phone: inv.phone, user_id: null });
    const row = await plat(async (q) => (await q.query<Record<string, string>>("select role_key, vehicle_scope, employee_no from public.invitations where id = $1", [inv.id])).rows[0]);
    expect(row).toMatchObject({ role_key: "requester", vehicle_scope: "own", employee_no: "E-500" });
  });

  it("does not allow any detail to be skipped, and names the box", async () => {
    for (const field of ["full_name", "employee_no", "department", "phone", "email", "role"]) {
      const e = await ad.addEmployeeWithInvite(d, admin(), full({ [field]: "   " })).catch((x) => x);
      expect(e, field).toBeInstanceOf(UserError);
      expect(Object.keys(e.fields), field).toContain(field);
    }
    expect(await count("select count(*) c from employees where employee_no is not null and employee_no <> 'E-500'")).toBe(0);   // nothing half-made
  });

  it("refuses a workshop role, a bad email and a bad phone number", async () => {
    expect((await ad.addEmployeeWithInvite(d, admin(), full({ employee_no: "E-501", role: "vendor" })).catch((x) => x)).fields.role).toBeTruthy();
    expect((await ad.addEmployeeWithInvite(d, admin(), full({ employee_no: "E-502", email: "nope" })).catch((x) => x)).fields.email).toBeTruthy();
    expect((await ad.addEmployeeWithInvite(d, admin(), full({ employee_no: "E-503", phone: "12" })).catch((x) => x)).fields.phone).toBeTruthy();
  });

  it("refuses a number or an email another employee already has", async () => {
    expect((await ad.addEmployeeWithInvite(d, admin(), full({ email: "other@example.com", employee_no: "e-500" })).catch((x) => x)).fields.employee_no).toBe("Already used");
    expect((await ad.addEmployeeWithInvite(d, admin(), full({ email: "SANA@example.com", employee_no: "E-504" })).catch((x) => x)).fields.email).toBe("Already used");
  });

  it("leaves no employee behind when the invitation cannot be made", async () => {
    await plat((q) => q.query("insert into public.plans(key, name, limits) values ('tiny', 'Tiny', '{\"max_users\":1}'::jsonb) on conflict (key) do update set limits = excluded.limits"));
    await plat((q) => q.query("insert into public.tenant_subscriptions(tenant_id, plan_id) select $1, id from public.plans where key = 'tiny' on conflict (tenant_id) do update set plan_id = excluded.plan_id, status = 'active'", [t.tenantId]));
    const before = await count("select count(*) c from employees");
    await expect(ad.addEmployeeWithInvite(d, admin(), full({ employee_no: "E-600", email: "plan@example.com" }))).rejects.toThrow(/plan allows 1 users/);
    expect(await count("select count(*) c from employees")).toBe(before);
    await plat((q) => q.query("delete from public.tenant_subscriptions where tenant_id = $1", [t.tenantId]));
  });

  it("needs both permissions: a fleet manager may manage employees but not invite", async () => {
    for (const role of ["fleet_manager", "finance", "requester", "auditor"])
      await expect(ad.addEmployeeWithInvite(d, mem(role, 40), full({ employee_no: "E-700", email: "perm@example.com" }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await count("select count(*) c from employees where employee_no = 'E-700'")).toBe(0);
  });
});
