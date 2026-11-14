import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, permissionsOf, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import * as roles from "@/lib/admin/roles";
import { EDITABLE, LOCKED } from "@/lib/admin/permission-catalog";

// ADR-097: the administrator edits what each role may do and makes roles of their own.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const admin = () => mem("tenant_admin", 1);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, admin(), fn);
const grants = (key: string) => raw(async (q) => (await q.query<{ permission_key: string }>("select permission_key from role_permissions where role_key = $1 order by 1", [key])).rows.map((r) => r.permission_key));

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta-roles", ownerUserId: U(1), ownerName: "Owner", ownerEmail: "owner@example.com" }, tenantMigrations(), { transform: stripExt });
});

describe("the permission list", () => {
  it("covers every permission the database knows, so a new one is decided on purpose", async () => {
    const known = await raw(async (q) => (await q.query<{ key: string }>("select key from permissions")).rows.map((r) => r.key));
    const undecided = known.filter((k) => !EDITABLE.has(k) && !(k in LOCKED));
    expect(undecided, `permissions in neither PERMISSION_GROUPS nor LOCKED: ${undecided.join(", ")}`).toEqual([]);
  });
});

describe("editing a role", () => {
  it("adds and takes away permissions, and a person holding the role feels it at once", async () => {
    expect(await grants("requester")).not.toContain("vendor.rate");
    await roles.setRolePermissions(d, admin(), "requester", [...(await grants("requester")).filter((p) => EDITABLE.has(p)), "vendor.rate"]);
    expect(await grants("requester")).toContain("vendor.rate");
    expect((await permissionsOf(d, mem("requester", 5))).has("vendor.rate")).toBe(true);
    const r = await roles.setRolePermissions(d, admin(), "requester", (await grants("requester")).filter((p) => EDITABLE.has(p) && p !== "vendor.rate"));
    expect(r.removed).toBe(1);
    expect(await grants("requester")).not.toContain("vendor.rate");
  });

  it("needs admin.users", async () => {
    await expect(roles.setRolePermissions(d, mem("requester", 5), "requester", ["vehicle.read"])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(roles.createRole(d, mem("fleet_manager", 6), { name: "Sneaky" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("never touches what the screen does not hand out, and the administrator keeps managing people", async () => {
    await roles.setRolePermissions(d, admin(), "tenant_admin", []);
    expect(await grants("tenant_admin")).toEqual(["admin.users", "gate.use"]);        // the locked ones stay, whatever is saved
    await expect(raw((q) => q.query("delete from role_permissions where role_key = 'tenant_admin' and permission_key = 'admin.users'"))).rejects.toThrow(/always keeps the permission to manage people/);
    await roles.setRolePermissions(d, admin(), "tenant_admin", [...EDITABLE].filter((p) => !["trip.award"].includes(p)));       // restore nearly everything for the rest of the file
  });

  it("refuses a permission that cannot be given from here, and the workshop role", async () => {
    await expect(roles.setRolePermissions(d, admin(), "requester", ["admin.users"])).rejects.toBeInstanceOf(UserError);
    await expect(roles.setRolePermissions(d, admin(), "requester", ["no.such"])).rejects.toBeInstanceOf(UserError);
    await expect(roles.setRolePermissions(d, admin(), "vendor", ["vehicle.read"])).rejects.toThrow(/workshop role cannot be changed/);
    await expect(roles.setRolePermissions(d, admin(), "nobody", [])).rejects.toThrow(/Unknown role/);
  });

  it("keeps approving and verifying apart in any role but the administrator's", async () => {
    await expect(roles.setRolePermissions(d, admin(), "fleet_manager", ["jobcard.approve", "invoice.verify"])).rejects.toThrow(/cannot both approve/);
    await expect(roles.setRolePermissions(d, admin(), "finance", ["quotation.approve", "invoice.verify"])).rejects.toThrow(/cannot both approve/);
    await roles.setRolePermissions(d, admin(), "finance", ["invoice.verify", "invoice.read"]);                                   // verifying alone is fine
  });

  it("writes every change to the audit trail", async () => {
    const n = await raw(async (q) => Number((await q.query<{ c: number }>("select count(*)::int c from audit_log where table_name = 'role_permissions'")).rows[0].c));
    expect(n).toBeGreaterThan(0);
  });
});

describe("a role of the organization's own", () => {
  let key = "";
  it("is made with a unique name, can start from another role, and works through can()", async () => {
    const made = await roles.createRole(d, admin(), { name: "Farm supervisor", copy_from: "requester" });
    key = made.key;
    expect(key).toMatch(/^custom_[0-9a-f]{8}$/);
    expect(await grants(key)).toEqual((await grants("requester")).filter((p) => EDITABLE.has(p)));
    await expect(roles.createRole(d, admin(), { name: "farm SUPERVISOR" })).rejects.toThrow(/already exists/);
    await expect(roles.createRole(d, admin(), { name: "Finance" })).rejects.toThrow(/already exists/);
    await expect(roles.createRole(d, admin(), { name: "x" })).rejects.toBeInstanceOf(UserError);
    await roles.setRolePermissions(d, admin(), key, ["cargo.request", "cargo.read_all", "vehicle.read"]);
    const held = await permissionsOf(d, mem(key, 7));
    expect(held.has("cargo.request")).toBe(true);
    expect(held.has("jobcard.approve")).toBe(false);
  });

  it("copying from the administrator leaves out verifying an invoice", async () => {
    const made = await roles.createRole(d, admin(), { name: "Deputy", copy_from: "tenant_admin" });
    const g = await grants(made.key);
    expect(g).toContain("jobcard.approve");
    expect(g).not.toContain("invoice.verify");
    expect(g).not.toContain("admin.users");
  });

  it("can be renamed, but a built-in role keeps its name", async () => {
    await roles.renameRole(d, admin(), key, "Field supervisor");
    expect((await roles.listEditableRoles(d, admin())).find((r) => r.key === key)?.name).toBe("Field supervisor");
    await expect(roles.renameRole(d, admin(), "requester", "Asker")).rejects.toThrow(/keeps its name/);
    await expect(roles.renameRole(d, admin(), key, "Finance")).rejects.toThrow(/already exists/);
  });

  it("cannot be deleted while a person holds it or an invitation names it, and can be afterwards", async () => {
    await withPlatform(d, (q) => q.query("insert into public.tenant_memberships(tenant_id, user_id, role, status, vehicle_scope) values ($1, $2, $3, 'active', 'all')", [t.tenantId, U(8), key]));
    await expect(roles.deleteRole(d, admin(), key)).rejects.toThrow(/Someone still holds/);
    await withPlatform(d, (q) => q.query("delete from public.tenant_memberships where tenant_id = $1 and user_id = $2", [t.tenantId, U(8)]));
    await roles.deleteRole(d, admin(), key);
    expect((await roles.listEditableRoles(d, admin())).some((r) => r.key === key)).toBe(false);
    expect(await grants(key)).toEqual([]);
  });

  it("a built-in role cannot be deleted, here or in the database", async () => {
    await expect(roles.deleteRole(d, admin(), "requester")).rejects.toThrow(/cannot be deleted/);
    await expect(raw((q) => q.query("delete from roles where key = 'requester'"))).rejects.toThrow(/built-in role cannot be deleted/);
  });

  it("an organization can have only so many of its own", async () => {
    for (let i = 0; i < roles.MAX_CUSTOM_ROLES; i++) {
      const left = (await roles.listEditableRoles(d, admin())).filter((r) => !r.builtin).length;
      if (left >= roles.MAX_CUSTOM_ROLES) break;
      await roles.createRole(d, admin(), { name: `Extra role ${i}` });
    }
    await expect(roles.createRole(d, admin(), { name: "One too many" })).rejects.toThrow(/at most/);
  });
});
