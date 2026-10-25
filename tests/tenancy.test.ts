import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant, withPlatform, assertSchemaName } from "@/lib/db/tenant";
import { migrateAllTenants, findDrift, type Migration } from "@/lib/db/migrate";
import { can, assertCan, authorized, resolveMembership, ForbiddenError } from "@/lib/auth/can";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let a: { tenantId: string; schema: string }, b: { tenantId: string; schema: string };
const opts = { transform: stripExt };

beforeAll(async () => {
  d = await testDriver();
  const m = tenantMigrations();
  a = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: U(1), ownerName: "Owner A" }, m, opts);
  b = await provisionTenant(d, { name: "Other Co", slug: "other", ownerUserId: U(2), ownerName: "Owner B" }, m, opts);
});

const ctx = (t: { schema: string }, userId: string, role = "tenant_admin") => ({ schema: t.schema, userId, role });

describe("provisioning", () => {
  it("creates separate schemas with the owner as admin", async () => {
    expect(a.schema).not.toBe(b.schema);
    const m = await resolveMembership(d, U(1), "delta");
    expect(m?.role).toBe("tenant_admin");
    expect(m?.schema).toBe(a.schema);
  });
  it("records the schema version", async () => {
    const v = await withPlatform(d, async (q) => (await q.query<{ schema_version: number }>("select schema_version from tenants where id=$1", [a.tenantId])).rows[0].schema_version);
    expect(v).toBe(tenantMigrations().length);   // one number per migration file
  });
  it("leaves nothing behind when provisioning fails", async () => {
    await expect(provisionTenant(d, { name: "Dup", slug: "delta", ownerUserId: U(9), ownerName: "x" }, tenantMigrations(), opts)).rejects.toThrow();
    const n = await withPlatform(d, async (q) => (await q.query<{ c: number }>("select count(*)::int c from tenants")).rows[0].c);
    expect(n).toBe(2);
    const bad: Migration[] = [...tenantMigrations(), { name: "9999_bad.sql", sql: "select * from does_not_exist;", checksum: "x" }];
    await expect(provisionTenant(d, { name: "Bad", slug: "bad-co", ownerUserId: U(8), ownerName: "x" }, bad, opts)).rejects.toThrow();
    const left = await withPlatform(d, async (q) => (await q.query<{ c: number }>("select count(*)::int c from information_schema.schemata where schema_name like 'tenant_%'")).rows[0].c);
    expect(left).toBe(2);
  });
});

describe("isolation", () => {
  it("a tenant cannot see another tenant's rows", async () => {
    await withTenant(d, ctx(a, U(1)), (q) => q.query("insert into vehicles(registration_no) values ('AAA-111')"));
    const inA = await withTenant(d, ctx(a, U(1)), async (q) => (await q.query("select * from vehicles")).rows.length);
    const inB = await withTenant(d, ctx(b, U(2)), async (q) => (await q.query("select * from vehicles")).rows.length);
    expect([inA, inB]).toEqual([1, 0]);
  });
  it("search_path does not leak into the next transaction", async () => {
    await withTenant(d, ctx(a, U(1)), (q) => q.query("select 1"));
    const sp = await d.transaction(async (q) => (await q.query<{ search_path: string }>("show search_path")).rows[0].search_path);
    expect(sp).not.toContain(a.schema);
  });
  it("tenant context cannot reach the other tenant by name", async () => {
    // Even a mistaken query naming the other schema is only possible with that schema's name, which never comes from users.
    expect(() => assertSchemaName(`tenant_a"; drop schema public; --`)).toThrow();
    expect(() => assertSchemaName("public")).toThrow();
    expect(() => assertSchemaName("tenant_ABC")).toThrow();
  });
  it("a member of A has no membership in B", async () => {
    expect(await resolveMembership(d, U(1), "other")).toBeNull();
    expect(await resolveMembership(d, U(1), "no-such-workspace")).toBeNull();
  });
  it("audit rows land in the right tenant and carry the user", async () => {
    const rowA = await withTenant(d, ctx(a, U(1)), async (q) => (await q.query<{ actor_id: string }>("select actor_id from audit_log where table_name='vehicles'")).rows);
    const rowB = await withTenant(d, ctx(b, U(2)), async (q) => (await q.query("select * from audit_log where table_name='vehicles'")).rows);
    expect(rowA[0].actor_id).toBe(U(1));
    expect(rowB.length).toBe(0);
  });
  it("a suspended tenant or disabled member cannot resolve", async () => {
    await withPlatform(d, (q) => q.query("update tenant_memberships set status='disabled' where user_id=$1", [U(2)]));
    expect(await resolveMembership(d, U(2), "other")).toBeNull();
    await withPlatform(d, (q) => q.query("update tenant_memberships set status='active' where user_id=$1", [U(2)]));
    await withPlatform(d, (q) => q.query("update tenants set status='suspended' where id=$1", [b.tenantId]));
    expect(await resolveMembership(d, U(2), "other")).toBeNull();
    await withPlatform(d, (q) => q.query("update tenants set status='active' where id=$1", [b.tenantId]));
    expect(await resolveMembership(d, U(2), "other")).not.toBeNull();
  });
});

describe("roles and permissions", () => {
  const matrix: Array<[string, string, boolean]> = [
    ["requester", "jobcard.create", true], ["requester", "jobcard.approve", false], ["requester", "invoice.verify", false],
    ["requester", "odometer.submit", true], ["requester", "budget.manage", false], ["requester", "admin.users", false],
    ["fleet_manager", "jobcard.approve", true], ["fleet_manager", "jobcard.assign_vendor", true], ["fleet_manager", "invoice.verify", false],
    ["fleet_manager", "odometer.review", true], ["fleet_manager", "budget.manage", true],
    ["finance", "invoice.verify", true], ["finance", "jobcard.approve", false], ["finance", "vehicle.write", false],
    ["auditor", "jobcard.read_all", true], ["auditor", "jobcard.approve", false], ["auditor", "vehicle.write", false],
    ["vendor", "quotation.submit", true], ["vendor", "invoice.submit", true], ["vendor", "jobcard.read_all", false], ["vendor", "vehicle.read", false],
    ["tenant_admin", "admin.users", true], ["tenant_admin", "invoice.verify", true],
  ];
  it.each(matrix)("%s / %s -> %s", async (role, perm, want) => {
    const got = await withTenant(d, ctx(a, U(1), role), (q) => can(q, role, perm));
    expect(got).toBe(want);
  });
  it("assertCan throws ForbiddenError and authorized runs nothing when denied", async () => {
    await expect(withTenant(d, ctx(a, U(1), "vendor"), (q) => assertCan(q, "vendor", "jobcard.approve"))).rejects.toBeInstanceOf(ForbiddenError);
    const m = { ...ctx(a, U(1), "vendor"), tenantId: a.tenantId, vehicleScope: "all" as const };
    let ran = false;
    await expect(authorized(d, m, "vehicle.write", async () => { ran = true; })).rejects.toBeInstanceOf(ForbiddenError);
    expect(ran).toBe(false);
  });
  it("an unknown role has no permissions", async () => {
    expect(await withTenant(d, ctx(a, U(1), "made_up"), (q) => can(q, "made_up", "vehicle.read"))).toBe(false);
  });
});

describe("migration runner", () => {
  it("applies a new migration to every tenant and updates versions", async () => {
    const next: Migration[] = [...tenantMigrations(), { name: "9001_test_column.sql", sql: "alter table vehicles add column if not exists test_col text;", checksum: "c9001" }];
    const res = await migrateAllTenants(d, next, opts);
    expect(res.map((r) => r.applied)).toEqual([["9001_test_column.sql"], ["9001_test_column.sql"]]);
    expect(res.every((r) => !r.error)).toBe(true);
    for (const t of [a, b]) {
      const cols = await withTenant(d, ctx(t, U(1)), async (q) => (await q.query("select column_name from information_schema.columns where table_schema=current_schema() and table_name='vehicles' and column_name='test_col'")).rows.length);
      expect(cols).toBe(1);
    }
    expect(await findDrift(d, next)).toEqual([]);
  });
  it("is a no-op the second time", async () => {
    const next = [...tenantMigrations(), { name: "9001_test_column.sql", sql: "alter table vehicles add column if not exists test_col text;", checksum: "c9001" }];
    expect((await migrateAllTenants(d, next, opts)).every((r) => r.applied.length === 0)).toBe(true);
  });
  it("reports drift and refuses edited migrations", async () => {
    expect((await findDrift(d, tenantMigrations())).length).toBe(2); // template lacks 9001 that tenants have
    const edited = tenantMigrations().map((m, i) => (i === 0 ? { ...m, checksum: "changed" } : m));
    const res = await migrateAllTenants(d, edited, opts);
    expect(res.every((r) => r.error?.includes("edited after it was applied"))).toBe(true);
  });
  it("one failing tenant does not block the rest", async () => {
    const c = await provisionTenant(d, { name: "Third", slug: "third", ownerUserId: U(3), ownerName: "Owner C" }, tenantMigrations(), opts);
    await withTenant(d, ctx(c, U(3)), (q) => q.query("drop table challans cascade"));
    const sql = "alter table challans add column if not exists x text;";
    const res = await migrateAllTenants(d, [...tenantMigrations(), { name: "9002_x.sql", sql, checksum: "c9002" }], opts);
    const by = Object.fromEntries(res.map((r) => [r.schema, r]));
    expect(by[c.schema].error).toBeTruthy();
    expect(by[a.schema].applied).toEqual(["9001_test_column.sql", "9002_x.sql"].filter((n) => n === "9002_x.sql"));
  });
});

import { listWorkspaces } from "@/lib/auth/can";
describe("workspace list", () => {
  it("lists only active memberships in active tenants", async () => {
    const mine = await listWorkspaces(d, U(1));
    expect(mine.map((w) => w.slug)).toEqual(["delta"]);
    expect(await listWorkspaces(d, U(777))).toEqual([]);
  });
});
