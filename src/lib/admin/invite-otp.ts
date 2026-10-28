// The one-time code on an invitation (ADR-041). The invitation link alone is not enough to make an account: a 6-digit code is sent on WhatsApp to the phone number the
// administrator typed for the employee, and the person types it on the invitation page. So a link that is forwarded, overheard or opened first by someone else is
// no use without the employee's phone. The code is made on the server, only its hash is stored, it runs out after 10 minutes, five wrong tries end it, and sends
// are limited. The administrator never sees it. It is asked for only when WhatsApp sending is set up (src/lib/whatsapp.ts) and the invitation has a phone number; a password
// reset link is protected by the recovery code instead.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { Driver } from "@/lib/db/types";
import { withOrgPlatform } from "@/lib/db/tenant";
import { findTenantByToken } from "@/lib/orgs";
import { UserError } from "@/lib/master/service";
import { hashInviteToken } from "./service";
import { allowShared } from "@/lib/rate-limit";
import { sendWhatsApp, whatsappConfigured } from "@/lib/whatsapp";

export const OTP_MINUTES = 10;
export const OTP_MAX_TRIES = 5;
export const OTP_MAX_SENDS = 5;            // per invitation
export const OTP_RESEND_SECONDS = 60;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const hashCode = (invitationId: string, code: string) => sha(`${invitationId}:${code.replace(/\s+/g, "")}`);
const refused = () => new UserError("This invitation is not working. Ask your administrator for a new one.");

/** The last four digits of a phone number, for "we sent a code to the number ending 4567". */
export const maskPhone = (e164: string) => `ending ${e164.replace(/\D/g, "").slice(-4)}`;

/** Is a code asked for on this invitation? Only when WhatsApp sending is set up, there is a number to text, and it is not a password reset. */
export const otpRequired = (inv: { phone: string | null; reset: boolean }) => whatsappConfigured() && !!inv.phone && !inv.reset;

type Row = { id: string; phone: string | null; reset: boolean; workspace: string; otp_hash: string | null; otp_expires_at: string | null; otp_attempts: number; otp_sends: number; seconds_since_send: number | null };

async function load(driver: Driver, token: string): Promise<{ schema: string; row: Row } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const hash = hashInviteToken(token);
  const found = await findTenantByToken(driver, "invite", hash);
  if (!found) return null;
  const row = (await withOrgPlatform(driver, found.schema, (q) => q.query<Row>(
    `select i.id, i.phone, (i.reset_user_id is not null) as reset, t.name as workspace, i.otp_hash, i.otp_expires_at::text, i.otp_attempts, i.otp_sends,
            extract(epoch from now() - i.otp_sent_at)::int as seconds_since_send
       from public.invitations i join public.tenants t on t.id = i.tenant_id
      where i.token_hash = $1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > now() and t.status = 'active'`, [hash]))).rows[0];
  return row ? { schema: found.schema, row } : null;
}

/** Sends a new code on WhatsApp to the invitation's phone. Returns where it went, for the screen. */
export async function sendInviteCode(driver: Driver, token: string, ip: string): Promise<{ sentTo: string }> {
  if (!whatsappConfigured()) throw new UserError("Codes by WhatsApp are not switched on.");
  const inv = await load(driver, token);
  if (!inv || !otpRequired(inv.row)) throw refused();
  const { row } = inv;
  if (row.otp_sends >= OTP_MAX_SENDS) throw new UserError("Too many codes were sent for this invitation. Ask your administrator for a new invitation.");
  if (row.seconds_since_send !== null && row.seconds_since_send < OTP_RESEND_SECONDS) throw new UserError(`A code was sent a moment ago. Wait ${OTP_RESEND_SECONDS - row.seconds_since_send} seconds before asking for another.`);
  if (!(await allowShared(driver, `invite-otp-ip:${ip}`, 10, 600))) throw new UserError("Too many requests from here. Wait a few minutes and try again.");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // store first, then send: a code that was sent must always be one we can check
  await withOrgPlatform(driver, inv.schema, (q) => q.query(
    `update public.invitations set otp_hash = $2, otp_expires_at = now() + ($3 || ' minutes')::interval, otp_attempts = 0, otp_sends = otp_sends + 1, otp_sent_at = now() where id = $1`,
    [row.id, hashCode(row.id, code), String(OTP_MINUTES)]));
  try {
    await sendWhatsApp(row.phone!, {
      body: `Fleet OTG code ${code} to join ${row.workspace}. It works for ${OTP_MINUTES} minutes. Enter it only if you asked to join.`,
      template: process.env.WHATSAPP_OTP_TEMPLATE || undefined, code,
    });
  } catch (e) {
    console.error(`invitation code message failed: ${e instanceof Error ? e.message : "unknown"}`);   // never the number or the code
    throw new UserError("The code could not be sent. Try again in a minute, or ask your administrator.");
  }
  return { sentTo: maskPhone(row.phone!) };
}

/** Checks the code typed on the invitation page. Does not use it up: the invitation itself is used up when the account is made. Five wrong tries end the code. */
export async function checkInviteCode(driver: Driver, token: string, typed: string): Promise<void> {
  const inv = await load(driver, token);
  if (!inv) throw refused();
  if (!otpRequired(inv.row)) return;                                   // not asked for on this invitation
  const { row } = inv;
  const code = typed.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) throw new UserError("Enter the 6-digit code we sent you on WhatsApp.");
  if (!row.otp_hash || !row.otp_expires_at) throw new UserError("Ask for a code first: press Send me a code.");
  if (new Date(row.otp_expires_at).getTime() < Date.now()) throw new UserError("That code has run out. Press Send me a new code.");
  if (row.otp_attempts >= OTP_MAX_TRIES) throw new UserError("Too many wrong codes. Press Send me a new code.");
  const a = Buffer.from(hashCode(row.id, code)), b = Buffer.from(row.otp_hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await withOrgPlatform(driver, inv.schema, (q) => q.query("update public.invitations set otp_attempts = otp_attempts + 1 where id = $1", [row.id]));
    throw new UserError("That code is not right. Check the WhatsApp message and try again.");
  }
}
