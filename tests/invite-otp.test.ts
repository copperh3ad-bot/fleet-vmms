// The one-time code on an invitation (ADR-041): off until texting is set up; then a link alone cannot make an account. The code is texted to the invitation's phone, only
// its hash is stored, it runs out, five wrong tries end it, sends are limited, and the full phone number never reaches the invitation page.
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inviteUser, previewInvitation } from "@/lib/admin/service";
import { codeChannel, maskEmail } from "@/lib/admin/invite-channel";
import { buildInviteCodeMail } from "@/lib/email/invitation";
import { withOrgPlatform } from "@/lib/db/tenant";
import { OTP_MAX_SENDS, OTP_MAX_TRIES, checkInviteCode, maskPhone, sendInviteCode } from "@/lib/admin/invite-otp";
import { WhatsAppNotConfigured, sendWhatsApp, whatsappConfigured } from "@/lib/whatsapp";
import { harness, type Org } from "./billing-harness";

let h: Awaited<ReturnType<typeof harness>>;
let org: Org;
let out: string;
const saved = { f: process.env.WHATSAPP_FILE, a: process.env.ALLOW_FILE_MAILER, id: process.env.WHATSAPP_PHONE_NUMBER_ID, tok: process.env.WHATSAPP_ACCESS_TOKEN };
let seq = 0;
const invite = (over: Record<string, unknown> = {}) => inviteUser(h.router, org.admin, { full_name: "Sana Malik", employee_no: `OT-${++seq}`, email: `otp${seq}@example.com`, phone: "0300 1234567", role: "requester", ...over });
const texts = () => (existsSync(out) ? readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; body: string }) : []);
const lastCode = () => texts().at(-1)!.body.match(/\b(\d{6})\b/)![1];
const inOrg = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withOrgPlatform(h.router, org.schema, fn);
const setSeconds = (id: string, seconds: number) => inOrg((q) => q.query("update public.invitations set otp_sent_at = now() - ($2 || ' seconds')::interval where id = $1", [id, String(seconds)]));

beforeAll(async () => {
  h = await harness();
  org = await h.org("Otp Co");
  out = join(mkdtempSync(join(tmpdir(), "wa-")), "out.jsonl");
});
afterAll(() => { for (const [k, v] of [["WHATSAPP_FILE", saved.f], ["ALLOW_FILE_MAILER", saved.a], ["WHATSAPP_PHONE_NUMBER_ID", saved.id], ["WHATSAPP_ACCESS_TOKEN", saved.tok]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

describe("WhatsApp sending is off until it is set up", () => {
  it("asks for no code, and sending refuses", async () => {
    delete process.env.WHATSAPP_FILE; delete process.env.WHATSAPP_PHONE_NUMBER_ID; delete process.env.WHATSAPP_ACCESS_TOKEN;
    expect(whatsappConfigured()).toBe(false);
    const inv = await invite();
    const p = await previewInvitation(h.router, inv.token);
    expect(p).toMatchObject({ codeRequired: false, codeChannel: null, codeHint: null });
    await expect(sendInviteCode(h.router, inv.token, "1.1.1.1")).rejects.toThrow(/not switched on/);
    await checkInviteCode(h.router, inv.token, "");                       // nothing to check, so it passes
    await expect(sendWhatsApp("+923001234567", { body: "x" })).rejects.toBeInstanceOf(WhatsAppNotConfigured);
  });
});

describe("with WhatsApp sending on", () => {
  beforeAll(() => { process.env.WHATSAPP_FILE = out; process.env.ALLOW_FILE_MAILER = "1"; });

  it("the invitation page is told a code is needed and where it goes, never the whole number", async () => {
    const inv = await invite();
    const p = await previewInvitation(h.router, inv.token);
    expect(p).toMatchObject({ codeRequired: true, codeChannel: "whatsapp", codeHint: "WhatsApp, to the number ending 4567" });
    expect(JSON.stringify(p)).not.toContain("1234567");
    expect(maskPhone("+923001234567")).toBe("ending 4567");
  });

  it("sends a 6-digit code on WhatsApp to the invitation's number, and the right code passes", async () => {
    const inv = await invite();
    expect(await sendInviteCode(h.router, inv.token, "2.2.2.2")).toEqual({ sentTo: "WhatsApp, to the number ending 4567", channel: "whatsapp" });
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

describe("the WhatsApp request (Meta's WhatsApp Business Platform)", () => {
  const fake = (status = 200) => { const calls: { url: string; init: RequestInit }[] = []; const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response("{}", { status }); }) as unknown as typeof fetch; return { calls, f }; };
  const KEYS = ["WHATSAPP_FILE", "ALLOW_FILE_MAILER", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_TEMPLATE_LANG"];
  const withEnv = async (env: Record<string, string>, run: () => Promise<void>) => {
    const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    Object.assign(process.env, env);
    try { await run(); } finally { for (const k of KEYS) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } }
  };
  const cfg = { WHATSAPP_PHONE_NUMBER_ID: "109876543210", WHATSAPP_ACCESS_TOKEN: "secret-token" };

  it("posts to the business number's messages address with a bearer token and the number as digits only", async () => {
    await withEnv(cfg, async () => {
      const { calls, f } = fake();
      await sendWhatsApp("+923001234567", { body: "Your code 123456" }, f);
      expect(calls[0].url).toBe("https://graph.facebook.com/v21.0/109876543210/messages");
      expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
      expect(JSON.parse(String(calls[0].init.body))).toEqual({ messaging_product: "whatsapp", to: "923001234567", type: "text", text: { body: "Your code 123456" } });
    });
  });

  it("uses the approved authentication template when there is one, with the code in its body and its copy-code button", async () => {
    await withEnv({ ...cfg, WHATSAPP_TEMPLATE_LANG: "en_US" }, async () => {
      const { calls, f } = fake();
      await sendWhatsApp("+923001234567", { body: "plain", template: "fleetotg_code", code: "654321" }, f);
      const sent = JSON.parse(String(calls[0].init.body));
      expect(sent).toMatchObject({ type: "template", to: "923001234567", template: { name: "fleetotg_code", language: { code: "en_US" } } });
      expect(sent.template.components).toEqual([
        { type: "body", parameters: [{ type: "text", text: "654321" }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "654321" }] },
      ]);
      expect(JSON.stringify(sent)).not.toContain("plain");
    });
  });

  it("is not configured without both the number id and the token, and says plainly when Meta refuses", async () => {
    await withEnv({ WHATSAPP_PHONE_NUMBER_ID: "1" }, async () => {
      expect(whatsappConfigured()).toBe(false);
      await expect(sendWhatsApp("+923001234567", { body: "x" })).rejects.toBeInstanceOf(WhatsAppNotConfigured);
    });
    await withEnv(cfg, async () => {
      expect(whatsappConfigured()).toBe(true);
      await expect(sendWhatsApp("+923001234567", { body: "x" }, fake(400).f)).rejects.toThrow("whatsapp failed: 400");
    });
  });
});


// ADR-046: the code can go by email instead, chosen with INVITE_CODE_CHANNEL. WhatsApp stays the default.
describe("the code by email (ADR-046)", () => {
  const KEYS = ["INVITE_CODE_CHANNEL", "SMTP_URL", "EMAIL_FROM", "ALLOW_FILE_MAILER", "WHATSAPP_FILE"];
  let mailOut: string;
  const before: Record<string, string | undefined> = {};
  const mails = () => (existsSync(mailOut) ? readFileSync(mailOut, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; subject: string; text: string; html: string }) : []);
  const mailCode = () => mails().at(-1)!.text.match(/\b(\d{6})\b/)![1];

  beforeAll(() => {
    for (const k of KEYS) before[k] = process.env[k];
    mailOut = join(mkdtempSync(join(tmpdir(), "mail-")), "out.jsonl");
    process.env.ALLOW_FILE_MAILER = "1"; process.env.WHATSAPP_FILE = out;
    process.env.SMTP_URL = `file:${mailOut}`; process.env.EMAIL_FROM = "Fleet OTG <noreply@example.com>";
    process.env.INVITE_CODE_CHANNEL = "email";
  });
  afterAll(() => { for (const k of KEYS) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } });

  it("names the channel and shows a masked address, never the whole one", async () => {
    const inv = await invite();
    const p = await previewInvitation(h.router, inv.token);
    expect(p).toMatchObject({ codeRequired: true, codeChannel: "email" });
    expect(p!.codeHint).toMatch(/^your email o\*\*\*@example\.com$/);
    expect(p!.codeHint).not.toContain(inv.email!);                  // the page already shows the invited email in its own box; the hint never repeats it whole
    expect(maskEmail("sana.malik@example.com")).toBe("s***@example.com");
    expect(maskEmail("nonsense")).toBe("your email");
  });

  it("emails a 6-digit code to the invited address, apart from the link, and the right code passes", async () => {
    const inv = await invite();
    const wa = texts().length;
    const res = await sendInviteCode(h.router, inv.token, "8.8.8.8");
    expect(res.channel).toBe("email");
    expect(res.sentTo).toMatch(/^your email /);
    const m = mails().at(-1)!;
    expect(m.to).toBe(inv.email);
    expect(m.subject).toBe("Your Fleet OTG code");
    expect(m.text).toContain("Otp Co");
    expect(m.text).not.toContain(inv.token);                         // the link and the code never travel together
    expect(m.text).not.toMatch(/\/invite\//);
    expect(texts().length).toBe(wa);                                  // nothing went to WhatsApp
    await checkInviteCode(h.router, inv.token, mailCode());
    await expect(checkInviteCode(h.router, inv.token, mailCode() === "000000" ? "111111" : "000000")).rejects.toThrow(/not right/);
  });

  it("keeps every limit of the WhatsApp code: a hash only, spacing, five wrong tries, expiry", async () => {
    const inv = await invite();
    await sendInviteCode(h.router, inv.token, "9.9.9.1");
    const row = await inOrg(async (q) => (await q.query<Record<string, unknown>>("select otp_hash from public.invitations where id = $1", [inv.id])).rows[0]);
    expect(String(row.otp_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(mailCode());
    await expect(sendInviteCode(h.router, inv.token, "9.9.9.1")).rejects.toThrow(/Wait \d+ seconds/);
    const right = mailCode(), wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < OTP_MAX_TRIES; i++) await expect(checkInviteCode(h.router, inv.token, wrong)).rejects.toThrow(/not right/);
    await expect(checkInviteCode(h.router, inv.token, right)).rejects.toThrow(/Too many wrong codes/);
    await setSeconds(inv.id, 120);
    await sendInviteCode(h.router, inv.token, "9.9.9.1");
    await inOrg((q) => q.query("update public.invitations set otp_expires_at = now() - interval '1 minute' where id = $1", [inv.id]));
    await expect(checkInviteCode(h.router, inv.token, mailCode())).rejects.toThrow(/run out/);
  });

  it("falls back to WhatsApp when mail sending is not set up, and when there is no email on the invitation", async () => {
    const inv = await invite();
    delete process.env.SMTP_URL;
    try {
      expect(await previewInvitation(h.router, inv.token)).toMatchObject({ codeChannel: "whatsapp" });
      expect((await sendInviteCode(h.router, inv.token, "9.9.9.2")).channel).toBe("whatsapp");
    } finally { process.env.SMTP_URL = `file:${mailOut}`; }
    const noEmail = { email: null, phone: "+923001234567", reset: false };
    expect(codeChannel(noEmail, "email")).toBe("whatsapp");          // a person invited by sign-in name still gets a real second channel
    expect(codeChannel({ ...noEmail, phone: null }, "email")).toBeNull();
  });

  it("stays on WhatsApp unless email is chosen, so nothing changes for anyone who does not set it", async () => {
    const inv = await invite();
    for (const mode of [undefined, "auto", "whatsapp", "WhatsApp "]) {
      if (mode === undefined) delete process.env.INVITE_CODE_CHANNEL; else process.env.INVITE_CODE_CHANNEL = mode;
      expect(await previewInvitation(h.router, inv.token), String(mode)).toMatchObject({ codeChannel: "whatsapp" });
    }
    process.env.INVITE_CODE_CHANNEL = "email";
  });

  it("'off' asks for no code at all, so a code that cannot be delivered never blocks an invitation", async () => {
    const inv = await invite();
    process.env.INVITE_CODE_CHANNEL = "off";
    try {
      expect(await previewInvitation(h.router, inv.token)).toMatchObject({ codeRequired: false, codeChannel: null, codeHint: null });
      await expect(sendInviteCode(h.router, inv.token, "9.9.9.3")).rejects.toThrow(/not switched on/);
      await checkInviteCode(h.router, inv.token, "");                // nothing to check
    } finally { process.env.INVITE_CODE_CHANNEL = "email"; }
  });

  it("a reset link never asks for a code, whatever the setting", () => {
    for (const mode of ["email", "whatsapp", "auto", "off"]) expect(codeChannel({ email: "a@example.com", phone: "+923001234567", reset: true }, mode)).toBeNull();
  });

  it("says plainly that the code could not be sent when the mail service refuses, and leaves the invitation alone", async () => {
    const inv = await invite();
    process.env.SMTP_URL = "smtp://127.0.0.1:1";                     // nothing listens there
    delete process.env.ALLOW_FILE_MAILER;
    try {
      await expect(sendInviteCode(h.router, inv.token, "9.9.9.4")).rejects.toThrow(/could not be sent/);
    } finally { process.env.SMTP_URL = `file:${mailOut}`; process.env.ALLOW_FILE_MAILER = "1"; }
    expect(await previewInvitation(h.router, inv.token)).not.toBeNull();   // still a live invitation
  });

  it("the email is built from escaped text", () => {
    const m = buildInviteCodeMail({ to: "a@example.com", fullName: "<b>Sana</b>", orgName: "A & B <Co>", code: "123456", minutes: 10, siteUrl: "https://www.fleetotg.com" });
    expect(m.html).not.toContain("<b>Sana</b>");
    expect(m.html).toContain("&lt;b&gt;Sana&lt;/b&gt;");
    expect(m.html).toContain("A &amp; B &lt;Co&gt;");
    expect(m.text).toContain("123456");
  });
});
