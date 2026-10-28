// Sends one text message through whatever service the owner has set up (ADR-041). Off until a key is set: no key, no texting, and the one-time code on an
// invitation is then not asked for. The service is Twilio (its plain REST address, no library). The secrets are set in Netlify, never in the repository:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN   from the Twilio console
//   TWILIO_FROM                              a Twilio phone number (+1...), or a messaging service id (MG...)
// For the browser test only: SMS_FILE=/path writes the message to that file instead of sending it, and is refused unless ALLOW_FILE_MAILER=1.
// A phone number or a message body is never logged.
import { appendFileSync } from "node:fs";

export class SmsNotConfigured extends Error {
  constructor() { super("texting is not configured"); this.name = "SmsNotConfigured"; }
}

const testFile = () => (process.env.ALLOW_FILE_MAILER === "1" ? process.env.SMS_FILE : undefined);

export const smsConfigured = () => !!testFile() || (!!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN && !!process.env.TWILIO_FROM);

export async function sendSms(to: string, body: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const file = testFile();
  if (file) { appendFileSync(file, JSON.stringify({ to, body }) + "\n"); return; }
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) throw new SmsNotConfigured();
  const form = new URLSearchParams({ To: to, Body: body });
  form.set(from.startsWith("MG") ? "MessagingServiceSid" : "From", from);
  const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`sms failed: ${res.status}`);
}
