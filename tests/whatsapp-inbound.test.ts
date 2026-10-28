// A workshop's WhatsApp reply (ADR-042): only Meta may call the address, a reply is recognised by the message it answers, and it is filed like an emailed reply.
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import type { Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import * as vf from "@/lib/vendorflow/service";
import { MAX_REPLIES_PER_REQUEST } from "@/lib/vendorflow/inbound";
import { processInboundWhatsApp, waReplyHash, type WhatsAppDeps } from "@/lib/vendorflow/whatsapp-inbound";
import { fetchMedia, parseWebhook, sendReplyText, sendTemplate, verifyChallenge, verifyMetaSignature, whatsappInboundConfigured, type InboundMessage } from "@/lib/whatsapp";
import { GET as webhookGet, POST as webhookPost } from "@/app/api/inbound/whatsapp/route";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number, vehicleScope: "all" | "own" = "all"): Membership => ({ ...t, userId: U(n), role, vehicleScope });
const owner = () => mem("tenant_admin", 1);
const driver = () => mem("requester", 11, "own");
const mgr = () => mem("fleet_manager", 12);
const mgr2 = () => mem("fleet_manager", 13);
const raw = <T,>(m: Membership, fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, m, fn);
let veh: string, reason: string, vA: string;

const env0 = { ...process.env };
const APP_KEY = ["made", "up", "for", "the", "tests"].join("-"), PNID = "109876543210";
const VERIFY = ["verify", "me", "123"].join("-");
beforeAll(async () => {
  Object.assign(process.env, { WHATSAPP_APP_SECRET: APP_KEY, WHATSAPP_VERIFY_TOKEN: VERIFY, WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: PNID });
  d = await testDriver();
  t = await provisionTenant(d, { name: "Golf Textiles", slug: "golf", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  for (const [n, name] of [[11, "Driver One"], [12, "Manager One"], [13, "Manager Two"]] as const) {
    const e = await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` });
    await raw(owner(), (q) => q.query("update employees set user_id = $1 where id = $2", [U(n), e.id]));
  }
  vA = (await master.saveVendor(d, owner(), { name: "Quick Fix Motors", categories: ["brakes"] })).id;
  await raw(owner(), (q) => q.query("update vendors set phone = '0300 1234567', email = 'office@quickfix.example' where id = $1", [vA]));
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[11, "requester"], [12, "fleet_manager"], [13, "fleet_manager"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  const emp11 = await raw(owner(), async (q) => (await q.query<{ id: string }>("select id from employees where user_id = $1", [U(11)])).rows[0].id);
  veh = (await master.addVehicle(d, owner(), { registration_no: "WAP-245", employee_id: emp11, holding_since: "2026-01-01" })).id;
  reason = (await raw(owner(), async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'WEAR_BRAKES'")).rows[0])).id;
});
afterAll(() => { process.env = { ...env0 }; });
beforeEach(async () => { await withPlatform(d, (q) => q.query("update public.quotation_links set revoked_at = now() where revoked_at is null")); });

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF");
const EXE = new TextEncoder().encode("MZ\x90\x00 not a photo or a pdf");
const stored: string[] = [];
let n = 0;
const deps = (over: Partial<WhatsAppDeps> = {}): WhatsAppDeps => ({
  fetchMedia: async (id) => (id === "1000001" ? { bytes: PDF, mime: "application/pdf" } : { bytes: EXE, mime: "application/octet-stream" }),
  store: async (path) => { stored.push(path); },
  newId: () => `wa${++n}`,
  ...over,
});
const msg = (over: Partial<InboundMessage> = {}): InboundMessage => ({ id: `wamid.IN${++n}`, from: "+923001234567", contextId: "wamid.OUT1", text: "Our estimate is attached.", media: [{ id: "1000001", filename: "estimate.pdf", mime: "application/pdf" }], ...over });

async function asked(wamid = "wamid.OUT1"): Promise<{ job: string; token: string }> {
  const { id } = await jc.createJobCard(d, driver(), { vehicle_id: veh, reason_code_id: reason, cause_text: "Front brake pads worn to the metal", lines: [] }, true);
  await jc.transitionJobCard(d, mgr2(), id, "approved");
  await jc.transitionJobCard(d, mgr(), id, "vendor_assigned", { vendorId: vA });
  const link = await vf.createWorkshopLink(d, mgr(), id, "quotation");
  await vf.attachWhatsAppReply(d, mgr(), link.token, wamid, link.expires_at);
  return { job: id, token: link.token };
}
const emailsOf = (job: string) => raw(owner(), async (q) => (await q.query<Record<string, unknown>>("select * from workshop_emails where job_card_id = $1 order by received_at", [job])).rows);

const body = (over: Record<string, unknown> = {}) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: PNID }, messages: [{ from: "923001234567", id: "wamid.A", type: "text", text: { body: "ready" }, context: { id: "wamid.OUT1" } }], ...over } }] }],
});

describe("who may call the address", () => {
  const sign = (b: string, key = APP_KEY) => `sha256=${createHmac("sha256", key).update(b).digest("hex")}`;
  it("accepts a body signed with the app secret and nothing else", () => {
    const b = JSON.stringify(body());
    expect(verifyMetaSignature(APP_KEY, b, sign(b))).toBe(true);
    expect(verifyMetaSignature(APP_KEY, b, sign(b, "another-key"))).toBe(false);
    expect(verifyMetaSignature(APP_KEY, b + " ", sign(b))).toBe(false);          // the body was changed after signing
    for (const h of [null, "", "sha256=", "sha256=zz", "md5=abc", sign(b).slice(7)]) expect(verifyMetaSignature(APP_KEY, b, h)).toBe(false);
  });
  it("answers Meta's one-time check only for our token", () => {
    expect(verifyChallenge({ mode: "subscribe", token: VERIFY, challenge: "99887" })).toBe("99887");
    for (const q of [{ mode: "subscribe", token: "wrong", challenge: "1" }, { mode: "other", token: VERIFY, challenge: "1" }, { mode: "subscribe", token: null, challenge: "1" }, { mode: "subscribe", token: VERIFY, challenge: null }])
      expect(verifyChallenge(q)).toBeNull();
    expect(verifyChallenge({ mode: "subscribe", token: "x", challenge: "1" }, "")).toBeNull();
  });
  it("the address itself refuses an unsigned or wrongly signed call, and does the check on GET", async () => {
    const b = JSON.stringify(body());
    const post = (headers: Record<string, string>) => webhookPost(new Request("http://localhost/api/inbound/whatsapp", { method: "POST", body: b, headers }) as unknown as NextRequest);
    expect((await post({})).status).toBe(401);
    expect((await post({ "x-hub-signature-256": sign(b, "nope") })).status).toBe(401);
    const get = (q: string) => webhookGet({ nextUrl: new URL(`http://localhost/api/inbound/whatsapp?${q}`) } as unknown as NextRequest);
    const ok = await get(`hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=4242`);
    expect([ok.status, await ok.text()]).toEqual([200, "4242"]);
    expect((await get("hub.mode=subscribe&hub.verify_token=bad&hub.challenge=4242")).status).toBe(403);
    expect(whatsappInboundConfigured()).toBe(true);
    const k = process.env.WHATSAPP_APP_SECRET; delete process.env.WHATSAPP_APP_SECRET;
    expect(whatsappInboundConfigured()).toBe(false);
    process.env.WHATSAPP_APP_SECRET = k;
  });
});

describe("reading what Meta sends", () => {
  it("takes text, pictures and files sent to our number, with the message they answer, and the sender as +digits", () => {
    const m = parseWebhook(body({ messages: [
      { from: "923001234567", id: "wamid.1", type: "text", text: { body: "ready" }, context: { id: "wamid.OUT1" } },
      { from: "923007654321", id: "wamid.2", type: "image", image: { id: "555001", mime_type: "image/jpeg", caption: "estimate" } },
      { from: "923001234567", id: "wamid.3", type: "document", document: { id: "555002", filename: "q.pdf", mime_type: "application/pdf" } },
    ] }));
    expect(m).toEqual([
      { id: "wamid.1", from: "+923001234567", contextId: "wamid.OUT1", text: "ready", media: [] },
      { id: "wamid.2", from: "+923007654321", contextId: null, text: "estimate", media: [{ id: "555001", filename: null, mime: "image/jpeg" }] },
      { id: "wamid.3", from: "+923001234567", contextId: null, text: "", media: [{ id: "555002", filename: "q.pdf", mime: "application/pdf" }] },
    ]);
  });
  it("leaves out receipts, other types, other numbers and anything malformed, without failing", () => {
    expect(parseWebhook(body({ messages: undefined, statuses: [{ id: "x", status: "read" }] }))).toEqual([]);
    expect(parseWebhook(body({ messages: [{ from: "92300", id: "w", type: "audio", audio: { id: "1" } }, { from: "", id: "w", type: "text", text: { body: "x" } }, { id: "w", type: "text" }, null as never] }))).toEqual([]);
    expect(parseWebhook(body({ metadata: { phone_number_id: "someone-elses" } }))).toEqual([]);
    for (const junk of [null, 5, "x", {}, { entry: "x" }, { entry: [null, { changes: 4 }, { changes: [{ field: "other" }] }] }]) expect(parseWebhook(junk)).toEqual([]);
  });
});

describe("talking to Meta", () => {
  const fake = (replies: Response[]) => { const calls: { url: string; init?: RequestInit }[] = []; const f = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return replies.shift() ?? new Response("{}", { status: 200 }); }) as unknown as typeof fetch; return { calls, f }; };
  it("sends a template with its words and its link button, and returns the id of the message", async () => {
    const { calls, f } = fake([Response.json({ messages: [{ id: "wamid.OUTX" }] })]);
    const id = await sendTemplate("+923001234567", { name: "fleetotg_request", params: ["Quick Fix", "Golf", "estimate", "JC-7"], buttonUrlSuffix: "tok123" }, f);
    expect(id).toBe("wamid.OUTX");
    expect(calls[0].url).toBe(`https://graph.facebook.com/v21.0/${PNID}/messages`);
    const sent = JSON.parse(String(calls[0].init!.body));
    expect(sent).toMatchObject({ to: "923001234567", type: "template", template: { name: "fleetotg_request" } });
    expect(sent.template.components).toEqual([
      { type: "body", parameters: ["Quick Fix", "Golf", "estimate", "JC-7"].map((text) => ({ type: "text", text })) },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "tok123" }] },
    ]);
  });
  it("downloads a picture in two steps with the token, only from Meta's own addresses, and within the size limit", async () => {
    const ok = fake([Response.json({ url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1", mime_type: "image/jpeg", file_size: 3 }), new Response(new Uint8Array([1, 2, 3]))]);
    expect((await fetchMedia("1000001", 100, ok.f)).bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect((ok.calls[1].init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const evil = fake([Response.json({ url: "https://evil.example.com/x", file_size: 3 })]);
    await expect(fetchMedia("1000001", 100, evil.f)).rejects.toThrow(/unexpected media address/);
    const big = fake([Response.json({ url: "https://lookaside.fbsbx.com/x", file_size: 5000 })]);
    await expect(fetchMedia("1000001", 100, big.f)).rejects.toThrow(/too large/);
    await expect(fetchMedia("../../etc", 100, ok.f)).rejects.toThrow(/bad media id/);
  });
  it("in a test, writes the message to a file instead of sending it, and only when the test switch is on", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "wa-in-")), "o.jsonl");
    process.env.WHATSAPP_FILE = out; process.env.ALLOW_FILE_MAILER = "1";
    try {
      const id = await sendTemplate("+923001234567", { name: "x", params: ["a"] });
      await sendReplyText("+923001234567", "thanks");
      expect(id).toMatch(/^wamid\.test/);
      expect(readFileSync(out, "utf8").trim().split("\n")).toHaveLength(2);
    } finally { delete process.env.WHATSAPP_FILE; delete process.env.ALLOW_FILE_MAILER; }
  });
});

describe("filing a workshop's reply", () => {
  it("files the message and its PDF on the job card, flagged for staff, and tells the people who decide", async () => {
    const { job } = await asked();
    const out = await processInboundWhatsApp(d, deps(), msg());
    expect(out).toMatchObject({ status: "filed", saved: 1, skipped: 0 });
    const rows = await emailsOf(job);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "quotation", from_address: "+923001234567", subject: "WhatsApp", status: "new", file_count: 1, message_id: expect.stringMatching(/^wa:wamid\.IN/) });
    expect(rows[0].body_text).toContain("Our estimate is attached.");
    expect(stored.at(-1)).toMatch(new RegExp(`^${t.schema}/job_card/${job}/wa\\d+-estimate\\.pdf$`));
    const told = await raw(owner(), async (q) => Number((await q.query<{ c: string }>("select count(*) c from notifications where kind = 'workshop.email' and payload->>'job_card_id' = $1", [job])).rows[0].c));
    expect(told).toBeGreaterThan(0);
  });

  it("files a short text such as 'ready' with no file, so staff see it on the job card", async () => {
    const { job } = await asked("wamid.OUT2");
    const out = await processInboundWhatsApp(d, deps(), msg({ contextId: "wamid.OUT2", text: "Ready. Need 2 more days for the brake discs.", media: [] }));
    expect(out).toMatchObject({ status: "filed", saved: 0 });
    expect((await emailsOf(job))[0].body_text).toBe("Ready. Need 2 more days for the brake discs.");
  });

  it("keeps the PDF and says plainly that a file which is not a photo or PDF was not saved", async () => {
    const { job } = await asked("wamid.OUT3");
    const out = await processInboundWhatsApp(d, deps(), msg({ contextId: "wamid.OUT3", media: [{ id: "1000001", filename: "a.pdf", mime: null }, { id: "2000002", filename: "setup.exe", mime: null }] }));
    expect(out).toMatchObject({ status: "filed", saved: 1, skipped: 1 });
    expect(String((await emailsOf(job))[0].body_text)).toMatch(/1 attachment was not saved/);
  });

  it("a message that is not a reply to ours is not filed anywhere", async () => {
    const { job } = await asked("wamid.OUT4");
    expect(await processInboundWhatsApp(d, deps(), msg({ contextId: null }))).toEqual({ status: "no_context" });
    expect(await processInboundWhatsApp(d, deps(), msg({ contextId: "wamid.NOT-OURS" }))).toEqual({ status: "ignored" });
    expect(await emailsOf(job)).toHaveLength(0);
  });

  it("the same delivery twice files it once", async () => {
    const { job } = await asked("wamid.OUT5");
    const m = msg({ contextId: "wamid.OUT5" });
    expect((await processInboundWhatsApp(d, deps(), m)).status).toBe("filed");
    expect(await processInboundWhatsApp(d, deps(), m)).toEqual({ status: "ignored" });
    expect(await emailsOf(job)).toHaveLength(1);
  });

  it("stops after a few replies, and files nothing once the request is closed or replaced", async () => {
    const { job } = await asked("wamid.OUT6");
    for (let i = 0; i < MAX_REPLIES_PER_REQUEST; i++) expect((await processInboundWhatsApp(d, deps(), msg({ contextId: "wamid.OUT6", media: [] }))).status).toBe("filed");
    expect((await processInboundWhatsApp(d, deps(), msg({ contextId: "wamid.OUT6", media: [] }))).status).toBe("ignored");
    expect(await emailsOf(job)).toHaveLength(MAX_REPLIES_PER_REQUEST);
    const again = await asked("wamid.OUT7");
    await withPlatform(d, (q) => q.query("update public.quotation_links set revoked_at = now() where tenant_id = $1 and job_card_id = $2", [t.tenantId, again.job]));
    expect((await processInboundWhatsApp(d, deps(), msg({ contextId: "wamid.OUT7" }))).status).toBe("ignored");
  });

  it("the id of the message is kept only as a hash, so a stored value cannot be used to reply", async () => {
    const { token } = await asked("wamid.OUT8");
    const row = await withPlatform(d, async (q) => (await q.query<{ reply_code_hash: string }>("select reply_code_hash from public.quotation_links where tenant_id = $1 order by created_at desc limit 1", [t.tenantId])).rows[0]);
    expect(row.reply_code_hash).toBe(waReplyHash("wamid.OUT8"));
    expect(row.reply_code_hash).not.toContain("OUT8");
    expect(token).toBeTruthy();
  });
});
