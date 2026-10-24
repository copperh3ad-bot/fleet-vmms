// Emails sent from inside the app instead of by Supabase (ADR-024): who may ask for one, what it says, and what happens when
// sending is not possible.
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/send-email/route";
import { signWebhook, verifyWebhook } from "@/lib/email/webhook";
import { buildMail, hookSchema, verifyLink, type HookPayload } from "@/lib/email/templates";

const SECRET = "v1,whsec_" + Buffer.from("a-test-secret-of-some-length-1234").toString("base64");
const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const hdr = (id: string, ts: string, body: string, secret = SECRET) => ({ id, timestamp: ts, signature: `v1,${signWebhook(secret, id, ts, body)}` });
const payload = (over: Record<string, unknown> = {}) => ({
  user: { id: "u1", email: "Sara@Acme.example" },
  email_data: { token: "123456", token_hash: "abc123DEF456ghi789", redirect_to: "https://www.fleetotg.com/auth/callback", email_action_type: "signup", site_url: "https://x", ...over },
});

describe("who may ask the app to send an email", () => {
  const body = JSON.stringify(payload());
  const ts = String(Math.floor(NOW / 1000));
  it("accepts a call signed with the shared secret", () => {
    const h = hdr("msg_1", ts, body);
    expect(verifyWebhook(SECRET, body, { id: h.id, timestamp: h.timestamp, signature: h.signature }, NOW)).toBe(true);
  });
  it("accepts when several signatures are listed and one matches", () => {
    const h = hdr("msg_1", ts, body);
    expect(verifyWebhook(SECRET, body, { id: h.id, timestamp: h.timestamp, signature: `v1,AAAA ${h.signature}` }, NOW)).toBe(true);
  });
  it("refuses a wrong secret, a changed body, a missing header and an unknown version", () => {
    const h = hdr("msg_1", ts, body);
    const base = { id: h.id, timestamp: h.timestamp, signature: h.signature };
    expect(verifyWebhook("v1,whsec_" + Buffer.from("another-secret").toString("base64"), body, base, NOW)).toBe(false);
    expect(verifyWebhook(SECRET, body + " ", base, NOW)).toBe(false);
    expect(verifyWebhook(SECRET, body, { ...base, signature: null }, NOW)).toBe(false);
    expect(verifyWebhook(SECRET, body, { ...base, id: null }, NOW)).toBe(false);
    expect(verifyWebhook(SECRET, body, { ...base, signature: base.signature.replace("v1,", "v2,") }, NOW)).toBe(false);
    expect(verifyWebhook("", body, base, NOW)).toBe(false);
  });
  it("refuses a call that is too old or too far in the future, even if correctly signed", () => {
    for (const skew of [-301, 301, -86_400]) {
      const t = String(Math.floor(NOW / 1000) + skew);
      const h = hdr("msg_1", t, body);
      expect(verifyWebhook(SECRET, body, { id: h.id, timestamp: h.timestamp, signature: h.signature }, NOW), `skew ${skew}`).toBe(false);
    }
    const h = hdr("msg_1", "not-a-number", body);
    expect(verifyWebhook(SECRET, body, { id: h.id, timestamp: h.timestamp, signature: h.signature }, NOW)).toBe(false);
  });
});

describe("what the email says", () => {
  const o = { supabaseUrl: "https://abc.supabase.co/", siteUrl: "https://www.fleetotg.com" };
  const p = (over: Record<string, unknown> = {}) => hookSchema.parse(payload(over));

  it("a sign-up confirmation has the right subject, address and a link Supabase will accept", () => {
    const m = buildMail(p(), o);
    expect(m.to).toBe("Sara@Acme.example");
    expect(m.subject).toBe("Confirm your Fleet OTG account");
    const link = "https://abc.supabase.co/auth/v1/verify?token=abc123DEF456ghi789&type=signup&redirect_to=https%3A%2F%2Fwww.fleetotg.com%2Fauth%2Fcallback";
    expect(m.text).toContain(link);
    expect(m.html).toContain(`href="${link.replace(/&/g, "&amp;")}"`);
    expect(m.html).toContain("https://www.fleetotg.com/fleetotg-logo.png");
  });
  it("a password reset says so, and the sign-up text does not appear in it", () => {
    const m = buildMail(p({ email_action_type: "recovery", redirect_to: "https://www.fleetotg.com/auth/callback?next=reset" }), o);
    expect(m.subject).toBe("Reset your Fleet OTG password");
    expect(m.text).toContain("type=recovery");
    expect(m.text).toContain("next%3Dreset");
    expect(m.text).not.toContain("free trial");
  });
  it("an unknown kind still gets a plain, safe email", () => {
    const m = buildMail(p({ email_action_type: "something_new" }), o);
    expect(m.subject).toBe("Fleet OTG");
    expect(m.text).toContain("type=something_new");
  });
  it("nothing from outside can break out of the HTML or be turned into a link to somewhere else", () => {
    const m = buildMail(p({ redirect_to: 'https://www.fleetotg.com/"><script>alert(1)</script>' }), o);
    expect(m.html).not.toContain("<script>");
    expect(buildMail(p({ redirect_to: "javascript:alert(1)" }), o).text).not.toContain("redirect_to");
    expect(buildMail(p({ redirect_to: "not a url" }), o).text).not.toContain("redirect_to");
    expect(verifyLink("https://abc.supabase.co", p({ redirect_to: undefined }).email_data)).toBe("https://abc.supabase.co/auth/v1/verify?token=abc123DEF456ghi789&type=signup");
  });
  it("refuses a payload without a real address or a safe code", () => {
    expect(() => hookSchema.parse(payload({ token_hash: "short" }))).toThrow();
    expect(() => hookSchema.parse(payload({ token_hash: "has spaces and <tags> in it" }))).toThrow();
    expect(() => hookSchema.parse({ ...payload(), user: { email: "nope" } })).toThrow();
    expect(() => hookSchema.parse(payload({ email_action_type: "SIGNUP;drop" }))).toThrow();
  });
  it("every kind of message has an address and a subject", () => {
    for (const kind of ["signup", "recovery", "magiclink", "invite", "email_change"]) {
      const m = buildMail(hookSchema.parse(payload({ email_action_type: kind })) as HookPayload, o);
      expect(m.subject.length).toBeGreaterThan(5);
      expect(m.text).toContain(`type=${kind}`);
    }
  });
});

describe("the endpoint", () => {
  let dir: string, outbox: string;
  const call = (body: string, headers: Record<string, string> = {}) =>
    POST(new Request("https://www.fleetotg.com/api/auth/send-email", { method: "POST", body, headers }) as unknown as NextRequest);
  const signed = (obj: unknown, over: Record<string, string> = {}) => {
    const body = JSON.stringify(obj), ts = String(Math.floor(Date.now() / 1000)), id = "msg_test";
    return { body, headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${signWebhook(SECRET, id, ts, body)}`, ...over } };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otg-mail-")); outbox = join(dir, "out.jsonl");
    process.env.AUTH_HOOK_SECRET = SECRET; process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
    process.env.SMTP_URL = `file:${outbox}`; process.env.EMAIL_FROM = "Fleet OTG <noreply@fleetotg.com>"; process.env.ALLOW_FILE_MAILER = "1";
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); for (const k of ["AUTH_HOOK_SECRET", "SMTP_URL", "EMAIL_FROM", "ALLOW_FILE_MAILER", "NEXT_PUBLIC_SUPABASE_URL"]) delete process.env[k]; });

  it("sends the email for a signed call and says nothing about it in the answer", async () => {
    const s = signed(payload());
    const r = await call(s.body, s.headers);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({});
    const sent = JSON.parse(readFileSync(outbox, "utf8").trim());
    expect(sent).toMatchObject({ from: "Fleet OTG <noreply@fleetotg.com>", to: "Sara@Acme.example", subject: "Confirm your Fleet OTG account" });
    expect(sent.text).toContain("https://abc.supabase.co/auth/v1/verify?token=abc123DEF456ghi789&type=signup");
  });
  it("sends nothing for an unsigned, wrongly signed or stale call", async () => {
    const s = signed(payload());
    expect((await call(s.body)).status).toBe(401);
    expect((await call(s.body, { ...s.headers, "webhook-signature": "v1,AAAA" })).status).toBe(401);
    expect((await call(s.body + " ", s.headers)).status).toBe(401);
    expect((await call(s.body, { ...s.headers, "webhook-timestamp": String(Math.floor(Date.now() / 1000) - 3600) })).status).toBe(401);
    expect(existsSync(outbox)).toBe(false);
  });
  it("refuses a signed call it cannot read, and a body that is too large", async () => {
    const bad = signed("{not json");
    expect((await call(bad.body, bad.headers)).status).toBe(400);
    const big = signed(payload({ redirect_to: "x".repeat(2500) }));
    expect((await call(big.body, big.headers)).status).toBe(400);
    expect((await call("x".repeat(100_001), signed(payload()).headers)).status).toBe(413);
    expect(existsSync(outbox)).toBe(false);
  });
  it("tells Supabase plainly when sending is not possible, so the person is not left waiting", async () => {
    delete process.env.SMTP_URL;
    const s = signed(payload());
    const r = await call(s.body, s.headers);
    expect(r.status).toBe(500);
    expect((await r.json()).error.message).toMatch(/could not be sent/);
    delete process.env.AUTH_HOOK_SECRET;
    expect((await call(s.body, s.headers)).status).toBe(500);
  });
  it("a file mailer is refused unless it has been switched on, so a stray setting cannot write mail to disk", async () => {
    delete process.env.ALLOW_FILE_MAILER;
    const s = signed(payload());
    const r = await call(s.body, s.headers);
    expect(r.status).toBe(500);
    expect(existsSync(outbox)).toBe(false);
  });
});
