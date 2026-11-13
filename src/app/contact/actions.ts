"use server";
// Leaving a message (ADR-021). Open to anyone, so: a hidden field that only a script fills in, limits per connection and per
// address counted across all servers, strict length limits, and one row written. The answer never says whether the address is
// a customer.
import { getDriver } from "@/lib/db";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { UserError } from "@/lib/master/service";
import { buildContactNotice, parseContact, recordContact } from "@/lib/contact";
import { loadPlatformSettings } from "@/lib/billing/settings";
import { emailConfigured, mailFailure, sendMail } from "@/lib/email/send";
import type { FormState } from "@/app/w/[slug]/actions-util";
import { authEvent } from "@/lib/activity/auth";

const HOUR = 3600;
const SENT = "Thank you. We have your message and will reply to the email address you gave.";

const keep = (form: FormData): Record<string, string> =>
  Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string" && !/^\$|^website$/.test(e[0])));

async function contactActionImpl(_prev: FormState, form: FormData): Promise<FormState> {
  // Real people never see this field (it is hidden), so anything in it is a script. It is told the message went through.
  if (String(form.get("website") ?? "").trim() !== "") return { ok: SENT };
  let input;
  try {
    input = parseContact(Object.fromEntries(["name", "email", "company", "topic", "message"].map((k) => [k, form.get(k) ?? undefined])));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, fields: e.fields, values: keep(form) };
    throw e;
  }
  const driver = getDriver();
  const [ipOk, mailOk] = await Promise.all([allowShared(driver, `contact-ip:${await clientIp()}`, 5, HOUR), allowShared(driver, `contact-email:${input.email}`, 3, HOUR)]);
  if (!ipOk || !mailOk) return { error: "Too many messages from here. Wait a little and try again.", values: keep(form) };
  await recordContact(driver, input);
  // A heads-up to the owner. The message is already saved, so a mail problem never loses it or shows the visitor an error.
  if (emailConfigured()) {
    try {
      const mail = buildContactNotice(input, await loadPlatformSettings(driver), process.env.EMAIL_REPLY_TO);
      if (mail) await sendMail(mail);
    } catch (e) { console.error(`contact notice failed: ${mailFailure(e)}`); }
  }
  return { ok: SENT };
}

export async function contactAction(...args: Parameters<typeof contactActionImpl>): Promise<Awaited<ReturnType<typeof contactActionImpl>>> {
  return authEvent("contact form", args, () => contactActionImpl(...args));
}
