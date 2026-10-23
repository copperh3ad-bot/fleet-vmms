// Many organizations on the one shared database (the default, ADR-014 as amended): each is its own schema, set up by
// sign-up, many at the same moment, and none can see another.
import { beforeAll, describe, expect, it } from "vitest";
import { routingDriver, type RoutingDriver } from "@/lib/db/router";
import { listWorkspaces, resolveMembership, type Membership } from "@/lib/auth/can";
import { loadAccess } from "@/lib/billing/state";
import * as master from "@/lib/master/service";
import * as ad from "@/lib/admin/service";
import { advanceProvisioning, abandonProvisioning, startOrganization, type ProvisionDeps } from "@/lib/orgs/provision";
import { claimSignup, parseSignup, recordSignup } from "@/lib/orgs/signup";
import { newControl, platformMigrations, stripExt, tenantMigrations, testDriver } from "./helpers";
import type { Driver } from "@/lib/db/types";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
const unavailable = () => { throw new Error("not used for shared organizations"); };

let control: Driver;
let router: RoutingDriver;
let deps: ProvisionDeps;
const created: { calls: number } = { calls: 0 };

beforeAll(async () => {
  control = process.env.TEST_DATABASE_URL ? await testDriver() : await newControl();
  router = routingDriver({ control, makeDriver: () => { throw new Error("no dedicated databases here"); }, decrypt: unavailable });
  deps = {
    control, openDb: () => { throw new Error("no dedicated databases here"); }, platformMigrations: platformMigrations(), tenantMigrations: tenantMigrations(), transform: stripExt,
    provider: { name: "none", async create() { created.calls++; return unavailable(); }, async destroy() { return unavailable(); } },
    box: { encrypt: unavailable, decrypt: unavailable },
  };
});

async function signUp(n: number, org: string): Promise<{ tenantId: string; schema: string; slug: string; admin: Membership }> {
  const email = `owner${n}@example.com`;
  await recordSignup(control, parseSignup({ org_name: org, contact_name: `Owner ${n}`, email, terms: "on" }));
  const t = (await claimSignup(control, { id: U(n), email, emailConfirmed: true }, { kind: "shared" }))!;
  expect((await advanceProvisioning(deps, t.tenantId)).state).toBe("ready");
  const slug = (await control.transaction(async (q) => (await q.query<{ slug: string }>("select slug from public.tenants where id = $1", [t.tenantId])).rows[0])).slug;
  return { ...t, slug, admin: { tenantId: t.tenantId, schema: t.schema, userId: U(n), role: "tenant_admin", vehicleScope: "all", tenantName: org } };
}

describe("signing up onto the shared database", () => {
  it("builds the organization's schema in the control database, with no provider call, and starts a trial", async () => {
    const a = await signUp(1, "Shared Alpha");
    expect(created.calls).toBe(0);
    const t = await control.transaction(async (q) => (await q.query("select db_kind, provision_state, db_url_enc, db_ref from public.tenants where id = $1", [a.tenantId])).rows[0]);
    expect(t).toEqual({ db_kind: "shared", provision_state: "ready", db_url_enc: null, db_ref: null });
    expect((await control.transaction(async (q) => (await q.query("select 1 from information_schema.schemata where schema_name = $1", [a.schema])).rows))).toHaveLength(1);
    expect(await control.transaction(async (q) => (await q.query("select role from public.tenant_memberships where tenant_id = $1 and user_id = $2", [a.tenantId, U(1)])).rows)).toEqual([{ role: "tenant_admin" }]);
    expect(await loadAccess(control, a.tenantId)).toMatchObject({ state: "trial", full: true, daysLeft: 3, priceCents: 14900 });
    expect(await resolveMembership(router, U(1), a.slug)).toMatchObject({ role: "tenant_admin", tenantName: "Shared Alpha" });
    expect(await listWorkspaces(router, U(1))).toEqual([{ slug: a.slug, name: "Shared Alpha", role: "tenant_admin" }]);
    // the owner's employee record exists, and the system works for it
    expect((await master.addVehicle(router, a.admin, { registration_no: "SHA-001" })).id).toBeTruthy();
    expect((await master.listVehicles(router, a.admin)).map((v) => v.registration_no)).toEqual(["SHA-001"]);
  });

  it("two organizations side by side cannot see each other's data, people or invitations", async () => {
    const a = await signUp(2, "Side Alpha"), b = await signUp(3, "Side Bravo");
    await master.addVehicle(router, a.admin, { registration_no: "ALPHA-1" });
    await master.addVehicle(router, b.admin, { registration_no: "BRAVO-1" });
    expect((await master.listVehicles(router, a.admin)).map((v) => v.registration_no)).toEqual(["ALPHA-1"]);
    expect((await master.listVehicles(router, b.admin)).map((v) => v.registration_no)).toEqual(["BRAVO-1"]);
    expect(await resolveMembership(router, U(2), b.slug)).toBeNull();
    expect(await resolveMembership(router, U(3), a.slug)).toBeNull();
    expect((await ad.listMembers(router, a.admin)).map((m) => m.email)).toEqual(["owner2@example.com"]);
    const inv = await ad.inviteUser(router, a.admin, { full_name: "Sam", email: "sam@example.com", role: "requester" });
    await expect(ad.revokeInvitation(router, b.admin, inv.id)).rejects.toThrow(/no longer open/);
    expect(await ad.acceptInvitation(router, { token: inv.token }, { id: U(30), email: "sam@example.com", emailConfirmed: true })).toEqual({ slug: a.slug });
    expect(await listWorkspaces(router, U(30))).toEqual([{ slug: a.slug, name: "Side Alpha", role: "requester" }]);
    expect(await resolveMembership(router, U(30), b.slug)).toBeNull();
  });

  it("many companies signing up at the same moment, even with the same name, all get their own workspace and web address", async () => {
    const N = 6;
    const settled = await Promise.all(Array.from({ length: N }, async (_v, i) => {
      const n = 100 + i, email = `race${n}@example.com`;
      await recordSignup(control, parseSignup({ org_name: "Same Name Transport", contact_name: `Race ${n}`, email, terms: "on" }));
      const t = (await claimSignup(control, { id: U(n), email, emailConfirmed: true }, { kind: "shared" }))!;
      return { n, ...t, state: (await advanceProvisioning(deps, t.tenantId)).state };
    }));
    expect(settled.every((s) => s.state === "ready")).toBe(true);
    const slugs = await control.transaction(async (q) => (await q.query<{ slug: string }>("select slug from public.tenants where id = any($1::uuid[])", [settled.map((s) => s.tenantId)])).rows.map((r) => r.slug));
    expect(new Set(slugs).size).toBe(N);
    expect(slugs.every((s) => /^same-name-transport(-[0-9a-f]{4})?$/.test(s))).toBe(true);
    expect(new Set(settled.map((s) => s.schema)).size).toBe(N);
    // each owner reaches exactly their own
    for (const s of settled) expect((await listWorkspaces(router, U(s.n))).length).toBe(1);
  });

  it("a half-built shared organization can be abandoned, and its schema goes with it; a live one cannot", async () => {
    await recordSignup(control, parseSignup({ org_name: "Half Built Shared", contact_name: "Hal", email: "hal@example.com", terms: "on" }));
    const t = (await claimSignup(control, { id: U(40), email: "hal@example.com", emailConfirmed: true }, { kind: "shared" }))!;
    await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.tenants set provision_state = 'migrating_tenant' where id = $1", [t.tenantId]); });
    await advanceProvisioning({ ...deps, tenantMigrations: [...tenantMigrations(), { name: "9999_boom.sql", sql: "select definitely_missing()", checksum: "x" }] }, t.tenantId).then(async (s) => { expect(s.state).toBe("migrating_tenant"); expect(s.error).toBeTruthy(); });
    await abandonProvisioning(deps, t.tenantId);
    expect(await control.transaction(async (q) => (await q.query("select 1 from information_schema.schemata where schema_name = $1", [t.schema])).rows)).toEqual([]);
    expect(await control.transaction(async (q) => (await q.query("select status from public.tenants where id = $1", [t.tenantId])).rows[0])).toEqual({ status: "closed" });
    const live = await signUp(41, "Live Shared");
    await expect(abandonProvisioning(deps, live.tenantId)).rejects.toThrow(/is live/);
  });

  it("the older helper still makes a dedicated organization by default, so existing callers are unchanged", async () => {
    const t = await startOrganization(deps, { name: "Default Kind", slug: "default-kind", ownerUserId: U(50), ownerName: "D", ownerEmail: "d@example.com" });
    expect((await control.transaction(async (q) => (await q.query("select db_kind from public.tenants where id = $1", [t.tenantId])).rows[0]))).toEqual({ db_kind: "dedicated" });
  });
});
