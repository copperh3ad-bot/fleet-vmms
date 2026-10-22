import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, resolveMembership, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as ad from "@/lib/admin/service";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const slug = "delta";
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const admin = () => mem("tenant_admin", 1);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, admin(), fn);
const plat = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withPlatform(d, fn);
const person = (n: number, email = `p${n}@example.com`, confirmed = true) => ({ id: U(n), email, emailConfirmed: confirmed });
const invite = (email: string, extra: Record<string, unknown> = {}) => ad.inviteUser(d, admin(), { full_name: "New Person", email, role: "requester", ...extra });
const setLimits = (limits: Record<string, number>) => plat(async (q) => {
  await q.query("insert into public.plans(key, name, limits) values ('small', 'Small', $1::jsonb) on conflict (key) do update set limits = excluded.limits", [JSON.stringify(limits)]);
  await q.query("insert into public.tenant_subscriptions(tenant_id, plan_id) select $1, id from public.plans where key = 'small' on conflict (tenant_id) do update set plan_id = excluded.plan_id, status = 'active'", [t.tenantId]);
});
const noPlan = () => plat((q) => q.query("delete from public.tenant_subscriptions where tenant_id = $1", [t.tenantId]));

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Delta Textiles", slug, ownerUserId: U(1), ownerName: "Owner", ownerEmail: "owner@example.com" }, tenantMigrations(), { transform: stripExt });
});

describe("inviting", () => {
  it("makes a long random link, keeps only its hash, and needs admin.users", async () => {
    const inv = await invite("anna@example.com", { phone: "+92 300 111" });
    expect(inv.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await plat(async (q) => (await q.query<Record<string, unknown>>("select * from public.invitations where id = $1", [inv.id])).rows[0]);
    expect(JSON.stringify(row)).not.toContain(inv.token);
    expect(row.token_hash).toBe(ad.hashInviteToken(inv.token));
    for (const role of ["fleet_manager", "finance", "requester", "auditor", "vendor"])
      await expect(ad.inviteUser(d, mem(role, 40), { full_name: "X Y", email: "x@example.com", role: "requester" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ad.listMembers(d, mem("fleet_manager", 40))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("checks each field", async () => {
    const e = await invite("not-an-email", { full_name: "x", role: "" }).catch((x) => x);
    expect(e).toBeInstanceOf(UserError);
    expect(Object.keys(e.fields).sort()).toEqual(["email", "full_name", "role"]);
    await expect(invite("a1@example.com", { role: "superuser" })).rejects.toThrow(/Unknown role/);
    await expect(invite("a2@example.com", { role: "vendor" })).rejects.toThrow(/Choose the workshop/);
    await expect(invite("a3@example.com", { vendor_id: "00000000-0000-4000-8000-0000000000aa" })).rejects.toThrow(/only be chosen for the workshop/);
  });

  it("one open invitation per email; cancelling lets you invite again; resend replaces the link", async () => {
    const a = await invite("bob@example.com");
    await expect(invite("BOB@example.com")).rejects.toThrow(/already has an open invitation/);
    await ad.revokeInvitation(d, admin(), a.id);
    await expect(ad.revokeInvitation(d, admin(), a.id)).rejects.toThrow(/no longer open/);
    expect(await ad.previewInvitation(d, a.token)).toBeNull();
    const b = await invite("bob@example.com");
    const c = await ad.resendInvitation(d, admin(), b.id);
    expect(await ad.previewInvitation(d, b.token)).toBeNull();
    expect(await ad.previewInvitation(d, c.token)).toMatchObject({ workspace: "Delta Textiles", full_name: "New Person", email: "bob@example.com" });
    expect((await ad.listInvitations(d, admin())).filter((i) => i.email === "bob@example.com")).toHaveLength(1);
  });

  it("an administrator of another workspace cannot see, cancel or resend it", async () => {
    const mine = await invite("carol@example.com");
    const other = await provisionTenant(d, { name: "Other Co", slug: "other", ownerUserId: U(2), ownerName: "O" }, tenantMigrations(), { transform: stripExt });
    const o: Membership = { ...other, userId: U(2), role: "tenant_admin", vehicleScope: "all" };
    expect(await ad.listInvitations(d, o)).toEqual([]);
    await expect(ad.revokeInvitation(d, o, mine.id)).rejects.toThrow(/no longer open/);
    await expect(ad.resendInvitation(d, o, mine.id)).rejects.toThrow(/no longer open/);
    expect(await ad.previewInvitation(d, mine.token)).not.toBeNull();
  });
});

describe("the link page shows nothing for a link that does not work", () => {
  it("unknown, malformed, expired, revoked, used and suspended-workspace links", async () => {
    for (const bad of ["", "x", "A".repeat(43), "A".repeat(44), "../etc"]) expect(await ad.previewInvitation(d, bad)).toBeNull();
    const exp = await invite("dave@example.com");
    await plat((q) => q.query("update public.invitations set expires_at = now() - interval '1 minute' where id = $1", [exp.id]));
    expect(await ad.previewInvitation(d, exp.token)).toBeNull();
    const susp = await invite("erin@example.com");
    await plat((q) => q.query("update public.tenants set status = 'suspended' where id = $1", [t.tenantId]));
    expect(await ad.previewInvitation(d, susp.token)).toBeNull();
    await plat((q) => q.query("update public.tenants set status = 'active' where id = $1", [t.tenantId]));
    expect(await ad.previewInvitation(d, susp.token)).not.toBeNull();
  });
});

describe("accepting", () => {
  it("needs a confirmed email that matches the invitation; the link alone is not enough", async () => {
    const inv = await invite("frank@example.com");
    await expect(ad.acceptInvitation(d, { token: inv.token }, person(50, "frank@example.com", false))).rejects.toThrow(/Confirm your email/);
    await expect(ad.acceptInvitation(d, { token: inv.token }, person(50, "someone.else@example.com"))).rejects.toThrow(/not valid for your account/);
    await expect(ad.acceptInvitation(d, { token: "A".repeat(43) }, person(50, "frank@example.com"))).rejects.toThrow(/not valid/);
    await expect(ad.acceptInvitation(d, { token: "short" }, person(50, "frank@example.com"))).rejects.toThrow(/not valid/);
    expect(await resolveMembership(d, U(50), slug)).toBeNull();                              // nothing was created
    const r = await ad.acceptInvitation(d, { token: inv.token }, person(50, "FRANK@example.com"));
    expect(r.slug).toBe(slug);
    expect(await resolveMembership(d, U(50), slug)).toMatchObject({ role: "requester", vehicleScope: "all" });
    const emp = await raw(async (q) => (await q.query<{ full_name: string; email: string }>("select full_name, email from employees where user_id = $1", [U(50)])).rows[0]);
    expect(emp).toEqual({ full_name: "New Person", email: "frank@example.com" });
    await expect(ad.acceptInvitation(d, { token: inv.token }, person(50, "frank@example.com"))).rejects.toThrow(/not valid/);   // used
    expect(await ad.previewInvitation(d, inv.token)).toBeNull();
  });

  it("links an existing employee record with the same email instead of making a second one", async () => {
    const e = await master.saveEmployee(d, admin(), { full_name: "Gina Imported", employee_no: "E-77", email: "gina@example.com" });
    const inv = await invite("gina@example.com", { role: "fleet_manager", vehicle_scope: "own" });
    await ad.acceptInvitation(d, { token: inv.token }, person(51, "gina@example.com"));
    expect(await raw(async (q) => (await q.query<{ id: string }>("select id from employees where user_id = $1", [U(51)])).rows)).toEqual([{ id: e.id }]);
    expect(await resolveMembership(d, U(51), slug)).toMatchObject({ role: "fleet_manager", vehicleScope: "own" });
  });

  it("accepting from the home page by invitation id, only for the right confirmed email", async () => {
    const inv = await invite("hugo@example.com");
    expect((await ad.pendingInvitationsFor(d, person(52, "hugo@example.com"))).map((p) => p.workspace)).toContain("Delta Textiles");
    expect(await ad.pendingInvitationsFor(d, person(52, "hugo@example.com", false))).toEqual([]);
    expect(await ad.pendingInvitationsFor(d, person(52, "nobody@example.com"))).toEqual([]);
    await expect(ad.acceptInvitation(d, { id: inv.id }, person(53, "intruder@example.com"))).rejects.toThrow(/not valid/);
    await ad.acceptInvitation(d, { id: inv.id }, person(52, "hugo@example.com"));
    expect(await ad.pendingInvitationsFor(d, person(52, "hugo@example.com"))).toEqual([]);
  });

  it("a workshop invitation links the workshop to the new login, once", async () => {
    const v = (await master.saveVendor(d, admin(), { name: "Quick Fix Motors" })).id;
    const inv = await invite("workshop@example.com", { role: "vendor", vendor_id: v });
    await ad.acceptInvitation(d, { token: inv.token }, person(54, "workshop@example.com"));
    expect(await raw(async (q) => (await q.query<{ user_id: string }>("select user_id from vendors where id = $1", [v])).rows[0].user_id)).toBe(U(54));
    expect(await resolveMembership(d, U(54), slug)).toMatchObject({ role: "vendor" });
    expect(await raw(async (q) => (await q.query("select 1 from employees where user_id = $1", [U(54)])).rows)).toHaveLength(0);   // a workshop login is not an employee
    await expect(invite("second@example.com", { role: "vendor", vendor_id: v })).rejects.toThrow(/already has a login/);
  });

  it("a failed accept leaves nothing behind", async () => {
    const v = (await master.saveVendor(d, admin(), { name: "Racing Garage" })).id;
    const inv = await invite("racer@example.com", { role: "vendor", vendor_id: v });
    await raw((q) => q.query("update vendors set user_id = $1 where id = $2", [U(99), v]));        // someone else got linked in the meantime
    await expect(ad.acceptInvitation(d, { token: inv.token }, person(55, "racer@example.com"))).rejects.toThrow(/already has a login/);
    expect(await resolveMembership(d, U(55), slug)).toBeNull();
    expect(await ad.previewInvitation(d, inv.token)).not.toBeNull();                              // still open
  });
});

describe("plan limits", () => {
  it("users: pending invitations count, workshops do not, and a database trigger backs it up", async () => {
    await setLimits({ max_users: 3 });
    const base = (await ad.planUsage(d, admin())).users;
    expect(base.limit).toBe(3);
    const free = base.limit! - base.used;
    // use the free seats with invitations
    const pending = await plat(async (q) => (await q.query<{ c: number }>("select count(*)::int c from public.invitations where tenant_id = $1 and accepted_at is null and revoked_at is null and expires_at > now() and role_key <> 'vendor'", [t.tenantId])).rows[0].c);
    expect(free - pending).toBeLessThanOrEqual(0);                                                // earlier tests already filled this small plan
    await expect(invite("late@example.com")).rejects.toThrow(/plan allows 3 users/);
    const v = (await master.saveVendor(d, admin(), { name: "Free Workshop" })).id;
    await expect(invite("shop@example.com", { role: "vendor", vendor_id: v })).resolves.toBeDefined();   // workshops are not counted
    // the trigger refuses a membership added by hand
    await expect(plat((q) => q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'requester')", [U(60), t.tenantId]))).rejects.toThrow(/plan limit: users \(3\)/);
    await plat((q) => q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'vendor')", [U(61), t.tenantId]));
  });

  it("disabling someone frees a seat; re-enabling past the limit is refused with a plain message", async () => {
    await setLimits({ max_users: 100 });
    const inv = await invite("seat@example.com");
    await ad.acceptInvitation(d, { token: inv.token }, person(62, "seat@example.com"));
    const used = (await ad.planUsage(d, admin())).users.used;
    await ad.changeMember(d, admin(), U(62), { status: "disabled" });
    expect((await ad.planUsage(d, admin())).users.used).toBe(used - 1);
    await setLimits({ max_users: used - 1 });
    await expect(ad.changeMember(d, admin(), U(62), { status: "active" })).rejects.toThrow(/plan allows/);
    await setLimits({ max_users: used });
    await ad.changeMember(d, admin(), U(62), { status: "active" });
  });

  it("vehicles: the limit holds for hand entry, CSV import and raw SQL; sold vehicles do not count; no plan means no limit", async () => {
    await setLimits({ max_vehicles: 2 });
    await master.addVehicle(d, admin(), { registration_no: "LIM-001" });
    await master.addVehicle(d, admin(), { registration_no: "LIM-002" });
    await expect(master.addVehicle(d, admin(), { registration_no: "LIM-003" })).rejects.toThrow(/plan allows 2 vehicles/);
    await expect(master.commitVehicleImport(d, admin(), "registration_no\nLIM-004\nLIM-005")).rejects.toThrow(/plan allows 2 vehicles/);
    await expect(raw((q) => q.query("insert into vehicles(registration_no) values ('LIM-006')"))).rejects.toThrow(/plan limit: vehicles \(2\)/);
    expect(await raw(async (q) => (await q.query<{ c: number }>("select count(*)::int c from vehicles")).rows[0].c)).toBe(2);   // the failed import left nothing
    const usage = await ad.planUsage(d, admin());
    expect(usage.vehicles).toEqual({ used: 2, limit: 2 });
    const first = (await master.listVehicles(d, admin(), { search: "LIM-001" }))[0].id;
    await master.updateVehicleStatus(d, admin(), first, "disposed");
    await master.addVehicle(d, admin(), { registration_no: "LIM-003" });                         // a seat came free
    await noPlan();
    await master.addVehicle(d, admin(), { registration_no: "LIM-007" });
    expect((await ad.planUsage(d, admin())).vehicles.limit).toBeNull();
  });

  it("a cancelled subscription has no limits applied by the trigger (status is handled elsewhere)", async () => {
    await setLimits({ max_vehicles: 1 });
    await plat((q) => q.query("update public.tenant_subscriptions set status = 'cancelled' where tenant_id = $1", [t.tenantId]));
    await master.addVehicle(d, admin(), { registration_no: "CAN-001" });
    await noPlan();
  });
});

describe("changing people's access", () => {
  it("cannot change yourself, cannot remove the last administrator", async () => {
    await expect(ad.changeMember(d, admin(), U(1), { role: "requester" })).rejects.toThrow(/your own access/);
    const inv = await invite("second.admin@example.com", { role: "tenant_admin" });
    await ad.acceptInvitation(d, { token: inv.token }, person(70, "second.admin@example.com"));
    const second = mem("tenant_admin", 70);
    await ad.changeMember(d, second, U(1), { role: "fleet_manager" });                            // two admins: the first may be demoted by the second
    const demoted = (await resolveMembership(d, U(1), slug))!;                                   // what the app would load now
    expect(demoted.role).toBe("fleet_manager");
    await expect(ad.changeMember(d, demoted, U(70), { role: "requester" })).rejects.toBeInstanceOf(ForbiddenError);   // no longer an admin, so cannot act
    await expect(ad.changeMember(d, second, U(70), { status: "disabled" })).rejects.toThrow(/your own access/);
    await ad.changeMember(d, second, U(1), { role: "tenant_admin" });                             // restore
  });

  it("a disabled person loses access at once; role and scope changes apply", async () => {
    const inv = await invite("quinn@example.com");
    await ad.acceptInvitation(d, { token: inv.token }, person(71, "quinn@example.com"));
    await ad.changeMember(d, admin(), U(71), { role: "finance", vehicle_scope: "own" });
    expect(await resolveMembership(d, U(71), slug)).toMatchObject({ role: "finance", vehicleScope: "own" });
    await ad.changeMember(d, admin(), U(71), { status: "disabled" });
    expect(await resolveMembership(d, U(71), slug)).toBeNull();
    const row = (await ad.listMembers(d, admin())).find((x) => x.user_id === U(71))!;
    expect(row).toMatchObject({ status: "disabled", role: "finance", email: "quinn@example.com", full_name: "New Person" });
  });

  it("refuses unknown roles, moving into or out of the workshop role, and strangers", async () => {
    await expect(ad.changeMember(d, admin(), U(71), { role: "boss" })).rejects.toThrow(/Unknown role/);
    await expect(ad.changeMember(d, admin(), U(71), { role: "vendor" })).rejects.toThrow(/by inviting the workshop/);
    await expect(ad.changeMember(d, admin(), U(54), { role: "requester" })).rejects.toThrow(/Invite the person instead/);
    await expect(ad.changeMember(d, admin(), U(9999), { role: "requester" })).rejects.toThrow(/not in this workspace/);
    expect((await ad.listRoles(d, admin())).map((r) => r.key)).toContain("tenant_admin");
  });
});
