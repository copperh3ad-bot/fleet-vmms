// Sends one WhatsApp message to a phone number through the owner's WhatsApp Business account (ADR-041), using Meta's WhatsApp Business Platform (Cloud API) by its
// plain REST address, no library. Off until it is set up: no key, no sending, and the one-time code on an invitation is then not asked for. The secrets are set in
// Netlify, never in the repository:
//   WHATSAPP_PHONE_NUMBER_ID   the id of the business phone number, from Meta's WhatsApp Manager (not the number itself)
//   WHATSAPP_ACCESS_TOKEN      a permanent access token for a system user of the business (not the 24-hour test token)
//   WHATSAPP_OTP_TEMPLATE      the name of the approved authentication template that carries the code (WhatsApp lets a business start a conversation only with an
//                              approved template; without one the code is sent as plain text, which only reaches people who messaged the business in the last 24 hours)
//   WHATSAPP_TEMPLATE_LANG     the template's language code; en if empty
//   WHATSAPP_INVITE_TEMPLATE   the approved template that carries an invitation link (ADR-049). With it, the app sends the link itself from the business number and no
//                              one in the company ever holds the link; without it, the administrator gets the old phone buttons.
// And to take replies from workshops and drivers (ADR-042):
//   WHATSAPP_APP_SECRET        the app secret (Meta app, Settings, Basic): every call Meta makes to us is signed with it, and we refuse any that is not
//   WHATSAPP_VERIFY_TOKEN      a long random string you make up and also type into Meta's webhook page, so Meta can prove it is calling the right address
//   WHATSAPP_REQUEST_TEMPLATE  the approved utility template that asks a workshop for an estimate or invoice
// For the browser and unit tests only: WHATSAPP_FILE=/path writes the message to that file instead of sending it, and is refused unless ALLOW_FILE_MAILER=1.
// A phone number, a token or a message body is never logged.
import { appendFileSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";

export class WhatsAppNotConfigured extends Error {
  constructor() { super("whatsapp is not configured"); this.name = "WhatsAppNotConfigured"; }
}

const GRAPH = "https://graph.facebook.com/v21.0";
const testFile = () => (process.env.ALLOW_FILE_MAILER === "1" ? process.env.WHATSAPP_FILE : undefined);

/**
 * Meta says why it refused in the body of the answer: a code, sometimes a subcode, and a sentence. That is what tells "no payment method" from "wrong number id" from
 * "not allowed to message this person", so it goes into the error. Long runs of digits (a phone number could be in the sentence) and anything token-shaped are removed.
 */
async function refusal(res: Response, what: string): Promise<Error> {
  let more = "";
  try {
    const e = ((await res.json()) as { error?: { code?: number; error_subcode?: number; message?: string } }).error;
    if (e) more = ` (code ${e.code ?? "?"}${e.error_subcode ? `/${e.error_subcode}` : ""}: ${String(e.message ?? "").replace(/\d{7,}/g, "#").replace(/\b[A-Za-z0-9_-]{30,}\b/g, "#").slice(0, 160)})`;
  } catch { /* the answer was not JSON; the status is all there is */ }
  return new Error(`${what}: ${res.status}${more}`);
}

export const whatsappConfigured = () => !!testFile() || (!!process.env.WHATSAPP_PHONE_NUMBER_ID && !!process.env.WHATSAPP_ACCESS_TOKEN);

/** `e164` is the number in international form (+923001234567). With a `template`, `code` fills its body and its copy-code button; otherwise `body` goes as plain text. */
export async function sendWhatsApp(e164: string, m: { body: string; template?: string; code?: string }, fetchImpl: typeof fetch = fetch): Promise<void> {
  const file = testFile();
  if (file) { appendFileSync(file, JSON.stringify({ to: e164, body: m.body }) + "\n"); return; }
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID, token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!id || !token) throw new WhatsAppNotConfigured();
  const to = e164.replace(/\D/g, "");                                  // Meta wants digits only: 923001234567
  const payload = m.template
    ? {
        messaging_product: "whatsapp", to, type: "template",
        template: {
          name: m.template, language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" },
          // an authentication template has the code in its body and in its copy-code button
          components: [
            { type: "body", parameters: [{ type: "text", text: m.code ?? "" }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: m.code ?? "" }] },
          ],
        },
      }
    : { messaging_product: "whatsapp", to, type: "text", text: { body: m.body } };
  const res = await fetchImpl(`${GRAPH}/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw await refusal(res, "whatsapp failed");
}

/** Can the app send invitations itself? Needs the business number and the approved invitation template. */
export const whatsappInviteConfigured = () => !!process.env.WHATSAPP_INVITE_TEMPLATE && whatsappConfigured();

/**
 * Sends an invitation from the business number (ADR-049): the template greets the person by name, says which company invited them, and its button opens
 * `/invite/<token>` on our own site. The token is the only variable in the button, so the message can never point anywhere else.
 */
export async function sendWhatsAppInvite(e164: string, m: { name: string; org: string; token: string; siteUrl: string }, fetchImpl: typeof fetch = fetch): Promise<void> {
  const file = testFile();
  if (file) { appendFileSync(file, JSON.stringify({ to: e164, body: `Invitation for ${m.name} to join ${m.org}: ${m.siteUrl}/invite/${m.token}` }) + "\n"); return; }
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID, token = process.env.WHATSAPP_ACCESS_TOKEN, template = process.env.WHATSAPP_INVITE_TEMPLATE;
  if (!id || !token || !template) throw new WhatsAppNotConfigured();
  const clean = (s: string) => s.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 60);       // template variables cannot hold line breaks or long runs of spaces
  const res = await fetchImpl(`${GRAPH}/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: e164.replace(/\D/g, ""), type: "template",
      template: {
        name: template, language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" },
        components: [
          { type: "body", parameters: [{ type: "text", text: clean(m.name) || "there" }, { type: "text", text: clean(m.org) || "your company" }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: m.token }] },
        ],
      },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw await refusal(res, "whatsapp invite failed");
}

// ---------------------------------------------------------------------------------------------- replies from workshops and drivers (ADR-042)

/** Can we take replies? Needs the app secret (to check who is calling) and the token (to fetch their pictures and files). */
export const whatsappInboundConfigured = () => !!process.env.WHATSAPP_APP_SECRET && !!process.env.WHATSAPP_VERIFY_TOKEN && !!process.env.WHATSAPP_ACCESS_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID;

/** Meta signs the exact bytes it posts: "sha256=" and an HMAC of the body made with the app secret. Compared without leaking where it differs. */
export function verifyMetaSignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice(7), "hex");
  const want = createHmac("sha256", secret).update(rawBody).digest();
  return given.length === want.length && timingSafeEqual(given, want);
}

/** Meta's one-time check when the webhook address is saved: it sends a token and a challenge, and wants the challenge back only if the token is ours. */
export function verifyChallenge(q: { mode: string | null; token: string | null; challenge: string | null }, expected = process.env.WHATSAPP_VERIFY_TOKEN): string | null {
  if (!expected || q.mode !== "subscribe" || !q.challenge || !q.token) return null;
  const a = Buffer.from(q.token), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? q.challenge : null;
}

export type FailedStatus = { code: number | null; title: string };

/**
 * A message Meta accepted can still fail to arrive; it says so afterwards in a status call. Only the failures, only the code and a short title, only for our number:
 * enough to tell "no payment method" (131042) from "held back for this person" (131049) from "not on WhatsApp" (131026). Never a number, a message id or a body.
 */
export function failedStatuses(payload: unknown, ourPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID): FailedStatus[] {
  const out: FailedStatus[] = [];
  const entries = (payload as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const e of entries) for (const c of (Array.isArray((e as { changes?: unknown })?.changes) ? (e as { changes: unknown[] }).changes : [])) {
    const v = (c as { field?: string; value?: { metadata?: { phone_number_id?: string }; statuses?: unknown } })?.value;
    if ((c as { field?: string })?.field !== "messages" || !v || v.metadata?.phone_number_id !== ourPhoneNumberId || !Array.isArray(v.statuses)) continue;
    for (const s of v.statuses as { status?: unknown; errors?: unknown }[]) {
      if (!s || s.status !== "failed" || !Array.isArray(s.errors)) continue;
      for (const er of s.errors as { code?: unknown; title?: unknown; message?: unknown }[]) {
        const text = String(er?.title ?? er?.message ?? "").replace(/\d{7,}/g, "#").replace(/\b[A-Za-z0-9_-]{30,}\b/g, "#").slice(0, 120);
        out.push({ code: typeof er?.code === "number" ? er.code : null, title: text });
      }
    }
  }
  return out;
}

export type InboundMedia = { id: string; filename: string | null; mime: string | null };
export type InboundMessage = { id: string; from: string; contextId: string | null; text: string; media: InboundMedia[] };

/** The messages in one webhook call, only those sent to OUR business number, as plain data. Anything unexpected is left out, never an error. */
export function parseWebhook(payload: unknown, ourPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (payload as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const e of entries) for (const c of (Array.isArray((e as { changes?: unknown })?.changes) ? (e as { changes: unknown[] }).changes : [])) {
    const v = (c as { field?: string; value?: { metadata?: { phone_number_id?: string }; messages?: unknown } })?.value;
    if ((c as { field?: string })?.field !== "messages" || !v || v.metadata?.phone_number_id !== ourPhoneNumberId || !Array.isArray(v.messages)) continue;
    for (const raw of v.messages as Record<string, unknown>[]) {
      if (!raw || typeof raw !== "object") continue;
      const id = typeof raw.id === "string" ? raw.id : "", from = typeof raw.from === "string" ? raw.from.replace(/\D/g, "") : "";
      if (!id || id.length > 200 || !from || from.length > 20) continue;
      const type = String(raw.type ?? "");
      const ctx = (raw.context as { id?: unknown } | undefined)?.id;
      const media: InboundMedia[] = [];
      let text = "";
      if (type === "text") text = String((raw.text as { body?: string } | undefined)?.body ?? "");
      else if (type === "image" || type === "document") {
        const m = raw[type] as { id?: string; mime_type?: string; filename?: string; caption?: string } | undefined;
        if (m?.id) media.push({ id: String(m.id), filename: m.filename ? String(m.filename) : null, mime: m.mime_type ? String(m.mime_type) : null });
        text = String(m?.caption ?? "");
      } else continue;                                                           // voice notes, stickers, locations... are not filed
      out.push({ id, from: `+${from}`, contextId: typeof ctx === "string" && ctx.length <= 200 ? ctx : null, text: text.slice(0, 4000), media });
    }
  }
  return out;
}

const authHeader = () => ({ Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN ?? ""}` });

/** One picture or file a person sent: first its address from Meta, then the bytes, both with our token. Refuses anything over `maxBytes`. */
export async function fetchMedia(mediaId: string, maxBytes: number, fetchImpl: typeof fetch = fetch): Promise<{ bytes: Uint8Array; mime: string | null }> {
  if (!/^[0-9]{5,40}$/.test(mediaId)) throw new Error("bad media id");
  const meta = await fetchImpl(`${GRAPH}/${mediaId}`, { headers: authHeader(), signal: AbortSignal.timeout(8000) });
  if (!meta.ok) throw new Error(`media lookup failed: ${meta.status}`);
  const info = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number };
  if (!info.url || !/^https:\/\/[a-z0-9.-]+\.(fbcdn\.net|fbsbx\.com|facebook\.com|whatsapp\.net)\//i.test(info.url)) throw new Error("unexpected media address");
  if (typeof info.file_size === "number" && info.file_size > maxBytes) throw new Error("media too large");
  const res = await fetchImpl(info.url, { headers: authHeader(), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`media download failed: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error("media too large");
  return { bytes, mime: info.mime_type ?? null };
}

async function post(payload: unknown, fetchImpl: typeof fetch): Promise<string> {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID, token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!id || !token) throw new WhatsAppNotConfigured();
  const res = await fetchImpl(`${GRAPH}/${encodeURIComponent(id)}/messages`, { method: "POST", headers: { ...authHeader(), "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`whatsapp failed: ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[] };
  return body.messages?.[0]?.id ?? "";
}

/**
 * A message that starts a conversation: an approved template with its words filled in. Returns the message's own id, which is how a reply to it is recognised later
 * (WhatsApp's "reply" carries it). `buttonUrlSuffix` is the part after the fixed address of the template's link button.
 */
export async function sendTemplate(e164: string, t: { name: string; params: string[]; buttonUrlSuffix?: string }, fetchImpl: typeof fetch = fetch): Promise<string> {
  const file = testFile();
  if (file) { const id = `wamid.test${Math.random().toString(36).slice(2, 10)}`; appendFileSync(file, JSON.stringify({ to: e164, template: t.name, params: t.params, button: t.buttonUrlSuffix ?? null, id }) + "\n"); return id; }
  const components: unknown[] = [{ type: "body", parameters: t.params.map((text) => ({ type: "text", text })) }];
  if (t.buttonUrlSuffix) components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: t.buttonUrlSuffix }] });
  return post({ messaging_product: "whatsapp", to: e164.replace(/\D/g, ""), type: "template", template: { name: t.name, language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" }, components } }, fetchImpl);
}

/** A plain message to someone who wrote to us in the last 24 hours (an acknowledgement, or "reply to our message"). Anyone else cannot receive it, and that is not an error here. */
export async function sendReplyText(e164: string, body: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const file = testFile();
  if (file) { appendFileSync(file, JSON.stringify({ to: e164, body }) + "\n"); return; }
  await post({ messaging_product: "whatsapp", to: e164.replace(/\D/g, ""), type: "text", text: { body: body.slice(0, 1000) } }, fetchImpl);
}
