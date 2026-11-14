// Delivers an invitation the way the Users page always has (ADR-041, ADR-049): the app sends the link from its own WhatsApp number when that is set up (and then the
// administrator is not shown the link), and also emails it when the person has an email. A mail or WhatsApp problem never undoes the invitation. Shared by the Users page
// and the vehicle import, which invites several people at once.
import { SITE_URL } from "@/lib/site";
import { emailConfigured, mailFailure, sendMail } from "@/lib/email/send";
import { buildInvitationMail } from "@/lib/email/invitation";
import { inviteLinks } from "./invite-links";
import { INVITE_DAYS, type NewInvite } from "./service";
import { sendWhatsAppInvite, whatsappInviteConfigured } from "@/lib/whatsapp";

export type InviteResult = { /** "sent": the app sent the link from its own WhatsApp number and the link is not returned; "failed": it could not, and the link is not returned either, so send again */ whatsapp?: "sent" | "failed"; /** true: the link was also emailed to the invited person; false: it could not be; undefined: no email on the invitation */ emailed?: boolean; url: string; full_name: string; email: string | null; phone: string | null; username: string | null; employee_no: string | null; reset: boolean; expires_at: string };

export async function deliverInvite(base: Promise<string> | string, i: NewInvite, orgName = "Your company"): Promise<InviteResult> {
  const origin = await base;
  let hide = false;
  // With the invitation template set up (ADR-049) the app sends the link itself, from its own WhatsApp number, to the number on the invitation. The administrator
  // is never handed the link: that is the point, so nobody can sign up in someone else's name. A password reset keeps the old way (it also needs the person's recovery code).
  let whatsapp: InviteResult["whatsapp"];
  if (!i.reset && i.phone && whatsappInviteConfigured()) {
    try { await sendWhatsAppInvite(i.phone, { name: i.full_name, org: orgName, token: i.token, siteUrl: SITE_URL }); whatsapp = "sent"; }
    catch (e) { console.error(`invitation WhatsApp failed: ${e instanceof Error ? e.message : "unknown"}`); whatsapp = "failed"; }      // never the number or the link
    hide = true;
  }
  const { forEmail, shown: url } = inviteLinks(origin, i.token, hide);          // the email always carries the real link; the administrator's screen does not when WhatsApp sent it
  return { whatsapp, url, emailed: i.email && !i.reset ? await emailInvite(i, forEmail, orgName) : undefined, full_name: i.full_name, email: i.email, phone: i.phone, username: i.username, employee_no: i.employee_no, reset: i.reset, expires_at: i.expires_at };
}

/** The link is also emailed to the invited person (ADR-041). A mail problem never undoes the invitation: the phone buttons still work, and the screen says the email did not go. */
async function emailInvite(i: NewInvite, url: string, orgName: string): Promise<boolean> {
  if (!i.email || !emailConfigured()) return false;
  try {
    await sendMail(buildInvitationMail({ to: i.email, fullName: i.full_name, orgName, url, siteUrl: SITE_URL, days: INVITE_DAYS }));
    return true;
  } catch (e) {
    console.error(`invitation email failed: ${mailFailure(e)}`);   // never the address or the link
    return false;
  }
}

