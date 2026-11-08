// Database hardening that must stay true for every organization (tenant migration 0037): no function is open to every role by default, and every view
// runs with its caller's rights. Also pins the response headers the site sends.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Hard Co", slug: "hard", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
});
const q = <T,>(sql: string) => withTenant(d, { schema: t.schema, userId: U(1), role: "tenant_admin" }, async (c) => (await c.query<T>(sql, [t.schema])).rows);

describe("tenant schema hardening", () => {
  it("no function in the schema can be run by every role", async () => {
    const open = await q<{ n: string }>(
      `select p.proname as n from pg_proc p where p.pronamespace = $1::regnamespace and p.prokind in ('f','p')
          and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
          and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')`);
    expect(open.map((r) => r.n)).toEqual([]);
  });

  it("every view runs with its caller's rights", async () => {
    const loose = await q<{ n: string }>(
      `select c.relname as n from pg_class c where c.relnamespace = $1::regnamespace and c.relkind = 'v'
          and not coalesce((select true from unnest(coalesce(c.reloptions, '{}')) o where o = 'security_invoker=true'), false)`);
    expect(loose.map((r) => r.n)).toEqual([]);
  });
});

describe("response headers", () => {
  const cfg = readFileSync("next.config.ts", "utf8");
  it("sends the browser protections on every page", () => {
    for (const h of ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Cross-Origin-Opener-Policy"]) expect(cfg).toContain(h);
    expect(cfg).toContain("includeSubDomains");
    expect(cfg).toContain("upgrade-insecure-requests");
    expect(cfg).toContain("frame-ancestors 'none'");
  });
  it("never caches signed-in or operator pages", () => {
    expect(cfg).toMatch(/source: "\/w\/:path\*"[\s\S]{0,200}no-store/);
    expect(cfg).toMatch(/source: "\/admin\/:path\*"[\s\S]{0,200}no-store/);
  });
});
