// Asking to join a company with its code (ADR-016): the code, the public request, the administrator's decision, and the rule
// that one company never sees, approves or reaches another's requests.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { routingDriver, type RoutingDriver } from "@/lib/db/router";
import { ForbiddenError, listWorkspaces, resolveMembership, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as ad from "@/lib/admin/service";
import * as jc from "@/lib/jobcards/service";
import { getNavCounts } from "@/lib/dashboard/service";
import { advanceProvisioning, type ProvisionDeps } from "@/lib/orgs/provision";
import { claimSignup, parseSignup, recordSignup } from "@/lib/orgs/signup";
import {
  approveJoinRequest, confirmJoinWithCode, declineJoinRequest, findTenantByJoinCode, formatCode, getJoinCode, listJoinRequests, MAX_WAITING, newJoinCode, normalizeCode,
  parseJoin, setJoinCode, submitJoinRequest, waitingRequestsFor,
} from "@/lib/orgs/join";
import { newControl, platformMigrations, stripExt, tenantMigrations, testDriver } from "./helpers";
import type { Driver } from "@/lib/db/types";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
const unavailable = () => { throw new Error("not used for shared organizations"); };

let control: Driver;
let router: RoutingDriver;
let deps: ProvisionDeps;
type Org = { tenantId: string; schema: string; slug: string; admin: Membership };
let A: Org, B: Org;

const KEYS = ["WHATSAPP_OTP_TEMPLATE", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN"];
const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterAll(() => { for (const k of KEYS) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } });

beforeAll(async () => {
  Object.assign(process.env, { WHATSAPP_OTP_TEMPLATE: "fleetotg_code", WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "stand-in" });
  control = process.env.TEST_DATABASE_URL ? await testDriver() : await newControl();
  router = routingDriver({ control, makeDriver: () => { throw new Error("no dedicated databases here"); }, decrypt: unavailable });
  deps = {
    control, openDb: () => { throw new Error("no dedicated databases here"); }, platformMigrations: platformMigrations(), tenantMigrations: tenantMigrations(), transform: stripExt,
    provider: { name: "none", async create() { return unavailable(); }, async destroy() { return unavailable(); } },
    box: { encrypt: unavailable, decrypt: unavailable },
  };
  A = await signUp(1, "Join Alpha");
  B = await signUp(2, "Join Bravo");
});

async function signUp(n: number, org: string): Promise<Org> {
  const email = `joinowner${n}@example.com`;
  await recordSignup(control, parseSignup({ org_name: org, contact_name: `Owner ${n}`, email, terms: "on" }));
  const t = (await claimSignup(control, { id: U(n), email, emailConfirmed: true }, { kind: "shared" }))!;
  expect((await advanceProvisioning(deps, t.tenantId)).state).toBe("ready");
  const slug = (await control.transaction(async (q) => (await q.query<{ slug: string }>("select slug from public.tenants where id = $1", [t.tenantId])).rows[0])).slug;
  return { ...t, slug, admin: { tenantId: t.tenantId, schema: t.schema, userId: U(n), role: "tenant_admin", vehicleScope: "all", tenantName: org } };
}
const member = (o: Org, role: string, n: number): Membership => ({ tenantId: o.tenantId, schema: o.schema, userId: U(n), role, vehicleScope: "all" });
const form = (code: string, over: Record<string, unknown> = {}) => ({ code, full_name: "Sana Malik", email: "Sana@Example.com", phone: "0300 1234567", licence_no: "LHR-1234567", licence_expires_on: "2099-12-31", workshop_name: "", note: "", terms: "on", ...over });
// A request is invisible to the administrator until the person types the code sent to their WhatsApp (ADR-055): this sends it with a stand-in sender and types the code, so the older tests see it as before.
const sentCodes: string[] = [];
const fakeSend = (async (_to: string, m: { code: string }) => { sentCodes.push(m.code); }) as never;
const ask = async (code: string, kind: "staff" | "workshop", over: Record<string, unknown> = {}) => {
  const r = await submitJoinRequest(router, kind, parseJoin(form(code, over), kind), fakeSend);
  await confirmJoinWithCode(router, r.ref, sentCodes[sentCodes.length - 1]);
  return r;
};
const pending = async (o: Org) => (await listJoinRequests(router, o.admin)).map((r) => r.email);
const indexed = async (email: string) => waitingRequestsFor(router, email);

describe("the code", () => {
  it("is ten unambiguous characters, typed any way, and never repeats by chance", () => {
    const c = newJoinCode();
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(normalizeCode(" k7mq2-x9pth ")).toBe("K7MQ2X9PTH");
    expect(formatCode("K7MQ2X9PTH")).toBe("K7MQ2-X9PTH");
    expect(new Set(Array.from({ length: 500 }, newJoinCode)).size).toBe(500);
  });

  it("the form checks each field, and a workshop must name itself", () => {
    expect(parseJoin(form("k7mq2-x9pth"), "staff")).toMatchObject({ code: "K7MQ2X9PTH", email: "sana@example.com", full_name: "Sana Malik" });
    const e = (() => { try { parseJoin(form("short", { full_name: "S", email: "nope", terms: undefined }), "staff"); } catch (x) { return x as UserError; } })()!;
    expect(Object.keys(e.fields ?? {}).sort()).toEqual(["code", "email", "full_name", "terms"]);
    expect(() => parseJoin(form("K7MQ2X9PTH"), "workshop")).toThrow(UserError);
    expect(parseJoin(form("K7MQ2X9PTH", { workshop_name: "Speedy Auto" }), "workshop").workshop_name).toBe("Speedy Auto");
    expect(parseJoin(form("K7MQ2X9PTH", { workshop_name: "Ignored" }), "staff").workshop_name).toBeUndefined();
  });
});

describe("the administrator's code", () => {
  it("is off until switched on, stays the same when asked again, and a new one stops the old at once", async () => {
    expect(await getJoinCode(router, A.admin)).toBeNull();
    const code = (await setJoinCode(router, A.admin, "on"))!;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(await setJoinCode(router, A.admin, "on")).toBe(code);
    expect((await findTenantByJoinCode(router, code))?.id).toBe(A.tenantId);
    const fresh = (await setJoinCode(router, A.admin, "regenerate"))!;
    expect(fresh).not.toBe(code);
    expect(await findTenantByJoinCode(router, code)).toBeNull();
    expect((await findTenantByJoinCode(router, fresh))?.id).toBe(A.tenantId);
    expect(await setJoinCode(router, A.admin, "off")).toBeNull();
    expect(await findTenantByJoinCode(router, fresh)).toBeNull();
  });

  it("two companies never get the same code, and each code opens only its own company", async () => {
    const a = (await setJoinCode(router, A.admin, "on"))!, b = (await setJoinCode(router, B.admin, "on"))!;
    expect(a).not.toBe(b);
    expect((await findTenantByJoinCode(router, a))?.id).toBe(A.tenantId);
    expect((await findTenantByJoinCode(router, b))?.id).toBe(B.tenantId);
  });

  it("only people who manage users may see or change it", async () => {
    for (const role of ["requester", "finance", "auditor", "vendor", "fleet_manager"]) {
      await expect(getJoinCode(router, member(A, role, 40))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setJoinCode(router, member(A, role, 40), "regenerate")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listJoinRequests(router, member(A, role, 40))).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("asking to join", () => {
  it("an unknown code is refused with a plain message and records nothing", async () => {
    await expect(ask("ZZZZZZZZZZ", "staff", { email: "ghost@example.com" })).rejects.toMatchObject({ fields: { code: expect.any(String) } });
    expect(await pending(A)).not.toContain("ghost@example.com");
    expect(await indexed("ghost@example.com")).toEqual([]);
  });

  it("a request waits with the company that owns the code, and with nobody else", async () => {
    const code = (await getJoinCode(router, A.admin))!;
    expect((await ask(code, "staff")).company).toBe("Join Alpha");
    expect(await pending(A)).toEqual(["sana@example.com"]);
    expect(await pending(B)).toEqual([]);
    expect(await indexed("SANA@example.com")).toEqual([{ company: "Join Alpha" }]);
  });

  it("asking again updates the one request instead of piling up", async () => {
    const code = (await getJoinCode(router, A.admin))!;
    await ask(code, "staff", { full_name: "Sana M. Malik", note: "Fleet supervisor, Lahore depot" });
    const list = await listJoinRequests(router, A.admin);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ full_name: "Sana M. Malik", note: "Fleet supervisor, Lahore depot", kind: "staff" });
  });

  it("a company can only hold so many waiting requests, but a person already waiting may still update theirs", async () => {
    const code = (await getJoinCode(router, B.admin))!;
    for (let i = 0; i < MAX_WAITING; i++) await ask(code, "staff", { email: `bulk${i}@example.com` });
    await expect(ask(code, "staff", { email: "onetoomany@example.com" })).rejects.toThrow(/too many requests/);
    await expect(ask(code, "staff", { email: "bulk3@example.com", note: "still here" })).resolves.toMatchObject({ company: "Join Bravo" });
    await control.transaction(async (q) => { await q.query("delete from public.join_requests where tenant_id = $1", [B.tenantId]); await q.query("delete from public.join_index where tenant_id = $1", [B.tenantId]); });
  });

  it("a company whose trial has ended does not take new requests", async () => {
    const C = await signUp(3, "Join Charlie");
    const code = (await setJoinCode(router, C.admin, "on"))!;
    expect((await findTenantByJoinCode(router, code))?.id).toBe(C.tenantId);
    await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.org_billing set trial_ends_at = now() - interval '30 days' where tenant_id = $1", [C.tenantId]); });
    expect(await findTenantByJoinCode(router, code)).toBeNull();
    await expect(ask(code, "staff", { email: "late@example.com" })).rejects.toThrow(/not recognised/);
  });
});

describe("the decision", () => {
  it("approving a staff request makes an invitation; accepting it after confirming the email makes the person a member with the chosen role", async () => {
    const [req] = await listJoinRequests(router, A.admin);
    await approveJoinRequest(router, A.admin, req.id, { role: "fleet_manager", vehicle_scope: "all", employee_no: "J-1" });
    expect(await pending(A)).toEqual([]);
    expect(await indexed("sana@example.com")).toEqual([]);                                            // no longer "waiting"
    const waitingInvites = await ad.pendingInvitationsFor(router, { email: "sana@example.com", emailConfirmed: true });
    expect(waitingInvites).toHaveLength(1);
    expect(waitingInvites[0]).toMatchObject({ workspace: "Join Alpha" });
    expect(await ad.pendingInvitationsFor(router, { email: "sana@example.com", emailConfirmed: false })).toEqual([]);   // the address must be confirmed
    await expect(ad.acceptInvitation(router, { id: waitingInvites[0].id }, { id: U(60), email: "other@example.com", emailConfirmed: true })).rejects.toBeInstanceOf(UserError);
    await ad.acceptInvitation(router, { id: waitingInvites[0].id }, { id: U(60), email: "sana@example.com", emailConfirmed: true });
    expect(await resolveMembership(router, U(60), A.slug)).toMatchObject({ role: "fleet_manager" });
    expect(await resolveMembership(router, U(60), B.slug)).toBeNull();
    expect((await listWorkspaces(router, U(60))).map((w) => w.slug)).toEqual([A.slug]);
  });

  it("a staff request cannot be approved as a workshop role", async () => {
    const code = (await getJoinCode(router, A.admin))!;
    await ask(code, "staff", { email: "novendor@example.com", full_name: "No Vendor" });
    const req = (await listJoinRequests(router, A.admin)).find((r) => r.email === "novendor@example.com")!;
    await expect(approveJoinRequest(router, A.admin, req.id, { role: "vendor" })).rejects.toBeInstanceOf(UserError);
    expect(await pending(A)).toContain("novendor@example.com");
    await declineJoinRequest(router, A.admin, req.id, "Not one of ours");
  });

  it("approving a workshop makes its workshop record and a workshop invitation; once accepted the login is that workshop's", async () => {
    const code = (await getJoinCode(router, A.admin))!;
    await ask(code, "workshop", { email: "speedy@example.com", full_name: "Imran Ali", workshop_name: "Speedy Auto Works", phone: "0300 1234567" });
    const req = (await listJoinRequests(router, A.admin)).find((r) => r.email === "speedy@example.com")!;
    expect(req).toMatchObject({ kind: "workshop", workshop_name: "Speedy Auto Works" });
    await approveJoinRequest(router, A.admin, req.id, { employee_no: "J-2" });
    const shops = (await master.listVendors(router, A.admin)).filter((v) => v.name === "Speedy Auto Works");
    expect(shops).toHaveLength(1);
    const [inv] = await ad.pendingInvitationsFor(router, { email: "speedy@example.com", emailConfirmed: true });
    await ad.acceptInvitation(router, { id: inv.id }, { id: U(61), email: "speedy@example.com", emailConfirmed: true });
    expect(await resolveMembership(router, U(61), A.slug)).toMatchObject({ role: "vendor" });
    const linked = (await ad.listMembers(router, A.admin)).find((p) => p.user_id === U(61));
    expect(linked?.vendor_name).toBe("Speedy Auto Works");
  });

  it("declining records it, removes the waiting notice, and the person may ask again later", async () => {
    const code = (await getJoinCode(router, A.admin))!;
    await ask(code, "staff", { email: "retry@example.com", full_name: "Retry Person" });
    expect(await indexed("retry@example.com")).toEqual([{ company: "Join Alpha" }]);
    const req = (await listJoinRequests(router, A.admin)).find((r) => r.email === "retry@example.com")!;
    await declineJoinRequest(router, A.admin, req.id, "Please use your work email");
    expect(await pending(A)).not.toContain("retry@example.com");
    expect(await indexed("retry@example.com")).toEqual([]);
    await expect(declineJoinRequest(router, A.admin, req.id)).rejects.toThrow(/no longer waiting/);
    await ask(code, "staff", { email: "retry@example.com", full_name: "Retry Person" });
    expect(await pending(A)).toContain("retry@example.com");
  });

  it("only people who manage users may decide", async () => {
    const req = (await listJoinRequests(router, A.admin))[0];
    for (const role of ["requester", "finance", "fleet_manager", "vendor"]) {
      await expect(approveJoinRequest(router, member(A, role, 41), req.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(declineJoinRequest(router, member(A, role, 41), req.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("one company never reaches another's requests", () => {
  it("B's administrator cannot approve or decline A's request, and A's data never shows in B's list", async () => {
    const code = (await getJoinCode(router, A.admin))!;
    await ask(code, "staff", { email: "alphaonly@example.com", full_name: "Alpha Only", note: "alpha-secret-note" });
    const req = (await listJoinRequests(router, A.admin)).find((r) => r.email === "alphaonly@example.com")!;
    await expect(approveJoinRequest(router, B.admin, req.id, { role: "requester" })).rejects.toThrow(/no longer waiting/);
    await expect(declineJoinRequest(router, B.admin, req.id)).rejects.toThrow(/no longer waiting/);
    const seenByB = JSON.stringify(await listJoinRequests(router, B.admin));
    expect(seenByB).not.toContain("alphaonly@example.com");
    expect(seenByB).not.toContain("alpha-secret-note");
    expect(await pending(A)).toContain("alphaonly@example.com");                                      // still waiting, untouched
    expect((await ad.listInvitations(router, B.admin)).map((i) => i.email)).not.toContain("alphaonly@example.com");
  });

  it("a code is checked against the company that owns it: a request made with A's code never lands in B", async () => {
    const before = (await listJoinRequests(router, B.admin)).length;
    await ask((await getJoinCode(router, A.admin))!, "staff", { email: "mixup@example.com" });
    expect((await listJoinRequests(router, B.admin)).length).toBe(before);
    expect((await indexed("mixup@example.com")).map((x) => x.company)).toEqual(["Join Alpha"]);
  });
});

describe("telling the administrator", () => {
  const notices = async (m: Membership) => (await jc.listNotifications(router, m)).filter((n) => n.kind === "join.requested");

  it("a new request puts a notice in front of everyone who can manage users, and no one else", async () => {
    const code = (await getJoinCode(router, A.admin))!;
    const before = (await notices(A.admin)).length;
    await ask(code, "staff", { email: "notice1@example.com", full_name: "Notice One" });
    const mine = await notices(A.admin);
    expect(mine).toHaveLength(before + 1);
    expect(mine[0].payload).toMatchObject({ text: "Notice One asked to join." });
    expect(mine[0].payload.request_id).toBeTruthy();
    // the fleet manager made earlier (a member of this company without admin.users) gets nothing
    expect(await notices(member(A, "fleet_manager", 60))).toEqual([]);
  });

  it("a workshop's notice says so, and asking again to change details does not repeat it", async () => {
    const code = (await getJoinCode(router, A.admin))!;
    const before = (await notices(A.admin)).length;
    await ask(code, "workshop", { email: "notice2@example.com", full_name: "Imran", workshop_name: "Quick Fix Garage" });
    // asking again changes the details and has to be confirmed again; until it is, the administrator is not told a second time
    await submitJoinRequest(router, "workshop", parseJoin(form(code, { email: "notice2@example.com", full_name: "Imran", workshop_name: "Quick Fix Garage", note: "added a note" }), "workshop"), fakeSend);
    const list = await notices(A.admin);
    expect(list).toHaveLength(before + 1);
    expect(list[0].payload.text).toBe("Quick Fix Garage asked to join as a workshop.");
  });

  it("another company's administrator is not told, and a request that fails to notify is still saved", async () => {
    expect((await notices(B.admin)).map((n) => String(n.payload.text))).not.toContain("Notice One asked to join.");
    // break only this company's notifications table: the request must still be recorded
    const C = await signUp(4, "Join Delta");
    const code = (await setJoinCode(router, C.admin, "on"))!;
    await control.transaction(async (q) => { await q.query(`alter table "${C.schema}".notifications rename to notifications_gone`); });
    await expect(ask(code, "staff", { email: "stillsaved@example.com" })).resolves.toMatchObject({ company: "Join Delta" });
    expect(await pending(C)).toEqual(["stillsaved@example.com"]);
    await control.transaction(async (q) => { await q.query(`alter table "${C.schema}".notifications_gone rename to notifications`); });
  });

  it("the sidebar count is the number waiting, for people who manage users only, and drops when decided", async () => {
    const waiting = (await listJoinRequests(router, A.admin)).length;
    expect(waiting).toBeGreaterThanOrEqual(2);
    expect((await getNavCounts(router, A.admin)).joins).toBe(waiting);
    expect((await getNavCounts(router, member(A, "fleet_manager", 60))).joins).toBe(0);
    expect((await getNavCounts(router, B.admin)).joins).toBe((await listJoinRequests(router, B.admin)).length);
    const first = (await listJoinRequests(router, A.admin))[0];
    await declineJoinRequest(router, A.admin, first.id);
    expect((await getNavCounts(router, A.admin)).joins).toBe(waiting - 1);
  });
});
