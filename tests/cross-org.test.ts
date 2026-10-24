// One organization must never see another's data. Two organizations are seeded with the same demo data plus a few
// distinctive records each; then every screen's data loader is run as each organization and the results are searched for
// any trace of the other: its row ids, people, plates, emails, schema name or organization id. It runs for organizations
// that share the database (a schema each) and for ones with their own database.
//
// Shared organizations are separated by the application: each request is pinned to its own schema and its own rows of the
// few shared tables (memberships, invitations, links). That is exactly what this test exercises, screen by screen.
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { secretBox } from "@/lib/crypto/secretbox";
import { routingDriver, type RoutingDriver } from "@/lib/db/router";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import type { Driver } from "@/lib/db/types";
import type { Membership } from "@/lib/auth/can";
import { seedDemo } from "@/lib/demo/seed";
import * as master from "@/lib/master/service";
import * as ad from "@/lib/admin/service";
import * as od from "@/lib/odometer/service";
import { advanceProvisioning, startOrganization, type ProvisionDeps } from "@/lib/orgs/provision";
import { farm, newControl, platformMigrations, stripExt, tenantMigrations, testDriver } from "./helpers";
import { allLoaders } from "./loaders";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;

type Org = { tag: string; tenantId: string; schema: string; admin: Membership; manager: Membership; finance: Membership; tokens: string[] };

/** Everything that identifies this organization's rows and people: ids of every row with a uuid id, and the markers we planted. */
async function identify(router: Driver, org: Omit<Org, "tokens">): Promise<string[]> {
  const ids = new Set<string>([org.tenantId, org.schema]);
  await withTenant(router, org.admin, async (q) => {
    const tables = (await q.query<{ table_name: string }>(
      "select table_name from information_schema.columns where table_schema = $1 and column_name = 'id' and data_type = 'uuid' order by 1", [org.schema])).rows;
    for (const { table_name } of tables) for (const r of (await q.query<{ id: string }>(`select id::text from "${org.schema}"."${table_name}"`)).rows) ids.add(r.id);
    for (const r of (await q.query<{ user_id: string }>(`select user_id::text from "${org.schema}".employees where user_id is not null`)).rows) ids.add(r.user_id);
    for (const r of (await q.query<{ id: string }>("select id::text from public.invitations where tenant_id = $1", [org.tenantId])).rows) ids.add(r.id);
    for (const r of (await q.query<{ id: string }>("select id::text from public.odometer_links where tenant_id = $1", [org.tenantId])).rows) ids.add(r.id);
  });
  for (const m of [`LEAK${org.tag}-777`, `Zed Leak${org.tag}`, `leak-${org.tag.toLowerCase()}@example.com`, `Leak${org.tag} Workshop`]) ids.add(m);
  return [...ids];
}

async function build(kind: "shared" | "dedicated", control: Driver, f: ReturnType<typeof farm>, box: ReturnType<typeof secretBox>, router: RoutingDriver, tag: string, n: number): Promise<Org> {
  let tenantId: string, schema: string;
  if (kind === "shared") {
    ({ tenantId, schema } = await provisionTenant(control, { name: `Org ${tag}`, slug: `org-${tag.toLowerCase()}`, ownerUserId: U(n), ownerName: `Owner ${tag}`, ownerEmail: `owner-${tag.toLowerCase()}@example.com` }, tenantMigrations(), { transform: stripExt }));
  } else {
    const d: ProvisionDeps = { control, provider: f.provider(), openDb: f.open, box, platformMigrations: platformMigrations(), tenantMigrations: tenantMigrations(), transform: stripExt, connectRetries: { tries: 1, delayMs: 1 } };
    ({ tenantId, schema } = await startOrganization(d, { name: `Org ${tag}`, slug: `org-${tag.toLowerCase()}`, ownerUserId: U(n), ownerName: `Owner ${tag}`, ownerEmail: `owner-${tag.toLowerCase()}@example.com` }));
    expect((await advanceProvisioning(d, tenantId)).state).toBe("ready");
  }
  const mk = (role: string, userId: string): Membership => ({ tenantId, schema, userId, role, vehicleScope: "all", tenantName: `Org ${tag}` });
  const admin = mk("tenant_admin", U(n));
  await seedDemo(router, { tenantId, schema });
  // things that exist in this organization only
  await master.addVehicle(router, admin, { registration_no: `LEAK${tag}-777`, make: "Leakmobile" });
  await master.saveEmployee(router, admin, { full_name: `Zed Leak${tag}`, employee_no: `LK-${tag}`, email: `zed-${tag.toLowerCase()}@example.com` });
  await master.saveVendor(router, admin, { name: `Leak${tag} Workshop`, categories: ["tyres"] });
  await ad.inviteUser(router, admin, { full_name: `Pending ${tag}`, email: `leak-${tag.toLowerCase()}@example.com`, role: "requester", employee_no: `P-${tag}` });
  const cycle = await od.openCycle(router, mk("fleet_manager", U(n + 1000)), "2026-11", "2026-11-28").catch(() => null);
  if (cycle) await od.createLinks(router, mk("fleet_manager", U(n + 1000)), cycle).catch(() => undefined);
  const base = { tag, tenantId, schema, admin, manager: mk("fleet_manager", U(n + 1000)), finance: mk("finance", U(n + 2000)) };
  return { ...base, tokens: await identify(router, base) };
}

describe.each(["shared", "dedicated"] as const)("organizations on %s databases", (kind) => {
  let router: RoutingDriver;
  let A: Org, B: Org;

  beforeAll(async () => {
    const control = process.env.TEST_DATABASE_URL && kind === "shared" ? await testDriver() : await newControl();
    const f = farm(), box = secretBox(randomBytes(32));
    router = routingDriver({ control, makeDriver: f.open, decrypt: box.decrypt });
    A = await build(kind, control, f, box, router, "A", 1);
    B = await build(kind, control, f, box, router, "B", 2);
  });

  it("each organization has its own distinctive data to look for", () => {
    expect(A.tokens.length).toBeGreaterThan(100);
    expect(B.tokens.length).toBeGreaterThan(100);
    expect(A.tokens.filter((t) => B.tokens.includes(t) && !t.startsWith("tenant_") === false)).toEqual([]);   // no id or marker is shared between them
    const shared = A.tokens.filter((t) => B.tokens.includes(t));
    expect(shared).toEqual([]);
  });

  async function leaks(viewer: Org, other: Org): Promise<string[]> {
    const found: string[] = [];
    for (const m of [viewer.manager, viewer.admin]) {
      for (const [name, run] of await allLoaders(router, m, viewer.finance).catch(() => [] as never[])) {
        const out = await run().then((v) => JSON.stringify(v), (e: Error) => (/forbidden/i.test(e.message) ? "" : `ERROR ${e.message}`));
        if (out.startsWith("ERROR")) found.push(`${m.role}/${name}: ${out}`);
        for (const t of other.tokens) if (out.includes(t)) found.push(`${m.role}/${name} shows ${t}`);
      }
    }
    return found;
  }

  it("A's screens contain nothing of B's", async () => { expect(await leaks(A, B)).toEqual([]); });
  it("B's screens contain nothing of A's", async () => { expect(await leaks(B, A)).toEqual([]); });

  it("the loaders really did return data to search (the test would be empty otherwise)", async () => {
    let bytes = 0;
    for (const [, run] of await allLoaders(router, A.manager, A.finance)) bytes += (await run().then((v) => JSON.stringify(v), () => "")).length;
    expect(bytes).toBeGreaterThan(20_000);
    expect((await master.listVehicles(router, A.admin)).map((v) => v.registration_no)).toContain("LEAKA-777");
    expect((await master.listVehicles(router, A.admin)).map((v) => v.registration_no)).not.toContain("LEAKB-777");
  });

  it("an invitation, a membership or a link of one organization is not usable through the other", async () => {
    const invA = (await ad.listInvitations(router, A.admin)).map((i) => i.email);
    expect(invA).toContain("leak-a@example.com");
    expect(invA).not.toContain("leak-b@example.com");
    const membersA = (await ad.listMembers(router, A.admin)).map((m) => m.email);
    expect(membersA.some((e) => e?.includes("owner-b"))).toBe(false);
    await expect(ad.revokeInvitation(router, A.admin, (await ad.listInvitations(router, B.admin))[0].id)).rejects.toThrow(/no longer open/);
  });
});
