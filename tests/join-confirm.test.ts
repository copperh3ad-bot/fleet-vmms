import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { routingDriver, type RoutingDriver } from "@/lib/db/router";
import type { Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import * as ctl from "@/lib/control/service";
import { advanceProvisioning, type ProvisionDeps } from "@/lib/orgs/provision";
import { claimSignup, parseSignup, recordSignup } from "@/lib/orgs/signup";
import { findTenantByToken } from "@/lib/orgs";
import { hashToken } from "@/lib/odometer/link";
import { withOrgPlatform, withTenant } from "@/lib/db/tenant";
import {
  OTP_MAX_SENDS, OTP_MAX_TRIES, approveJoinRequest, confirmJoinWithCode, declineJoinRequest, joinCodeState, listJoinRequests, parseJoin, purgeUnconfirmedJoinRequests,
  resendJoinCode, setJoinCode, submitJoinRequest,
} from "@/lib/orgs/join";
import { newControl, platformMigrations, stripExt, tenantMigrations, testDriver } from "./helpers";
import type { Driver } from "@/lib/db/types";

// ADR-055: a request to join is confirmed with a code sent to the person's own WhatsApp before the administrator sees it, and carries a valid driving licence.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
const unavailable = () => { throw new Error("not used for shared organizations"); };
let control: Driver, router: RoutingDriver, deps: ProvisionDeps;
let admin: Membership, code: string, schema: string, tenantId: string;

const KEYS = ["WHATSAPP_OTP_TEMPLATE", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN"];
const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const sent: { to: string; code: string; company: string }[] = [];
const fakeSend = (async (to: string, m: { code: string; company: string }) => { sent.push({ to, code: m.code, company: m.company }); }) as never;
const form = (over: Record<string, unknown> = {}) => ({ code, full_name: "Sana Malik", email: "sana@example.com", phone: "0300 1234567", licence_no: "LHR-1234567", licence_expires_on: "2099-12-31", licence_type: "full", note: "", terms: "on", ...over });
const ask = (over: Record<string, unknown> = {}) => submitJoinRequest(router, "staff", parseJoin(form(over), "staff"), fakeSend);
const lastCode = () => sent[sent.length - 1].code;
const askAndConfirm = async (over: Record<string, unknown> = {}) => { const r = await ask(over); await confirmJoinWithCode(router, r.ref, lastCode()); return r; };
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withOrgPlatform(router, schema, fn);
const row = (email: string) => raw(async (q) => (await q.query<Record<string, string | null>>("select status, phone, licence_type, licence_no, licence_expires_on::text, phone_confirmed_at::text, confirm_token_hash, otp_hash, otp_attempts::text, otp_sends::text from public.join_requests where lower(email) = $1", [email])).rows[0]);
const emp = (no: string) => withTenant(router, admin, async (q) => (await q.query<Record<string, string | null>>(
  "select e.full_name, l.licence_no, l.licence_type, l.expires_on::text from employees e left join driver_licences l on l.employee_id = e.id where lower(e.employee_no) = lower($1)", [no])).rows[0]);
const err = async (p: Promise<unknown>) => (await p.then(() => null, (e) => e)) as UserError | null;

beforeAll(async () => {
  Object.assign(process.env, { WHATSAPP_OTP_TEMPLATE: "fleetotg_code", WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "stand-in" });
  control = process.env.TEST_DATABASE_URL ? await testDriver() : await newControl();
  router = routingDriver({ control, makeDriver: () => { throw new Error("no dedicated databases here"); }, decrypt: unavailable });
  deps = { control, openDb: () => { throw new Error("none"); }, platformMigrations: platformMigrations(), tenantMigrations: tenantMigrations(), transform: stripExt, provider: { name: "none", async create() { return unavailable(); }, async destroy() { return unavailable(); } }, box: { encrypt: unavailable, decrypt: unavailable } };
  await recordSignup(control, parseSignup({ org_name: "Confirm Co", contact_name: "Owner", email: "confirmowner@example.com", terms: "on" }));
  const t = (await claimSignup(control, { id: U(1), email: "confirmowner@example.com", emailConfirmed: true }, { kind: "shared" }))!;
  expect((await advanceProvisioning(deps, t.tenantId)).state).toBe("ready");
  schema = t.schema; tenantId = t.tenantId;
  admin = { tenantId, schema, userId: U(1), role: "tenant_admin", vehicleScope: "all", tenantName: "Confirm Co" };
  code = (await setJoinCode(router, admin, "on"))!;
});
afterAll(() => { for (const k of KEYS) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } });

describe("a request is not seen until the person types the code sent to their phone", () => {
  it("is saved unconfirmed and hidden, and a 6-digit code goes to the number they typed, from the app", async () => {
    const r = await ask();
    expect(r).toMatchObject({ company: "Confirm Co", phoneEnds: "4567" });
    expect(sent.at(-1)).toMatchObject({ to: "+923001234567", company: "Confirm Co" });
    expect(lastCode()).toMatch(/^\d{6}$/);
    expect(await row("sana@example.com")).toMatchObject({ status: "unconfirmed", phone: "+923001234567", phone_confirmed_at: null, otp_sends: "1" });
    expect(await listJoinRequests(router, admin)).toEqual([]);          // the administrator sees nothing yet
  });

  it("keeps only hashes: neither the code nor the browser reference is stored", async () => {
    const c = lastCode();
    const r = await row("sana@example.com");
    expect(JSON.stringify(r)).not.toContain(c);
    expect(r.otp_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.confirm_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the page can say what is awaited without changing anything, and a wrong code is refused and counted", async () => {
    const r = await ask({ email: "wrong@example.com" });
    expect(await joinCodeState(router, r.ref)).toEqual({ company: "Confirm Co", phoneEnds: "4567" });
    const good = lastCode();
    const bad = good === "000000" ? "111111" : "000000";
    const e = await err(confirmJoinWithCode(router, r.ref, bad));
    expect(e).toBeInstanceOf(UserError);
    expect(e!.message).toMatch(/not right/);
    expect((await row("wrong@example.com")).otp_attempts).toBe("1");
    expect((await row("wrong@example.com")).status).toBe("unconfirmed");
    expect((await err(confirmJoinWithCode(router, r.ref, "12")))!.message).toMatch(/6-digit/);          // not six digits: not counted
    expect((await row("wrong@example.com")).otp_attempts).toBe("1");
  });

  it("the right code makes it visible to the administrator, once", async () => {
    const r = await ask({ email: "right@example.com" });
    expect(await confirmJoinWithCode(router, r.ref, ` ${lastCode().slice(0, 3)} ${lastCode().slice(3)} `)).toEqual({ company: "Confirm Co" });          // spaces are ignored
    const req = (await listJoinRequests(router, admin)).find((x) => x.email === "right@example.com")!;
    expect(req).toMatchObject({ phone_confirmed: true, licence: { type: "full", ends: "4567", expires_on: "2099-12-31" } });
    expect(await joinCodeState(router, r.ref)).toBeNull();
    expect((await err(confirmJoinWithCode(router, r.ref, lastCode())))!.message).toMatch(/not waiting/);          // used up
    expect(await findTenantByToken(router, "joinconfirm", hashToken(r.ref))).toBeNull();
  });

  it("five wrong tries end the code, even the right one afterwards; a new code starts again", async () => {
    const r = await ask({ email: "tries@example.com" });
    const good = lastCode();
    const bad = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < OTP_MAX_TRIES; i++) expect((await err(confirmJoinWithCode(router, r.ref, bad)))!.message).toMatch(/not right/);
    expect((await err(confirmJoinWithCode(router, r.ref, good)))!.message).toMatch(/Too many wrong codes/);
    expect((await row("tries@example.com")).status).toBe("unconfirmed");
    await raw((q) => q.query("update public.join_requests set otp_sent_at = now() - interval '2 minutes' where lower(email) = 'tries@example.com'"));
    await resendJoinCode(router, r.ref, fakeSend);
    expect((await row("tries@example.com")).otp_attempts).toBe("0");
    expect(await confirmJoinWithCode(router, r.ref, lastCode())).toEqual({ company: "Confirm Co" });
  });

  it("a code that has run out is refused", async () => {
    const r = await ask({ email: "late@example.com" });
    await raw((q) => q.query("update public.join_requests set otp_expires_at = now() - interval '1 minute' where lower(email) = 'late@example.com'"));
    expect((await err(confirmJoinWithCode(router, r.ref, lastCode())))!.message).toMatch(/run out/);
  });

  it("a new code can be asked for once a minute, at most five in all, and the old code stops working", async () => {
    const r = await ask({ email: "resend@example.com" });
    const first = lastCode();
    expect((await err(resendJoinCode(router, r.ref, fakeSend)))!.message).toMatch(/a moment ago/);
    for (let i = 1; i < OTP_MAX_SENDS; i++) {
      await raw((q) => q.query("update public.join_requests set otp_sent_at = now() - interval '2 minutes' where lower(email) = 'resend@example.com'"));
      await resendJoinCode(router, r.ref, fakeSend);
    }
    await raw((q) => q.query("update public.join_requests set otp_sent_at = now() - interval '2 minutes' where lower(email) = 'resend@example.com'"));
    expect((await err(resendJoinCode(router, r.ref, fakeSend)))!.message).toMatch(/Too many codes/);
    if (first !== lastCode()) expect((await err(confirmJoinWithCode(router, r.ref, first)))!.message).toMatch(/not right/);
    expect(await confirmJoinWithCode(router, r.ref, lastCode())).toEqual({ company: "Confirm Co" });
  });

  it("never matches a reference that is not ours, has the wrong shape, or whose request has waited too long", async () => {
    expect(await joinCodeState(router, "a".repeat(43))).toBeNull();
    expect(await joinCodeState(router, "short")).toBeNull();
    expect((await err(confirmJoinWithCode(router, "../../x", "123456")))!.message).toMatch(/not waiting/);
    const r = await ask({ email: "old@example.com" });
    await raw((q) => q.query("update public.join_requests set confirm_expires_at = now() - interval '1 minute' where lower(email) = 'old@example.com'"));
    expect(await joinCodeState(router, r.ref)).toBeNull();
    expect((await err(confirmJoinWithCode(router, r.ref, lastCode())))!.message).toMatch(/not waiting/);
  });

  it("asking again replaces the request: the old reference and code stop working", async () => {
    const first = await ask({ email: "again@example.com" });
    const firstCode = lastCode();
    const second = await ask({ email: "again@example.com", licence_no: "NEW-7654321" });
    expect(second.ref).not.toBe(first.ref);
    expect(await joinCodeState(router, first.ref)).toBeNull();
    expect((await err(confirmJoinWithCode(router, first.ref, firstCode)))!.message).toMatch(/not waiting/);
    await confirmJoinWithCode(router, second.ref, lastCode());
    expect((await listJoinRequests(router, admin)).find((r) => r.email === "again@example.com")?.licence?.ends).toBe("4321");
  });

  it("a code that cannot be sent leaves no request and no licence number behind", async () => {
    const failing = (async () => { throw new Error("whatsapp failed: 400 (code 131049)"); }) as never;
    const e = await err(submitJoinRequest(router, "staff", parseJoin(form({ email: "nosend@example.com" }), "staff"), failing));
    expect(e).toBeInstanceOf(UserError);
    expect(e!.fields?.phone).toBeTruthy();
    expect(await row("nosend@example.com")).toBeUndefined();
  });

  it("is refused outright when the WhatsApp code template is not set up, so nothing unconfirmed can get in", async () => {
    delete process.env.WHATSAPP_OTP_TEMPLATE;
    expect((await err(ask({ email: "nowa@example.com" })))!.message).toMatch(/needs a confirmation on WhatsApp/);
    expect(await row("nowa@example.com")).toBeUndefined();
    process.env.WHATSAPP_OTP_TEMPLATE = "fleetotg_code";
  });

  it("removes a request nobody confirmed, with its licence number, a day after it could no longer be", async () => {
    await ask({ email: "ghost@example.com" });
    await raw((q) => q.query("update public.join_requests set confirm_expires_at = now() - interval '2 days' where lower(email) = 'ghost@example.com'"));
    expect(await purgeUnconfirmedJoinRequests(router)).toBeGreaterThanOrEqual(1);
    expect(await row("ghost@example.com")).toBeUndefined();
  });
});

describe("the driving licence", () => {
  it("is required, and an expired one is refused, each with its own message", async () => {
    expect(() => parseJoin(form({ licence_no: "" }), "staff")).toThrow(UserError);
    expect(() => parseJoin(form({ licence_expires_on: "" }), "staff")).toThrow(UserError);
    expect(() => parseJoin(form({ phone: "" }), "staff")).toThrow(UserError);
    const e = await err(ask({ email: "expired@example.com", licence_expires_on: "2020-01-01" }));
    expect(e!.fields?.licence_expires_on).toMatch(/expired/);
    expect(await row("expired@example.com")).toBeUndefined();
  });

  it("a learner's permit is refused unless the company switched learner permits on in Settings", async () => {
    const e = await err(ask({ email: "learner@example.com", licence_type: "learner" }));
    expect(e!.fields?.licence_type).toMatch(/full driving licences only/);
    await ctl.saveSettings(router, admin, { allow_learner_licence: "1" });
    await ask({ email: "learner@example.com", licence_type: "learner" });
    expect(await row("learner@example.com")).toMatchObject({ status: "unconfirmed", licence_type: "learner" });
    await ctl.saveSettings(router, admin, { allow_learner_licence: "0" });
  });

  it("the audit log never holds the licence number whole, nor either hash", async () => {
    const audit = await control.transaction(async (q) => { await q.query("set local search_path = public"); return JSON.stringify((await q.query("select old_data, new_data from public.platform_audit_log where table_name = 'join_requests'")).rows); });
    expect(audit).toContain("…4567");
    expect(audit).not.toContain("LHR-1234567");
    expect(audit).not.toContain("confirm_token_hash");
    expect(audit).not.toContain("otp_hash");
  });
});

describe("the administrator's decision", () => {
  it("approving saves the licence as the employee's, makes the employee if needed, and drops the number from the request", async () => {
    const req = (await listJoinRequests(router, admin)).find((r) => r.email === "right@example.com")!;
    await approveJoinRequest(router, admin, req.id, { role: "requester", employee_no: "J-100" });
    expect(await emp("J-100")).toMatchObject({ full_name: req.full_name, licence_no: "LHR-1234567", licence_type: "full", expires_on: "2099-12-31" });
    expect((await row("right@example.com")).licence_no).toBeNull();
    expect((await row("right@example.com")).status).toBe("approved");
  });

  it("is refused when the licence has expired since, or learner permits were switched off since", async () => {
    await askAndConfirm({ email: "lapsed@example.com" });
    await raw((q) => q.query("update public.join_requests set licence_expires_on = '2020-01-01' where lower(email) = 'lapsed@example.com'"));
    const req = (await listJoinRequests(router, admin)).find((r) => r.email === "lapsed@example.com")!;
    await expect(approveJoinRequest(router, admin, req.id, { employee_no: "J-101" })).rejects.toThrow(/expired/);
    expect(await emp("J-101")).toBeUndefined();

    await ctl.saveSettings(router, admin, { allow_learner_licence: "1" });
    await askAndConfirm({ email: "lp@example.com", licence_type: "learner" });
    await ctl.saveSettings(router, admin, { allow_learner_licence: "0" });
    const lp = (await listJoinRequests(router, admin)).find((r) => r.email === "lp@example.com")!;
    await expect(approveJoinRequest(router, admin, lp.id, { employee_no: "J-102" })).rejects.toThrow(/full driving licences only/);
  });

  it("a request made before licences were asked for cannot be approved without one", async () => {
    await raw((q) => q.query("insert into public.join_requests(tenant_id, kind, full_name, email, status) values ($1, 'staff', 'Old Timer', 'oldtimer@example.com', 'pending')", [tenantId]));
    const req = (await listJoinRequests(router, admin)).find((r) => r.email === "oldtimer@example.com")!;
    expect(req.licence).toBeNull();
    await expect(approveJoinRequest(router, admin, req.id, { employee_no: "J-103" })).rejects.toThrow(/no driving licence/);
    await declineJoinRequest(router, admin, req.id, "No licence");
  });

  it("declining removes the licence number too", async () => {
    await askAndConfirm({ email: "decline@example.com" });
    const req = (await listJoinRequests(router, admin)).find((r) => r.email === "decline@example.com")!;
    await declineJoinRequest(router, admin, req.id, "Not one of ours");
    expect((await row("decline@example.com")).licence_no).toBeNull();
  });
});
