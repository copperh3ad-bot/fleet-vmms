// The flows that cross the control plane and an organization's own database (ADR-014), run against a dedicated
// organization: sign-in lookup, workspace list, inviting and accepting, and the open odometer link.
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { secretBox } from "@/lib/crypto/secretbox";
import { routingDriver, type RoutingDriver } from "@/lib/db/router";
import { listWorkspaces, resolveMembership, type Membership } from "@/lib/auth/can";
import { advanceProvisioning, startOrganization, type ProvisionDeps } from "@/lib/orgs/provision";
import * as ad from "@/lib/admin/service";
import * as master from "@/lib/master/service";
import * as od from "@/lib/odometer/service";
import { lookupLink, submitViaLink } from "@/lib/odometer/link";
import { withTenant } from "@/lib/db/tenant";
import { farm, newControl, platformMigrations, stripExt, tenantMigrations } from "./helpers";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
const box = secretBox(randomBytes(32));
const person = (n: number, email: string, confirmed = true) => ({ id: U(n), email, emailConfirmed: confirmed });

let control: Awaited<ReturnType<typeof newControl>>;
let router: RoutingDriver;
let f: ReturnType<typeof farm>;
let admin: Membership, other: Membership;

async function makeOrg(d: ProvisionDeps, name: string, slug: string, owner: number) {
  const { tenantId, schema } = await startOrganization(d, { name, slug, ownerUserId: U(owner), ownerName: `Owner ${owner}`, ownerEmail: `owner${owner}@example.com` });
  expect((await advanceProvisioning(d, tenantId)).state).toBe("ready");
  return { tenantId, schema, m: { tenantId, schema, userId: U(owner), role: "tenant_admin", vehicleScope: "all" as const, tenantName: name } satisfies Membership };
}

beforeAll(async () => {
  control = await newControl();
  f = farm();
  const d: ProvisionDeps = { control, provider: f.provider(), openDb: f.open, box, platformMigrations: platformMigrations(), tenantMigrations: tenantMigrations(), transform: stripExt, connectRetries: { tries: 1, delayMs: 1 } };
  router = routingDriver({ control, makeDriver: f.open, decrypt: box.decrypt });
  admin = (await makeOrg(d, "Acme Transport", "acme", 1)).m;
  other = (await makeOrg(d, "Other Fleet", "other", 2)).m;
});

describe("signing in and finding the workspace", () => {
  it("finds the organization in the control plane and the role in its own database", async () => {
    expect(await resolveMembership(router, U(1), "acme")).toMatchObject({ tenantId: admin.tenantId, schema: admin.schema, role: "tenant_admin", vehicleScope: "all", tenantName: "Acme Transport" });
    expect(await resolveMembership(router, U(1), "other")).toBeNull();                              // a member of one is not a member of the other
    expect(await resolveMembership(router, U(2), "acme")).toBeNull();
    expect(await resolveMembership(router, U(1), "no-such-slug")).toBeNull();
  });

  it("lists the workspaces a login can enter, and a disabled membership drops out", async () => {
    expect(await listWorkspaces(router, U(1))).toEqual([{ slug: "acme", name: "Acme Transport", role: "tenant_admin" }]);
    expect(await listWorkspaces(router, U(99))).toEqual([]);
    await withTenant(router, admin, (q) => q.query("update public.tenant_memberships set status = 'disabled' where user_id = $1", [U(1)]));
    expect(await listWorkspaces(router, U(1))).toEqual([]);
    expect(await resolveMembership(router, U(1), "acme")).toBeNull();
    await withTenant(router, admin, (q) => q.query("update public.tenant_memberships set status = 'active' where user_id = $1", [U(1)]));
    expect(await resolveMembership(router, U(1), "acme")).not.toBeNull();
  });

  it("a closed or suspended organization cannot be entered", async () => {
    await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.tenants set status = 'suspended' where id = $1", [other.tenantId]); });
    expect(await resolveMembership(router, U(2), "other")).toBeNull();
    expect(await listWorkspaces(router, U(2))).toEqual([]);
    await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.tenants set status = 'active' where id = $1", [other.tenantId]); });
    expect(await resolveMembership(router, U(2), "other")).not.toBeNull();
  });
});

describe("inviting and accepting across the two databases", () => {
  it("the invitation lives in the organization's database; the control plane only routes it", async () => {
    const inv = await ad.inviteUser(router, admin, { full_name: "Sana Khan", email: "sana@example.com", role: "fleet_manager" });
    // in the organization's database, not in the control database
    const org = [...f.dbs.values()][0];
    expect((await org.transaction(async (q) => (await q.query("select email from public.invitations")).rows))).toEqual([{ email: "sana@example.com" }]);
    expect((await control.transaction(async (q) => (await q.query("select 1 from public.invitations where email = 'sana@example.com'")).rows))).toEqual([]);
    // the control plane holds the route and the address, never the token
    const routes = await control.transaction(async (q) => (await q.query<{ kind: string; tenant_id: string }>("select kind, tenant_id from public.link_routes where kind = 'invite'")).rows);
    expect(routes).toContainEqual({ kind: "invite", tenant_id: admin.tenantId });
    expect(JSON.stringify(await control.transaction(async (q) => (await q.query("select * from public.link_routes")).rows))).not.toContain(inv.token);

    expect(await ad.previewInvitation(router, inv.token)).toEqual({ workspace: "Acme Transport", full_name: "Sana Khan", email: "sana@example.com" });
    expect(await ad.previewInvitation(router, inv.token.slice(0, 42) + "x")).toBeNull();           // wrong token: nothing

    // she signs up elsewhere and sees the waiting invitation on the first page
    expect(await ad.pendingInvitationsFor(router, person(10, "SANA@example.com"))).toEqual([{ id: inv.id, workspace: "Acme Transport", role_name: "fleet_manager" }]);
    expect(await ad.pendingInvitationsFor(router, person(10, "sana@example.com", false))).toEqual([]);
    expect(await ad.pendingInvitationsFor(router, person(11, "someone.else@example.com"))).toEqual([]);

    // another address cannot use her link
    await expect(ad.acceptInvitation(router, { token: inv.token }, person(11, "someone.else@example.com"))).rejects.toThrow(/not valid for your account/);
    expect(await ad.acceptInvitation(router, { token: inv.token }, person(10, "sana@example.com"))).toEqual({ slug: "acme" });

    // she is a member now, found through the index, and the link is dead
    expect(await resolveMembership(router, U(10), "acme")).toMatchObject({ role: "fleet_manager", tenantId: admin.tenantId });
    expect(await listWorkspaces(router, U(10))).toEqual([{ slug: "acme", name: "Acme Transport", role: "fleet_manager" }]);
    expect(await ad.previewInvitation(router, inv.token)).toBeNull();
    expect(await ad.pendingInvitationsFor(router, person(10, "sana@example.com"))).toEqual([]);
    expect((await ad.listMembers(router, admin)).map((x) => x.email)).toContain("sana@example.com");
  });

  it("accepting by invitation id from the first page works, and repeating a finished acceptance is safe", async () => {
    const inv = await ad.inviteUser(router, admin, { full_name: "Ali Raza", email: "ali@example.com", role: "requester" });
    const user = person(12, "ali@example.com");
    expect(await ad.acceptInvitation(router, { id: inv.id }, user)).toEqual({ slug: "acme" });
    expect(await ad.acceptInvitation(router, { id: inv.id }, user).catch((e) => e.message)).toMatch(/not valid for your account|^\{/);   // the index row is gone after accepting
    expect(await listWorkspaces(router, U(12))).toHaveLength(1);
  });

  it("if the control plane step fails after joining, the person is a member and the same link finishes the job", async () => {
    const inv = await ad.inviteUser(router, admin, { full_name: "Bilal Noor", email: "bilal@example.com", role: "requester" });
    let failNext = true;
    const flaky = routingDriver({
      control: { transaction: (fn) => control.transaction((q) => fn({ query: (sql, params) => { if (failNext && /insert into public\.user_orgs/.test(sql)) throw new Error("control plane unreachable"); return q.query(sql, params); } })) },
      makeDriver: f.open, decrypt: box.decrypt,
    });
    const user = person(15, "bilal@example.com");
    await expect(ad.acceptInvitation(flaky, { token: inv.token }, user)).rejects.toThrow(/joined, but the workspace could not be listed/);
    expect(await resolveMembership(router, U(15), "acme")).not.toBeNull();                          // already a member in the organization's database
    expect(await listWorkspaces(router, U(15))).toEqual([]);                                         // but not yet listed
    failNext = false;
    expect(await ad.acceptInvitation(router, { token: inv.token }, user)).toEqual({ slug: "acme" });   // the link still works for the same person
    expect(await listWorkspaces(router, U(15))).toHaveLength(1);
    await expect(ad.acceptInvitation(router, { token: inv.token }, user)).rejects.toThrow(/not valid/);   // and then it is gone
  });

  it("revoking and resending update the routes; another organization's administrator cannot see or cancel it", async () => {
    const inv = await ad.inviteUser(router, admin, { full_name: "Zara Malik", email: "zara@example.com", role: "auditor" });
    await expect(ad.revokeInvitation(router, other, inv.id)).rejects.toThrow(/no longer open/);
    const again = await ad.resendInvitation(router, admin, inv.id);
    expect(await ad.previewInvitation(router, inv.token)).toBeNull();                                // old link stopped
    expect(await ad.previewInvitation(router, again.token)).toMatchObject({ email: "zara@example.com" });
    await ad.revokeInvitation(router, admin, again.id);
    expect(await ad.previewInvitation(router, again.token)).toBeNull();
    expect(await ad.pendingInvitationsFor(router, person(13, "zara@example.com"))).toEqual([]);
  });

  it("a suspended organization's links stop working", async () => {
    const inv = await ad.inviteUser(router, admin, { full_name: "Yusuf Ali", email: "yusuf@example.com", role: "finance" });
    await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.tenants set status = 'suspended' where id = $1", [admin.tenantId]); });
    expect(await ad.previewInvitation(router, inv.token)).toBeNull();
    await expect(ad.acceptInvitation(router, { token: inv.token }, person(14, "yusuf@example.com"))).rejects.toThrow(/not valid/);
    await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.tenants set status = 'active' where id = $1", [admin.tenantId]); });
    expect(await ad.previewInvitation(router, inv.token)).not.toBeNull();
  });
});

describe("the open odometer link on a dedicated database", () => {
  it("opens from the token alone, takes one reading, and is dead afterwards", async () => {
    await master.addVehicle(router, admin, { registration_no: "LINK-001", odometer_km: "1000" });
    const cycle = await od.openCycle(router, admin, "2026-10", "2026-10-30");
    const [link] = await od.createLinks(router, admin, cycle);
    expect(link.plate).toBe("LINK-001");
    expect(await lookupLink(router, link.token)).toMatchObject({ plate: "LINK-001", period: "2026-10-01" });
    expect(await lookupLink(router, link.token.slice(0, 42) + "x")).toBeNull();
    expect(await submitViaLink(router, link.token, "1200")).toBe("ok");
    expect(await submitViaLink(router, link.token, "1300")).toBe("invalid");                         // single use
    expect(await lookupLink(router, link.token)).toBeNull();
    const detail = await od.getCycle(router, admin, cycle);
    expect(detail!.rows[0]).toMatchObject({ status: "submitted", reading_km: "1200.0" });
  });

  it("the link role can do nothing else in the organization's database", async () => {
    const cycle = await od.openCycle(router, admin, "2026-11", "2026-11-30");
    const [link] = await od.createLinks(router, admin, cycle);
    expect(link.token).toBeTruthy();
    await expect(router.transaction(async (q) => {
      await q.query(`set local search_path = "${admin.schema}", public`);
      await q.query("set local role odometer_link");
      return q.query("select * from vehicles");
    }, { schema: admin.schema })).rejects.toThrow(/permission denied/);
  });

  it("a link of one organization does not open in another, and a suspended organization's links are dead", async () => {
    const cycle = await od.openCycle(router, admin, "2026-12", "2026-12-30");
    const [link] = await od.createLinks(router, admin, cycle);
    expect(await lookupLink(router, link.token)).not.toBeNull();
    await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.tenants set status = 'suspended' where id = $1", [admin.tenantId]); });
    expect(await lookupLink(router, link.token)).toBeNull();
    await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.tenants set status = 'active' where id = $1", [admin.tenantId]); });
    expect(await lookupLink(router, link.token)).not.toBeNull();
    // the route points at Acme; asking Other's database for the same submission finds nothing
    const [a, b] = [...f.dbs.values()];
    expect((await b.transaction(async (q) => (await q.query("select 1 from public.odometer_links")).rows))).toEqual([]);
    expect((await a.transaction(async (q) => (await q.query("select count(*)::int c from public.odometer_links")).rows))[0].c).toBeGreaterThan(0);
  });
});
