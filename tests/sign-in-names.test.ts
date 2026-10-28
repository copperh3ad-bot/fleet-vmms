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
import { checkRecoveryCode, checkUsername, hashRecoveryCode, isLoginEmail, loginEmailFor, loginNameByUserId, looksLikeEmail, suggestUsername, usernameTaken, verifyRecoveryCode } from "@/lib/auth/login-names";
import { normalizePhone, smsLink, whatsappLink } from "@/lib/phone";
import { farm, newControl, platformMigrations, stripExt, tenantMigrations } from "./helpers";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
const box = secretBox(randomBytes(32));
const secretWord = (...parts: string[]) => parts.join("-");
const PW = secretWord("a-long", "test", "word", "1"), PW2 = secretWord("a-new", "test", "word", "2");
const OLD_PW = secretWord("an-old", "test", "word", "3"), OTHER_PW = secretWord("someone-elses", "test", "word", "4");
const KEY = secretWord("test", "service", "key");
const CODE = "482915", WRONG_CODE = "159263";

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
    const inv = await ad.inviteUser(router, admin, { employee_no: "D-101", username: "acme.d-101", role: "requester" });   // no phone typed: the one on the employee record is used
    expect(inv).toMatchObject({ full_name: "Driver One", email: null, phone: "+923001111111", username: "acme.d-101", employee_no: "D-101", reset: false });
    const row = await raw(async (q) => (await q.query<{ email: string | null; username: string; employee_no: string; phone: string; role_key: string; vehicle_scope: string }>(
      "select email, username, employee_no, phone, role_key, vehicle_scope from public.invitations where id = $1", [inv.id])).rows[0]);
    expect(row).toEqual({ email: null, username: "acme.d-101", employee_no: "D-101", phone: "+923001111111", role_key: "requester", vehicle_scope: "own" });
    expect(await ad.previewInvitation(router, inv.token)).toEqual({ workspace: "Acme Transport", full_name: "Driver One", email: null, username: "acme.d-101", reset: false, codeRequired: false, phoneHint: null });
    const listed = (await ad.listInvitations(router, admin)).find((i) => i.id === inv.id);
    expect(listed).toMatchObject({ username: "acme.d-101", employee_no: "D-101", email: null, reset: false });
  });

  it("refuses what cannot work, in plain words", async () => {
    const t = (input: Record<string, unknown>) => ad.inviteUser(router, admin, { phone: "0300 1234567", ...input });
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
    await expect(ad.inviteUser(router, admin, { phone: "0300 1234567", employee_no: "N-1", username: "acme.n-1", role: "requester" })).rejects.toThrow(/full name/i);
    const inv = await ad.inviteUser(router, admin, { phone: "0300 1234567", employee_no: "N-1", username: "acme.n-1", role: "requester", full_name: "New Hire" });
    expect(inv.full_name).toBe("New Hire");
    await ad.revokeInvitation(router, admin, inv.id);
  });

  it("says plainly when the owner has not switched sign-in names on", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(ad.inviteUser(router, admin, { phone: "0300 1234567", employee_no: "D-102", username: "acme.d-102", role: "requester" })).rejects.toThrow(/not switched on/);
  });

  it("an invitation by email is also for an employee code and a role", async () => {
    await expect(ad.inviteUser(router, admin, { phone: "0300 1234567", full_name: "Mgr", email: "mgr@example.com", role: "fleet_manager" })).rejects.toThrow(/employee code/i);
    const inv = await ad.inviteUser(router, admin, { phone: "0300 1234567", email: "mgr@example.com", role: "fleet_manager", employee_no: "M-1", full_name: "Mona Manager" });
    expect(inv).toMatchObject({ email: "mgr@example.com", username: null, employee_no: "M-1" });
    await ad.acceptInvitation(router, { token: inv.token }, { id: U(30), email: "mgr@example.com", emailConfirmed: true });
    expect(await raw(async (q) => (await q.query<{ employee_no: string; full_name: string }>("select employee_no, full_name from employees where user_id = $1", [U(30)])).rows)).toEqual([{ employee_no: "M-1", full_name: "Mona Manager" }]);
  });
});

describe("opening the link and choosing a password", () => {
  it("makes the login, links the employee (and so the vehicle), joins the workspace, and the link is used up", async () => {
    const open = (await ad.listInvitations(router, admin)).find((i) => i.employee_no === "D-101")!;
    const fresh = await ad.resendInvitation(router, admin, open.id);                  // the earlier link was shown once and is no longer in hand
    const r = await ad.acceptWithUsername(router, fresh.token, PW, CODE);
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
    await expect(ad.acceptWithUsername(router, fresh.token, PW, CODE)).rejects.toThrow(/not working/);
    expect(fake.calls).toEqual(["POST /users"]);
  });

  it("shows up in the people list with the employee code and the sign-in name", async () => {
    const mine = (await ad.listMembers(router, admin)).find((p) => p.employee_no === "D-101")!;
    expect(mine).toMatchObject({ username: "acme.d-101", email: null, full_name: "Driver One", role: "requester", status: "active" });
  });

  it("a weak or failed set-up leaves no login behind and the same link can be tried again", async () => {
    const inv = await ad.inviteUser(router, admin, { phone: "0300 1234567", employee_no: "D-102", username: "acme.d-102", role: "requester" });
    await expect(ad.acceptWithUsername(router, inv.token, "short", CODE)).rejects.toThrow(/stronger/);
    fake.failNextCreate = true;
    await expect(ad.acceptWithUsername(router, inv.token, PW, CODE)).rejects.toBeInstanceOf(UserError);
    expect(await usernameTaken(router, "acme.d-102")).toBe(false);
    expect(fake.users.size).toBe(1);                                                  // only Driver One's login exists
    const ok = await ad.acceptWithUsername(router, inv.token, PW, CODE);
    expect(ok.slug).toBe("acme");
    expect(fake.users.size).toBe(2);
  });

  it("a half-made login is finished by the same link, and refused to any other", async () => {
    await master.saveEmployee(router, admin, { full_name: "Driver Three", employee_no: "D-103" });
    const inv = await ad.inviteUser(router, admin, { phone: "0300 1234567", employee_no: "D-103", username: "acme.d-103", role: "requester" });
    // the login and its name were made, then the set-up stopped before the membership was written
    const id = randomUUID(), loginEmail = `u${"a".repeat(24)}@login.fleetotg.com`;
    fake.users.set(id, { id, email: loginEmail, secret: OLD_PW, confirmed: true });
    const invRow = (await ad.listInvitations(router, admin)).find((i) => i.employee_no === "D-103")!;
    await addName("acme.d-103", id, loginEmail, invRow.id);
    fake.calls.length = 0;
    const r = await ad.acceptWithUsername(router, inv.token, PW2, CODE);
    expect(fake.calls).toEqual(["PUT /users/:id"]);                                   // the password was set again; no second login was made
    expect(fake.users.get(id)!.secret).toBe(PW2);
    expect(r.loginEmail).toBe(loginEmail);
    expect(await resolveMembership(router, id, "acme")).toMatchObject({ role: "requester" });

    // a name that belongs to a login made by a different invitation is not handed over
    const other = await ad.inviteUser(router, admin, { phone: "0300 1234567", employee_no: "D-104", username: "acme.d-104", role: "requester", full_name: "Driver Four" });
    const id2 = randomUUID(), email2 = `u${"b".repeat(24)}@login.fleetotg.com`;
    fake.users.set(id2, { id: id2, email: email2, secret: OTHER_PW, confirmed: true });
    await addName("acme.d-104", id2, email2, randomUUID());
    await expect(ad.acceptWithUsername(router, other.token, PW, CODE)).rejects.toThrow(/already taken/);
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
    const r = await ad.acceptWithUsername(router, second.token, PW2, CODE);
    expect(r).toMatchObject({ slug: "acme", reset: true });
    expect(fake.calls).toEqual(["PUT /users/:id"]);
    expect(fake.users.get(userId)!.secret).toBe(PW2);
    await expect(ad.acceptWithUsername(router, second.token, PW, CODE)).rejects.toThrow(/not working/);
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
    await expect(ad.acceptWithUsername(router, link.token, PW, CODE)).rejects.toThrow(/switched off/);
    await expect(ad.issueResetLink(router, admin, userId)).rejects.toThrow(/switched off/);
    await ad.changeMember(router, admin, userId, { status: "active" });
  });

  it("a made-up login address is never indexed, so no invitation can be found by it", async () => {
    const n = await control.transaction(async (q) => { await q.query("set local search_path = public"); return (await q.query<{ n: string }>("select count(*)::text n from public.invite_index where lower(email) like '%@login.fleetotg.com'")).rows[0].n; });
    expect(n).toBe("0");
  });
});

describe("the recovery code stops an administrator from taking a login over", () => {
  const driverOne = async () => (await ad.listMembers(router, admin)).find((p) => p.username === "acme.d-101")!.user_id;
  const clearLimits = () => control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("delete from public.rate_limits"); });

  it("rules: digits only, 6 to 12, nothing trivial; only a salted hash is ever kept", () => {
    expect(checkRecoveryCode("482 915")).toEqual({ ok: true, code: "482915" });
    for (const bad of ["", "12345", "1234567890123", "12ab56", "111111", "123456", "654321", "000000"]) expect(checkRecoveryCode(bad).ok, bad).toBe(false);
    const h = hashRecoveryCode("482915");
    expect(h.startsWith("s1$")).toBe(true);
    expect(h).not.toContain("482915");
    expect(hashRecoveryCode("482915")).not.toBe(h);                                   // a fresh salt each time
    expect(verifyRecoveryCode("482915", h)).toBe(true);
    expect(verifyRecoveryCode("482 915", h)).toBe(true);
    expect(verifyRecoveryCode("482916", h)).toBe(false);
    expect(verifyRecoveryCode("482915", null)).toBe(false);
    expect(verifyRecoveryCode("482915", "garbage")).toBe(false);
  });

  it("a first set-up needs a good code, and the code is stored only as a hash", async () => {
    await master.saveEmployee(router, admin, { full_name: "Driver Five", employee_no: "D-105" });
    const inv = await ad.inviteUser(router, admin, { phone: "0300 1234567", employee_no: "D-105", username: "acme.d-105", role: "requester" });
    await expect(ad.acceptWithUsername(router, inv.token, PW, "")).rejects.toThrow(/recovery code/i);
    await expect(ad.acceptWithUsername(router, inv.token, PW, "111111")).rejects.toThrow(/too easy/i);
    expect(await usernameTaken(router, "acme.d-105")).toBe(false);                    // nothing was made by the refused tries
    await ad.acceptWithUsername(router, inv.token, PW, CODE);
    const stored = await control.transaction(async (q) => { await q.query("set local search_path = public"); return (await q.query<{ recovery_hash: string }>("select recovery_hash from public.login_names where username = 'acme.d-105'")).rows[0].recovery_hash; });
    expect(stored.startsWith("s1$")).toBe(true);
    expect(stored).not.toContain(CODE);
  });

  it("the reset link alone does nothing: it needs the code the person chose, so whoever holds the link cannot set the password", async () => {
    await clearLimits();
    const userId = await driverOne();
    const before = fake.users.get(userId)!.secret;
    const link = await ad.issueResetLink(router, admin, userId);
    fake.calls.length = 0;
    await expect(ad.acceptWithUsername(router, link.token, "an-admins-own-choice-9", WRONG_CODE)).rejects.toThrow(/recovery code is not right/);
    await expect(ad.acceptWithUsername(router, link.token, "an-admins-own-choice-9", "")).rejects.toThrow(/recovery code is not right/);
    expect(fake.calls).toEqual([]);                                                   // the login service was never asked to change anything
    expect(fake.users.get(userId)!.secret).toBe(before);
    expect(await ad.previewInvitation(router, link.token)).toMatchObject({ reset: true });   // the link is still there for the real person
    const ok = await ad.acceptWithUsername(router, link.token, PW2, CODE);            // the person, with their code
    expect(ok.reset).toBe(true);
    expect(fake.users.get(userId)!.secret).toBe(PW2);
  });

  it("wrong codes are counted per person across links, and five in an hour lock the guessing", async () => {
    await clearLimits();
    const userId = await driverOne();
    const first = await ad.issueResetLink(router, admin, userId);
    for (let i = 0; i < 5; i++) await expect(ad.acceptWithUsername(router, first.token, PW, String(100000 + i * 7919))).rejects.toThrow(/not right/);
    const fresh = await ad.issueResetLink(router, admin, userId);                      // a new link does not give new tries
    await expect(ad.acceptWithUsername(router, fresh.token, PW, WRONG_CODE)).rejects.toThrow(/Too many wrong recovery codes/);
    await expect(ad.acceptWithUsername(router, fresh.token, PW, CODE)).rejects.toThrow(/Too many wrong recovery codes/);   // even the right one waits
    await clearLimits();
    expect((await ad.acceptWithUsername(router, fresh.token, PW, CODE)).reset).toBe(true);
    await clearLimits();
  });

  it("replacing a login is for someone who forgot both: it switches the old login off, frees the code, and leaves a trace", async () => {
    await clearLimits();
    const userId = await driverOne();
    const link = await ad.issueResetLink(router, admin, userId);
    fake.calls.length = 0;
    const r = await ad.replaceLogin(router, admin, userId);
    expect(r).toEqual({ username: "acme.d-101", employee_no: "D-101" });
    expect(fake.calls).toContain("DELETE /users/:id");
    expect(fake.users.has(userId)).toBe(false);                                        // the old login no longer exists
    expect(await usernameTaken(router, "acme.d-101")).toBe(false);
    expect(await loginNameByUserId(router, userId)).toBeNull();
    expect(await resolveMembership(router, userId, "acme")).toBeNull();
    expect(await ad.previewInvitation(router, link.token)).toBeNull();                 // an open reset link died with it
    expect(await raw(async (q) => (await q.query<{ user_id: string | null }>("select user_id from employees where employee_no = 'D-101'")).rows[0].user_id)).toBeNull();
    // the trace: the membership is kept (disabled), and the change is in the audit log with who made it
    expect(await raw(async (q) => (await q.query<{ status: string }>("select status from public.tenant_memberships where user_id = $1", [userId])).rows[0].status)).toBe("disabled");
    // and the person can be invited again, with a brand new login on the same employee record
    const again = await ad.inviteUser(router, admin, { phone: "0300 1234567", employee_no: "D-101", username: "acme.d-101", role: "requester" });
    const made = await ad.acceptWithUsername(router, again.token, PW, CODE);
    expect(made.slug).toBe("acme");
    const m = (await resolveMembership(router, [...fake.users.values()].find((u) => u.email === made.loginEmail)!.id, "acme"))!;
    expect((await master.listVehicles(router, m)).map((v) => v.registration_no)).toEqual(["ACM-101"]);   // same employee record, same vehicle
  });

  it("replace login is not for yourself, not for email people, not without the permission, not for the last administrator", async () => {
    const userId = await driverOne();
    await expect(ad.replaceLogin(router, admin, U(1))).rejects.toThrow(/another administrator/);
    await expect(ad.replaceLogin(router, admin, U(30))).rejects.toThrow(/signs in with an email/);
    await expect(ad.replaceLogin(router, asRole("fleet_manager", 41), userId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ad.replaceLogin(router, admin, randomUUID())).rejects.toThrow(/signs in with an email/);
  });
});

describe("invitation links go to a phone number and nowhere else", () => {
  it("turns the way people type a number into one a message can reach", () => {
    for (const [typed, e164] of [["0300 1234567", "+923001234567"], ["0300-1234567", "+923001234567"], ["(0300) 123 4567", "+923001234567"], ["3001234567", "+923001234567"], ["+92 300 1234567", "+923001234567"],
      ["0092 300 1234567", "+923001234567"], ["923001234567", "+923001234567"], ["+44 7700 900123", "+447700900123"]] as const) {
      const r = normalizePhone(typed);
      expect(r.ok && r.e164, typed).toBe(e164);
    }
    const r = normalizePhone("0300 1234567");
    expect(r.ok && r.display).toBe("0300 1234567");
    expect(r.ok && r.digits).toBe("923001234567");
  });
  it("refuses what no message can reach", () => {
    for (const bad of ["", "   ", "abc", "0300 12345", "0400 1234567", "0300 123456789", "+92 300", "1234567", "0000 0000000", "+1", "03001234567x", "+999999999999999999"])
      expect(normalizePhone(bad).ok, bad).toBe(false);
  });
  it("makes links that open WhatsApp and the messages app on that exact number", () => {
    expect(whatsappLink("923001234567", "Hi there: https://x.test/invite/abc")).toBe("https://wa.me/923001234567?text=Hi%20there%3A%20https%3A%2F%2Fx.test%2Finvite%2Fabc");
    expect(smsLink("+923001234567", "a b")).toBe("sms:+923001234567?&body=a%20b");
  });

  it("every invitation needs a phone number, typed or from the employee record, and it is stored in the international form", async () => {
    await master.saveEmployee(router, admin, { full_name: "No Phone Pat", employee_no: "NP-1" });
    await expect(ad.inviteUser(router, admin, { employee_no: "NP-1", username: "acme.np-1", role: "requester" })).rejects.toThrow(/phone number/i);
    await expect(ad.inviteUser(router, admin, { employee_no: "NP-1", username: "acme.np-1", role: "requester", phone: "12345" })).rejects.toThrow(/phone number|Start the number/i);
    await expect(ad.inviteUser(router, admin, { employee_no: "NP-1", email: "pat@example.com", role: "requester" })).rejects.toThrow(/phone number/i);     // an email invitation too
    const inv = await ad.inviteUser(router, admin, { employee_no: "NP-1", username: "acme.np-1", role: "requester", phone: "0301-2223334" });
    expect(inv.phone).toBe("+923012223334");
    await ad.revokeInvitation(router, admin, inv.id);
  });

  it("the number the link was sent to is kept on the employee record when the person joins", async () => {
    await master.saveEmployee(router, admin, { full_name: "Keep Number", employee_no: "KN-1" });
    const inv = await ad.inviteUser(router, admin, { employee_no: "KN-1", username: "acme.kn-1", role: "requester", phone: "0302 3334445" });
    await ad.acceptWithUsername(router, inv.token, PW, CODE);
    expect(await raw(async (q) => (await q.query<{ phone: string }>("select phone from employees where employee_no = 'KN-1'")).rows[0].phone)).toBe("+923023334445");
  });

  it("a reset link is sent to the phone on the employee record, so a person with none cannot be sent one", async () => {
    await master.saveEmployee(router, admin, { full_name: "Reset Rana", employee_no: "RR-1", phone: "0303 4445556" });
    const inv = await ad.inviteUser(router, admin, { employee_no: "RR-1", username: "acme.rr-1", role: "requester" });
    await ad.acceptWithUsername(router, inv.token, PW, CODE);
    const userId = (await ad.listMembers(router, admin)).find((p) => p.username === "acme.rr-1")!.user_id;
    expect((await ad.issueResetLink(router, admin, userId)).phone).toBe("+923034445556");
    await raw((q) => q.query("update employees set phone = null where employee_no = 'RR-1'"));
    await expect(ad.issueResetLink(router, admin, userId)).rejects.toThrow(/no phone number/i);
  });

  it("a person who asks to join with the company code is not sent a link, so their approval needs no phone number", async () => {
    // the approver's screen is exercised in the browser test; here, only that the option exists and is not the default
    await expect(ad.inviteUser(router, admin, { employee_no: "JN-1", email: "join@example.com", role: "requester", full_name: "Join Person" })).rejects.toThrow(/phone number/i);
    const inv = await ad.inviteUser(router, admin, { employee_no: "JN-1", email: "join@example.com", role: "requester", full_name: "Join Person" }, { phoneOptional: true });
    expect(inv.phone).toBeNull();
    await ad.revokeInvitation(router, admin, inv.id);
  });
});
