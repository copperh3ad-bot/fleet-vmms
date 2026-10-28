// The one-time code on an invitation (ADR-041): off until texting is set up; then a link alone cannot make an account. The code is texted to the invitation's phone, only
// its hash is stored, it runs out, five wrong tries end it, sends are limited, and the full phone number never reaches the invitation page.
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inviteUser, previewInvitation } from "@/lib/admin/service";
import { withOrgPlatform } from "@/lib/db/tenant";
import { OTP_MAX_SENDS, OTP_MAX_TRIES, checkInviteCode, maskPhone, sendInviteCode } from "@/lib/admin/invite-otp";
import { SmsNotConfigured, sendSms, smsConfigured } from "@/lib/sms";
import { harness, type Org } from "./billing-harness";

let h: Awaited<ReturnType<typeof harness>>;
let org: Org;
let out: string;
const saved = { f: process.env.SMS_FILE, a: process.env.ALLOW_FILE_MAILER, sid: process.env.TWILIO_ACCOUNT_SID, tok: process.env.TWILIO_AUTH_TOKEN, from: process.env.TWILIO_FROM };
let seq = 0;
const invite = (over: Record<string, unknown> = {}) => inviteUser(h.router, org.admin, { full_name: "Sana Malik", employee_no: `OT-${++seq}`, email: `otp${seq}@example.com`, phone: "0300 1234567", role: "requester", ...over });
const texts = () => (existsSync(out) ? readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; body: string }) : []);
const lastCode = () => texts().at(-1)!.body.match(/\b(\d{6})\b/)![1];
const inOrg = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withOrgPlatform(h.router, org.schema, fn);
const setSeconds = (id: string, seconds: number) => inOrg((q) => q.query("update public.invitations set otp_sent_at = now() - ($2 || ' seconds')::interval where id = $1", [id, String(seconds)]));

beforeAll(async () => {
  h = await harness();
  org = await h.org("Otp Co");
  out = join(mkdtempSync(join(tmpdir(), "sms-")), "out.jsonl");
});
afterAll(() => { for (const [k, v] of [["SMS_FILE", saved.f], ["ALLOW_FILE_MAILER", saved.a], ["TWILIO_ACCOUNT_SID", saved.sid], ["TWILIO_AUTH_TOKEN", saved.tok], ["TWILIO_FROM", saved.from]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

describe("texting is off until it is set up", () => {
  it("asks for no code, and sending refuses", async () => {
    delete process.env.SMS_FILE; delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; delete process.env.TWILIO_FROM;
    expect(smsConfigured()).toBe(false);
    const inv = await invite();
    const p = await previewInvitation(h.router, inv.token);
    expect(p).toMatchObject({ codeRequired: false, phoneHint: null });
    await expect(sendInviteCode(h.router, inv.token, "1.1.1.1")).rejects.toThrow(/not switched on/);
    await checkInviteCode(h.router, inv.token, "");                       // nothing to check, so it passes
    await expect(sendSms("+923001234567", "x")).rejects.toBeInstanceOf(SmsNotConfigured);
  });
});

describe("with texting on", () => {
  beforeAll(() => { process.env.SMS_FILE = out; process.env.ALLOW_FILE_MAILER = "1"; });

  it("the invitation page is told a code is needed and where it goes, never the whole number", async () => {
    const inv = await invite();
    const p = await previewInvitation(h.router, inv.token);
    expect(p).toMatchObject({ codeRequired: true, phoneHint: "ending 4567" });
    expect(JSON.stringify(p)).not.toContain("1234567");
    expect(maskPhone("+923001234567")).toBe("ending 4567");
  });

  it("texts a 6-digit code to the invitation's number, and the right code passes", async () => {
    const inv = await invite();
    expect(await sendInviteCode(h.router, inv.token, "2.2.2.2")).toEqual({ sentTo: "ending 4567" });
    const t = texts().at(-1)!;
    expect(t.to).toBe("+923001234567");
    expect(t.body).toMatch(/^Fleet OTG code \d{6} to join Otp Co\./);
    await checkInviteCode(h.router, inv.token, lastCode());
    await checkInviteCode(h.router, inv.token, ` ${lastCode().slice(0, 3)} ${lastCode().slice(3)} `);   // spaces are ignored
  });

  it("stores only a hash of the code", async () => {
    const inv = await invite();
    await sendInviteCode(h.router, inv.token, "3.3.3.3");
    const row = await inOrg(async (q) => (await q.query<Record<string, unknown>>("select otp_hash, otp_expires_at from public.invitations where id = $1", [inv.id])).rows[0]);
    expect(String(row.otp_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(lastCode());
  });

  it("refuses a missing, malformed or wrong code, and five wrong tries end the code", async () => {
    const inv = await invite();
    await expect(checkInviteCode(h.router, inv.token, "123456")).rejects.toThrow(/Ask for a code first/);
    await sendInviteCode(h.router, inv.token, "4.4.4.4");
    const right = lastCode(), wrong = right === "000000" ? "111111" : "000000";
    await expect(checkInviteCode(h.router, inv.token, "12")).rejects.toThrow(/6-digit code/);
    for (let i = 0; i < OTP_MAX_TRIES; i++) await expect(checkInviteCode(h.router, inv.token, wrong)).rejects.toThrow(/not right/);
    await expect(checkInviteCode(h.router, inv.token, right)).rejects.toThrow(/Too many wrong codes/);   // even the right one, now
    await setSeconds(inv.id, 120);
    await sendInviteCode(h.router, inv.token, "4.4.4.4");                                              // a new code starts clean
    await checkInviteCode(h.router, inv.token, lastCode());
  });

  it("a code runs out", async () => {
    const inv = await invite();
    await sendInviteCode(h.router, inv.token, "5.5.5.5");
    const code = lastCode();
    await inOrg((q) => q.query("update public.invitations set otp_expires_at = now() - interval '1 minute' where id = $1", [inv.id]));
    await expect(checkInviteCode(h.router, inv.token, code)).rejects.toThrow(/run out/);
  });

  it("a new code replaces the old one, and sends are spaced and limited", async () => {
    const inv = await invite();
    await sendInviteCode(h.router, inv.token, "6.6.6.6");
    const first = lastCode();
    await expect(sendInviteCode(h.router, inv.token, "6.6.6.6")).rejects.toThrow(/Wait \d+ seconds/);
    await setSeconds(inv.id, 120);
    await sendInviteCode(h.router, inv.token, "6.6.6.6");
    const second = lastCode();
    if (first !== second) await expect(checkInviteCode(h.router, inv.token, first)).rejects.toThrow(/not right/);
    for (let i = 2; i < OTP_MAX_SENDS; i++) { await setSeconds(inv.id, 120); await sendInviteCode(h.router, inv.token, "6.6.6.6"); }
    await setSeconds(inv.id, 120);
    await expect(sendInviteCode(h.router, inv.token, "6.6.6.6")).rejects.toThrow(/Too many codes were sent/);
  });

  it("an invitation cannot be made without a phone number, so there is always somewhere to text the code", async () => {
    const noPhone = await invite({ phone: undefined }).catch((e) => e);
    expect(noPhone).toBeInstanceOf(Error);                                  // every invitation needs a phone number (ADR-026), so there is none without one
  });

  it("a wrong, used or made-up link gets the same plain refusal", async () => {
    await expect(sendInviteCode(h.router, "x".repeat(43), "7.7.7.7")).rejects.toThrow(/not working/);
    await expect(sendInviteCode(h.router, "short", "7.7.7.7")).rejects.toThrow(/not working/);
    await expect(checkInviteCode(h.router, "x".repeat(43), "123456")).rejects.toThrow(/not working/);
  });
});
