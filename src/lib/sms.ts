// Sends one text message (SMS) through an SMS provider the owner has an account with (ADR-047). No library, plain REST. Off until it is set up: no key, no
// sending, and no invitation code goes by SMS. Two providers are written, chosen by SMS_PROVIDER; changing provider is changing these settings, not code. The
// secrets are set in Netlify, never in the repository:
//   SMS_PROVIDER     twilio | plivo
//   SMS_ACCOUNT_ID   Twilio: the Account SID.  Plivo: the Auth ID.
//   SMS_AUTH_TOKEN   the provider's auth token (a secret)
//   SMS_FROM         the sender: a number the provider gave you, or a registered alphanumeric sender name (Pakistan needs the name registered, and a network may
//                    replace it; see ADR-047). With Twilio this may instead be the id of a Messaging Service (it starts with MG).
// For the browser and unit tests only: SMS_FILE=/path writes the message to that file instead of sending it, and is refused unless ALLOW_FILE_MAILER=1.
// A phone number, a token or a message body is never logged, and an error says only the provider's status number.
import { appendFileSync } from "node:fs";

export class SmsNotConfigured extends Error {
  constructor() { super("sms is not configured"); this.name = "SmsNotConfigured"; }
}

const testFile = () => (process.env.ALLOW_FILE_MAILER === "1" ? process.env.SMS_FILE : undefined);
const provider = () => (process.env.SMS_PROVIDER ?? "").trim().toLowerCase();

export const smsConfigured = () =>
  !!testFile() || (["twilio", "plivo"].includes(provider()) && !!process.env.SMS_ACCOUNT_ID && !!process.env.SMS_AUTH_TOKEN && !!process.env.SMS_FROM);

/** `e164` is the number in international form (+923001234567). The body should stay short: one segment is 160 plain characters, and every segment is paid for. */
export async function sendSms(e164: string, body: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const file = testFile();
  if (file) { appendFileSync(file, JSON.stringify({ to: e164, body }) + "\n"); return; }
  const id = process.env.SMS_ACCOUNT_ID, token = process.env.SMS_AUTH_TOKEN, from = process.env.SMS_FROM, which = provider();
  if (!id || !token || !from || !["twilio", "plivo"].includes(which)) throw new SmsNotConfigured();
  const basic = `Basic ${Buffer.from(`${id}:${token}`).toString("base64")}`;
  let res: Response;
  if (which === "twilio") {
    const form = new URLSearchParams({ To: e164, Body: body });
    form.set(from.startsWith("MG") ? "MessagingServiceSid" : "From", from);
    res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(id)}/Messages.json`, {
      method: "POST", headers: { Authorization: basic, "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(), signal: AbortSignal.timeout(8000),
    });
  } else {
    // Plivo wants the destination without the plus sign
    res = await fetchImpl(`https://api.plivo.com/v1/Account/${encodeURIComponent(id)}/Message/`, {
      method: "POST", headers: { Authorization: basic, "Content-Type": "application/json" }, body: JSON.stringify({ src: from, dst: e164.replace(/\D/g, ""), text: body }), signal: AbortSignal.timeout(8000),
    });
  }
  if (!res.ok) throw new Error(`sms failed: ${res.status}`);
}
