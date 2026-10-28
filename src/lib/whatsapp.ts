// Sends one WhatsApp message to a phone number through the owner's WhatsApp Business account (ADR-041), using Meta's WhatsApp Business Platform (Cloud API) by its
// plain REST address, no library. Off until it is set up: no key, no sending, and the one-time code on an invitation is then not asked for. The secrets are set in
// Netlify, never in the repository:
//   WHATSAPP_PHONE_NUMBER_ID   the id of the business phone number, from Meta's WhatsApp Manager (not the number itself)
//   WHATSAPP_ACCESS_TOKEN      a permanent access token for a system user of the business (not the 24-hour test token)
//   WHATSAPP_OTP_TEMPLATE      the name of the approved authentication template that carries the code (WhatsApp lets a business start a conversation only with an
//                              approved template; without one the code is sent as plain text, which only reaches people who messaged the business in the last 24 hours)
//   WHATSAPP_TEMPLATE_LANG     the template's language code; en if empty
// For the browser and unit tests only: WHATSAPP_FILE=/path writes the message to that file instead of sending it, and is refused unless ALLOW_FILE_MAILER=1.
// A phone number, a token or a message body is never logged.
import { appendFileSync } from "node:fs";

export class WhatsAppNotConfigured extends Error {
  constructor() { super("whatsapp is not configured"); this.name = "WhatsAppNotConfigured"; }
}

const GRAPH = "https://graph.facebook.com/v21.0";
const testFile = () => (process.env.ALLOW_FILE_MAILER === "1" ? process.env.WHATSAPP_FILE : undefined);

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
  if (!res.ok) throw new Error(`whatsapp failed: ${res.status}`);
}
