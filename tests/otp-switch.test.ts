import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { routingDriver, type RoutingDriver } from "@/lib/db/router";
import type { Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import * as ctl from "@/lib/control/service";
import { advanceProvisioning, type ProvisionDeps } from "@/lib/orgs/provision";
import { claimSignup, parseSignup, recordSignup } from "@/lib/orgs/signup";
import { withOrgPlatform } from "@/lib/db/tenant";
import { listJoinRequests, parseJoin, setJoinCode, submitJoinRequest } from "@/lib/orgs/join";
import { checkPlatformSetting } from "@/lib/billing/settings";
import { otpChecksOn, otpOffValue } from "@/lib/otp-switch";
import { newControl, platformMigrations, stripExt, tenantMigrations, testDriver } from "./helpers";
import type { Driver } from "@/lib/db/types";

// ADR-076: the beta switch. `otp_checks = off` (Admin > Settings) stops the WhatsApp codes on joining and on invitations; empty or "on" asks for them as always.
void ctl;
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
const unavailable = () => { throw new Error("not used for shared organizations"); };
let control: Driver, router: RoutingDriver, deps: ProvisionDeps;
let admin: Membership, code: string, schema: string;

const KEYS = ["WHATSAPP_OTP_TEMPLATE", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN"];
const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const sent: { to: string; code: string }[] = [];
const fakeSend = (async (to: string, m: { code: string }) => { sent.push({ to, code: m.code }); }) as never;
const form = (over: Record<string, unknown> = {}) => ({ code, full_name: "Sana Malik", email: "sana@example.com", phone: "+92 300 1234567", licence_no: "LHR-1234567", licence_expires_on: "2099-12-31", licence_type: "full", note: "", terms: "on", ...over });
const ask = (over: Record<string, unknown> = {}) => submitJoinRequest(router, "staff", parseJoin(form(over), "staff"), fakeSend);
const setOtp = (value: string | null) => control.transaction(async (q) => {
  await q.query("set local search_path = public");
  if (value === null) await q.query("delete from public.platform_settings where key = 'otp_checks'");
  else await q.query("insert into public.platform_settings(key, value) values ('otp_checks', $1) on conflict (key) do update set value = excluded.value", [value]);
});
const row = (email: string) => withOrgPlatform(router, schema, async (q) => (await q.query<Record<string, string | null>>("select status, phone_confirmed_at::text, confirm_token_hash, otp_hash from public.join_requests where lower(email) = $1", [email])).rows[0]);

beforeAll(async () => {
  Object.assign(process.env, { WHATSAPP_OTP_TEMPLATE: "fleetotg_code", WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "stand-in" });
  control = process.env.TEST_DATABASE_URL ? await testDriver() : await newControl();
  router = routingDriver({ control, makeDriver: () => { throw new Error("no dedicated databases here"); }, decrypt: unavailable });
  deps = { control, openDb: () => { throw new Error("none"); }, platformMigrations: platformMigrations(), tenantMigrations: tenantMigrations(), transform: stripExt, provider: { name: "none", async create() { return unavailable(); } } } as unknown as ProvisionDeps;
  await recordSignup(control, parseSignup({ org_name: "Switch Co", contact_name: "Owner", email: "switchowner@example.com", terms: "on" }));
  const t = (await claimSignup(control, { id: U(1), email: "switchowner@example.com", emailConfirmed: true }, { kind: "shared" }))!;
  expect((await advanceProvisioning(deps, t.tenantId)).state).toBe("ready");
  schema = t.schema;
  admin = { tenantId: t.tenantId, schema, userId: U(1), role: "tenant_admin", vehicleScope: "all", tenantName: "Switch Co" };
  code = (await setJoinCode(router, admin, "on"))!;
});
afterAll(() => { for (const k of KEYS) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } });

describe("the setting", () => {
  it("accepts on, off or empty and nothing else", () => {
    expect(checkPlatformSetting("otp_checks", "off")).toBe("off");
    expect(checkPlatformSetting("otp_checks", "on")).toBe("on");
    expect(checkPlatformSetting("otp_checks", "")).toBe("");
    expect(() => checkPlatformSetting("otp_checks", "maybe")).toThrow(UserError);
  });

  it("only the word off switches the codes off; unset, on, or anything odd keeps them on", async () => {
    expect([otpOffValue("off"), otpOffValue(" OFF "), otpOffValue("on"), otpOffValue(""), otpOffValue(undefined), otpOffValue("0")]).toEqual([true, true, false, false, false, false]);
    await setOtp(null); expect(await otpChecksOn(control)).toBe(true);
    await setOtp("off"); expect(await otpChecksOn(control)).toBe(false);
    await setOtp("on"); expect(await otpChecksOn(control)).toBe(true);
  });
});

describe("joining with a company code", () => {
  it("with the codes on, nothing changes: the request is hidden until the code is typed", async () => {
    await setOtp("on");
    sent.length = 0;
    const r = await ask({ email: "on@example.com" });
    expect(r.confirmed).toBeUndefined();
    expect(r.ref).not.toBe("");
    expect(sent).toHaveLength(1);
    expect(await row("on@example.com")).toMatchObject({ status: "unconfirmed", phone_confirmed_at: null });
    expect((await listJoinRequests(router, admin)).some((x) => x.email === "on@example.com")).toBe(false);
  });

  it("with the codes off, no code is sent and the request is straight with the administrator", async () => {
    await setOtp("off");
    sent.length = 0;
    const r = await ask({ email: "off@example.com" });
    expect(r).toMatchObject({ company: "Switch Co", phoneEnds: "4567", ref: "", confirmed: true });
    expect(sent).toHaveLength(0);
    expect(await row("off@example.com")).toMatchObject({ status: "pending", confirm_token_hash: null, otp_hash: null });
    expect((await row("off@example.com")).phone_confirmed_at).not.toBeNull();
    expect((await listJoinRequests(router, admin)).some((x) => x.email === "off@example.com")).toBe(true);
  });

  it("with the codes off, joining works even where WhatsApp is not set up, and asking again replaces the request", async () => {
    await setOtp("off");
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    try {
      await ask({ email: "again@example.com", full_name: "First Name" });
      await ask({ email: "again@example.com", full_name: "Second Name" });
      const mine = (await listJoinRequests(router, admin)).filter((x) => x.email === "again@example.com");
      expect(mine).toHaveLength(1);
      expect(mine[0].full_name).toBe("Second Name");
    } finally { Object.assign(process.env, saved); }
  });

  it("with the codes on again, joining is refused when WhatsApp is not set up, as before", async () => {
    await setOtp("on");
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    try { await expect(ask({ email: "closed@example.com" })).rejects.toThrow(/needs a confirmation on WhatsApp/); }
    finally { Object.assign(process.env, saved); }
  });

  it("the company code and the licence are still checked with the codes off", async () => {
    await setOtp("off");
    await expect(ask({ email: "bad@example.com", code: code.split("").reverse().join("") === code ? code.slice(1) + code[0] : code.split("").reverse().join("") })).rejects.toThrow(/not recognised/i);
    await expect(ask({ email: "lic@example.com", licence_expires_on: "2001-01-01" })).rejects.toBeInstanceOf(UserError);
    await setOtp("on");
  });
});
