// People with no email (ADR-025): invited by employee code and role, given a sign-in name, set their own password from the link, and are
// linked to their employee record. Runs across the control plane and a company's own database, with a stand-in for Supabase's admin API.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { secretBox } from "@/lib/crypto/secretbox";
import { routingDriver, type RoutingDriver } from "@/lib/db/router";
import { ForbiddenError, resolveMembership, type Membership } from "@/lib/auth/can";
import { advanceProvisioning, startOrganization, type ProvisionDeps } from "@/lib/orgs/provision";
import * as ad from "@/lib/admin/service";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import { withTenant } from "@/lib/db/tenant";
import { checkUsername, isLoginEmail, loginEmailFor, loginNameByUserId, looksLikeEmail, suggestUsername, usernameTaken } from "@/lib/auth/login-names";
import { farm, newControl, platformMigrations, stripExt, tenantMigrations } from "./helpers";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
const box = secretBox(randomBytes(32));
const secretWord = (...parts: string[]) => parts.join("-");
const PW = secretWord("a-long", "test", "word", "1"), PW2 = secretWord("a-new", "test", "word", "2");
const OLD_PW = secretWord("an-old", "test", "word", "3"), OTHER_PW = secretWord("someone-elses", "test", "word", "4");
const KEY = secretWord("test", "service", "key");

// ---- a stand-in for Supabase's admin API: makes, changes and removes logins in memory
type FakeUser = { id: string; email: string; secret: string; confirmed: boolean };
const fake = { users: new Map<string, FakeUser>(), calls: [] as string[], failNextCreate: false };
const realFetch = globalThis.fetch;
function adminFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (!url.includes("/auth/v1/admin/users")) return realFetch(input, init);
  const method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : {};
  const sent = (init?.headers as Record<string, string> | undefined)?.authorization;
  const json = (status: number, o: unknown) => Promise.resolve(new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } }));
  if (sent !== `Bearer ${KEY}`) return json(401, { msg: "bad key" });
  const id = url.split("/auth/v1/admin/users/")[1];
  fake.calls.push(`${method} ${id ? "/users/:id" : "/users"}`);
  if (method === "POST") {
    if (fake.failNextCreate) { fake.failNextCreate = false; return json(500, { msg: "boom" }); }
    if (String(body.password ?? "").length < 8) return json(422, { msg: "Password should be at least 8 characters." });
    const u: FakeUser = { id: randomUUID(), email: body.email, secret: body.password, confirmed: body.email_confirm === true };
    fake.users.set(u.id, u);
    return json(200, { id: u.id, email: u.email });
  }
  const u = id ? fake.users.get(id) : undefined;
  if (!u) return json(404, { msg: "not found" });
  if (method === "PUT") { u.secret = body.password; return json(200, { id: u.id }); }
  if (method === "DELETE") { fake.users.delete(u.id); return json(200, {}); }
  return json(405, {});
}

let control: Awaited<ReturnType<typeof newControl>>;
let router: RoutingDriver;
let admin: Membership;
const makeOrg = async (d: ProvisionDeps, name: string, slug: string, owner: number) => {
  const { tenantId, schema } = await startOrganization(d, { name, slug, ownerUserId: U(owner), ownerName: `Owner ${owner}`, ownerEmail: `owner${owner}@example.com` });
  expect((await advanceProvisioning(d, tenantId)).state).toBe("ready");
  return { tenantId, schema, userId: U(owner), role: "tenant_admin", vehicleScope: "all" as const, tenantName: name } satisfies Membership;
};
const asRole = (role: string, n: number): Membership => ({ ...admin, userId: U(n), role });
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(router, admin, fn);
const addName = (username: string, userId: string, loginEmail: string, invitationId: string) =>
  control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("insert into public.login_names(username, user_id, login_email, invitation_id) values ($1, $2, $3, $4)", [username, userId, loginEmail, invitationId]); });

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co"; process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
  vi.stubGlobal("fetch", adminFetch);
  control = await newControl();
  const f = farm();
  const d: ProvisionDeps = { control, provider: f.provider(), openDb: f.open, box, platformMigrations: platformMigrations(), tenantMigrations: tenantMigrations(), transform: stripExt, connectRetries: { tries: 1, delayMs: 0 } };
  router = routingDriver({ control, makeDriver: f.open, decrypt: box.decrypt });
  admin = await makeOrg(d, "Acme Transport", "acme", 1);
  // Employees on file, one of them holding a vehicle, as a company would have before inviting anyone.
  const e1 = await master.saveEmployee(router, admin, { full_name: "Driver One", employee_no: "D-101", phone: "0300 1111111" });
  await master.saveEmployee(router, admin, { full_name: "Driver Two", employee_no: "D-102" });
  await master.addVehicle(router, admin, { registration_no: "ACM-101", make: "Toyota", model: "Hilux", odometer_km: "1000", employee_id: e1.id, holding_since: "2026-01-01" });
  await master.addVehicle(router, admin, { registration_no: "ACM-999", make: "Isuzu", odometer_km: "500" });
});
beforeEach(() => { fake.calls.length = 0; fake.failNextCreate = false; process.env.SUPABASE_SERVICE_ROLE_KEY = KEY; });
afterAll(() => { vi.unstubAllGlobals(); delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

describe("the rules for a sign-in name", () => {
  it("accepts a plain name, lowercases it, and refuses odd or reserved ones", () => {
    expect(checkUsername("  Acme.D-101 ")).toEqual({ ok: true, username: "acme.d-101" });
    for (const bad of ["", "ab", "has space", "bad@name", "-lead", "x".repeat(31), "ünïcode", "admin", "Root"]) expect(checkUsername(bad).ok, bad).toBe(false);
  });
  it("suggests a name from the company and the employee code", () => {
    expect(suggestUsername("acme", "D-101")).toBe("acme.d-101");
    expect(suggestUsername("acme", "E 12/B")).toBe("acme.e12b");
    expect(suggestUsername("acme", "")).toBe("acme");
    expect(suggestUsername("", "")).toBe("");
    expect(suggestUsername("a-very-long-company-name", "EMPLOYEE-0001234").length).toBeLessThanOrEqual(30);
  });
  it("tells an email from a name, and a made-up login address from a real one", () => {
    expect(looksLikeEmail("a@b.co")).toBe(true);
    expect(looksLikeEmail("acme.d-101")).toBe(false);
    expect(isLoginEmail("u123@login.fleetotg.com")).toBe(true);
    expect(isLoginEmail("sara@gmail.com")).toBe(false);
  });
});

describe("inviting someone with no email", () => {
  it("is for one employee code and one role; the name and phone come from the employee record", async () => {
    const inv = await ad.inviteUser(router, admin, { employee_no: "D-101", username: "acme.d-101", role: "requester" });
    expect(inv).toMatchObject({ full_name: "Driver One", email: null, username: "acme.d-101", employee_no: "D-101", reset: false });
    const row = await raw(async (q) => (await q.query<{ email: string | null; username: string; employee_no: string; phone: string; role_key: string; vehicle_scope: string }>(
      "select email, username, employee_no, phone, role_key, vehicle_scope from public.invitations where id = $1", [inv.id])).rows[0]);
    expect(row).toEqual({ email: null, username: "acme.d-101", employee_no: "D-101", phone: "0300 1111111", role_key: "requester", vehicle_scope: "own" });
    expect(await ad.previewInvitation(router, inv.token)).toEqual({ workspace: "Acme Transport", full_name: "Driver One", email: null, username: "acme.d-101", reset: false });
    const listed = (await ad.listInvitations(router, admin)).find((i) => i.id === inv.id);
    expect(listed).toMatchObject({ username: "acme.d-101", employee_no: "D-101", email: null, reset: false });
  });

  it("refuses what cannot work, in plain words", async () => {
    const t = (input: Record<string, unknown>) => ad.inviteUser(router, admin, input);
    await expect(t({ username: "acme.nocode", role: "requester" })).rejects.toThrow(/employee code/i);
    await expect(t({ employee_no: "D-102", role: "requester" })).rejects.toThrow(/sign-in name/i);                                  // no email and no name
    await expect(t({ employee_no: "D-102", username: "admin", role: "requester" })).rejects.toThrow(/not available/);
    await expect(t({ employee_no: "D-102", username: "a b", role: "requester" })).rejects.toThrow(/letters, numbers/);
    await expect(t({ employee_no: "D-101", username: "acme.other", role: "requester" })).rejects.toThrow(/already has an open invitation/);   // one open invitation per employee
    await expect(t({ employee_no: "D-102", username: "acme.d-101", role: "requester" })).rejects.toThrow(/already has an open invitation/);   // and per name
    await expect(t({ employee_no: "D-102", username: "acme.d-102", role: "vendor", vendor_id: randomUUID(), full_name: "Workshop Co" })).rejects.toThrow(/no employee code/);
    await expect(t({ employee_no: "D-102", username: "acme.d-102", role: "no-such-role" })).rejects.toThrow(/Unknown role/);
    await expect(ad.inviteUser(router, asRole("auditor", 40), { employee_no: "D-102", username: "acme.d-102", role: "requester" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an employee code with no record yet is fine, but then a name is needed", async () => {
    await expect(ad.inviteUser(router, admin, { employee_no: "N-1", username: "acme.n-1", role: "requester" })).rejects.toThrow(/full name/i);
    const inv = await ad.inviteUser(router, admin, { employee_no: "N-1", username: "acme.n-1", role: "requester", full_name: "New Hire" });
    expect(inv.full_name).toBe("New Hire");
    await ad.revokeInvitation(router, admin, inv.id);
  });

  it("says plainly when the owner has not switched sign-in names on", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(ad.inviteUser(router, admin, { employee_no: "D-102", username: "acme.d-102", role: "requester" })).rejects.toThrow(/not switched on/);
  });

  it("an invitation by email is also for an employee code and a role", async () => {
    await expect(ad.inviteUser(router, admin, { full_name: "Mgr", email: "mgr@example.com", role: "fleet_manager" })).rejects.toThrow(/employee code/i);
    const inv = await ad.inviteUser(router, admin, { email: "mgr@example.com", role: "fleet_manager", employee_no: "M-1", full_name: "Mona Manager" });
    expect(inv).toMatchObject({ email: "mgr@example.com", username: null, employee_no: "M-1" });
    await ad.acceptInvitation(router, { token: inv.token }, { id: U(30), email: "mgr@example.com", emailConfirmed: true });
    expect(await raw(async (q) => (await q.query<{ employee_no: string; full_name: string }>("select employee_no, full_name from employees where user_id = $1", [U(30)])).rows)).toEqual([{ employee_no: "M-1", full_name: "Mona Manager" }]);
  });
});

describe("opening the link and choosing a password", () => {
  it("makes the login, links the employee (and so the vehicle), joins the workspace, and the link is used up", async () => {
    const open = (await ad.listInvitations(router, admin)).find((i) => i.employee_no === "D-101")!;
    const fresh = await ad.resendInvitation(router, admin, open.id);                  // the earlier link was shown once and is no longer in hand
    const r = await ad.acceptWithUsername(router, fresh.token, PW);
    expect(r.slug).toBe("acme");
    expect(r.reset).toBe(false);
    expect(isLoginEmail(r.loginEmail)).toBe(true);
    expect(fake.calls).toEqual(["POST /users"]);
    const made = [...fake.users.values()].find((u) => u.email === r.loginEmail)!;
    expect(made).toMatchObject({ confirmed: true, secret: PW });
    // the control plane knows the name, and finds the made-up address for it
    expect(await loginEmailFor(router, "ACME.D-101")).toBe(r.loginEmail);
    expect(await usernameTaken(router, "acme.d-101")).toBe(true);
    expect((await loginNameByUserId(router, made.id))?.username).toBe("acme.d-101");
    // the person is in the workspace, as a vehicle user linked to the employee who holds the vehicle
    const m = (await resolveMembership(router, made.id, "acme"))!;
    expect(m).toMatchObject({ role: "requester", vehicleScope: "own" });
    expect((await master.listVehicles(router, m)).map((v) => v.registration_no)).toEqual(["ACM-101"]);   // only the vehicle they hold
    expect(await raw(async (q) => (await q.query<{ full_name: string; employee_no: string }>("select full_name, employee_no from employees where user_id = $1", [made.id])).rows)).toEqual([{ full_name: "Driver One", employee_no: "D-101" }]);
    expect(await raw(async (q) => (await q.query<{ c: number }>("select count(*)::int c from employees where employee_no = 'D-101'")).rows[0].c)).toBe(1);   // linked, not duplicated
    // the link works once
    expect(await ad.previewInvitation(router, fresh.token)).toBeNull();
    await expect(ad.acceptWithUsername(router, fresh.token, PW)).rejects.toThrow(/not working/);
    expect(fake.calls).toEqual(["POST /users"]);
  });

  it("shows up in the people list with the employee code and the sign-in name", async () => {
    const mine = (await ad.listMembers(router, admin)).find((p) => p.employee_no === "D-101")!;
    expect(mine).toMatchObject({ username: "acme.d-101", email: null, full_name: "Driver One", role: "requester", status: "active" });
  });

  it("a weak or failed set-up leaves no login behind and the same link can be tried again", async () => {
    const inv = await ad.inviteUser(router, admin, { employee_no: "D-102", username: "acme.d-102", role: "requester" });
    await expect(ad.acceptWithUsername(router, inv.token, "short")).rejects.toThrow(/stronger/);
    fake.failNextCreate = true;
    await expect(ad.acceptWithUsername(router, inv.token, PW)).rejects.toBeInstanceOf(UserError);
    expect(await usernameTaken(router, "acme.d-102")).toBe(false);
    expect(fake.users.size).toBe(1);                                                  // only Driver One's login exists
    const ok = await ad.acceptWithUsername(router, inv.token, PW);
    expect(ok.slug).toBe("acme");
    expect(fake.users.size).toBe(2);
  });

  it("a half-made login is finished by the same link, and refused to any other", async () => {
    await master.saveEmployee(router, admin, { full_name: "Driver Three", employee_no: "D-103" });
    const inv = await ad.inviteUser(router, admin, { employee_no: "D-103", username: "acme.d-103", role: "requester" });
    // the login and its name were made, then the set-up stopped before the membership was written
    const id = randomUUID(), loginEmail = `u${"a".repeat(24)}@login.fleetotg.com`;
    fake.users.set(id, { id, email: loginEmail, secret: OLD_PW, confirmed: true });
    const invRow = (await ad.listInvitations(router, admin)).find((i) => i.employee_no === "D-103")!;
    await addName("acme.d-103", id, loginEmail, invRow.id);
    fake.calls.length = 0;
    const r = await ad.acceptWithUsername(router, inv.token, PW2);
    expect(fake.calls).toEqual(["PUT /users/:id"]);                                   // the password was set again; no second login was made
    expect(fake.users.get(id)!.secret).toBe(PW2);
    expect(r.loginEmail).toBe(loginEmail);
    expect(await resolveMembership(router, id, "acme")).toMatchObject({ role: "requester" });

    // a name that belongs to a login made by a different invitation is not handed over
    const other = await ad.inviteUser(router, admin, { employee_no: "D-104", username: "acme.d-104", role: "requester", full_name: "Driver Four" });
    const id2 = randomUUID(), email2 = `u${"b".repeat(24)}@login.fleetotg.com`;
    fake.users.set(id2, { id: id2, email: email2, secret: OTHER_PW, confirmed: true });
    await addName("acme.d-104", id2, email2, randomUUID());
    await expect(ad.acceptWithUsername(router, other.token, PW)).rejects.toThrow(/already taken/);
    expect(fake.users.get(id2)!.secret).toBe(OTHER_PW);
  });
});

describe("a password reset link for someone with no email", () => {
  const driverOne = async () => (await ad.listMembers(router, admin)).find((p) => p.username === "acme.d-101")!.user_id;

  it("is made by an administrator, works once, replaces any earlier link, and keeps the same sign-in name", async () => {
    const userId = await driverOne();
    const first = await ad.issueResetLink(router, admin, userId);
    expect(first).toMatchObject({ reset: true, username: "acme.d-101", employee_no: "D-101", full_name: "Driver One", email: null });
    expect(await ad.previewInvitation(router, first.token)).toMatchObject({ reset: true, username: "acme.d-101" });
    const second = await ad.issueResetLink(router, admin, userId);                    // the first stops working
    expect(await ad.previewInvitation(router, first.token)).toBeNull();
    fake.calls.length = 0;
    const r = await ad.acceptWithUsername(router, second.token, PW2);
    expect(r).toMatchObject({ slug: "acme", reset: true });
    expect(fake.calls).toEqual(["PUT /users/:id"]);
    expect(fake.users.get(userId)!.secret).toBe(PW2);
    await expect(ad.acceptWithUsername(router, second.token, PW)).rejects.toThrow(/not working/);
    expect(fake.users.get(userId)!.secret).toBe(PW2);
    expect((await ad.listInvitations(router, admin)).filter((i) => i.reset)).toEqual([]);   // nothing left open
  });

  it("is only for people with a sign-in name, never for yourself, never without the permission", async () => {
    await expect(ad.issueResetLink(router, admin, U(30))).rejects.toThrow(/Forgot your password/);          // Mona signs in with an email
    await expect(ad.issueResetLink(router, admin, U(1))).rejects.toThrow(/another administrator/);
    await expect(ad.issueResetLink(router, asRole("fleet_manager", 41), await driverOne())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ad.issueResetLink(router, admin, randomUUID())).rejects.toBeInstanceOf(UserError);
  });

  it("refuses a switched-off person, and a reset link does not work after their access is switched off", async () => {
    const userId = await driverOne();
    const link = await ad.issueResetLink(router, admin, userId);
    await ad.changeMember(router, admin, userId, { status: "disabled" });
    await expect(ad.acceptWithUsername(router, link.token, PW)).rejects.toThrow(/switched off/);
    await expect(ad.issueResetLink(router, admin, userId)).rejects.toThrow(/switched off/);
    await ad.changeMember(router, admin, userId, { status: "active" });
  });

  it("a made-up login address is never indexed, so no invitation can be found by it", async () => {
    const n = await control.transaction(async (q) => { await q.query("set local search_path = public"); return (await q.query<{ n: string }>("select count(*)::text n from public.invite_index where lower(email) like '%@login.fleetotg.com'")).rows[0].n; });
    expect(n).toBe("0");
  });
});
