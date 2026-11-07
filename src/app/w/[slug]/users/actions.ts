"use server";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { origin } from "@/lib/origin";
import { SITE_URL } from "@/lib/site";
import { emailConfigured, mailFailure, sendMail } from "@/lib/email/send";
import { buildInvitationMail } from "@/lib/email/invitation";
import { INVITE_DAYS } from "@/lib/admin/service";
import { addEmployeeWithInvite, changeMember, inviteUser, issueResetLink, replaceLogin, resendInvitation, revokeInvitation, type NewInvite } from "@/lib/admin/service";
import { suggestUsername } from "@/lib/auth/login-names";
import { sendWhatsAppInvite, whatsappInviteConfigured } from "@/lib/whatsapp";
import { runAction, str, typed, type FormState } from "../actions-util";

export type InviteResult = { /** "sent": the app sent the link from its own WhatsApp number and the link is not returned; "failed": it could not, and the link is not returned either, so send again */ whatsapp?: "sent" | "failed"; /** true: the link was also emailed to the invited person; false: it could not be; undefined: no email on the invitation */ emailed?: boolean; url: string; full_name: string; email: string | null; phone: string | null; username: string | null; employee_no: string | null; reset: boolean; expires_at: string };
export type InviteState = FormState & { invite?: InviteResult };

async function link(base: Promise<string>, i: NewInvite, orgName = "Your company"): Promise<InviteResult> {
  const origin = await base;
  let url = `${origin}/invite/${i.token}`;
  // With the invitation template set up (ADR-049) the app sends the link itself, from its own WhatsApp number, to the number on the invitation. The administrator
  // is never handed the link: that is the point, so nobody can sign up in someone else's name. A password reset keeps the old way (it also needs the person's recovery code).
  let whatsapp: InviteResult["whatsapp"];
  if (!i.reset && i.phone && whatsappInviteConfigured()) {
    try { await sendWhatsAppInvite(i.phone, { name: i.full_name, org: orgName, token: i.token, siteUrl: SITE_URL }); whatsapp = "sent"; }
    catch (e) { console.error(`invitation WhatsApp failed: ${e instanceof Error ? e.message : "unknown"}`); whatsapp = "failed"; }      // never the number or the link
    url = "";
  }
  return { whatsapp, url, emailed: i.email && !i.reset ? await emailInvite(i, url, orgName) : undefined, full_name: i.full_name, email: i.email, phone: i.phone, username: i.username, employee_no: i.employee_no, reset: i.reset, expires_at: i.expires_at };
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

export async function inviteAction(slug: string, _prev: InviteState, form: FormData): Promise<InviteState> {
  let invite: InviteResult | undefined;
  const base = origin();
  const state = await runAction(slug, async (m) => {
    const raw: Record<string, string> = Object.fromEntries(["full_name", "employee_no", "department", "email", "username", "phone", "role", "vehicle_scope", "vendor_id", "licence_no", "licence_class", "licence_type", "licence_expires_on"].map((k) => [k, str(form, k)]));
    // A person with no email signs in with a name; when none is typed, the company and the employee code make one that is easy to say.
    if (!raw.email.trim() && !raw.username.trim()) raw.username = suggestUsername(slug, raw.employee_no);
    // Everyone but a workshop is an employee, and an employee is only ever added together with the invitation, with every detail filled in (ADR-041).
    if (raw.role !== "vendor") {
      invite = await link(base, await addEmployeeWithInvite(getDriver(), m, raw), m.tenantName);
      return "Employee added and invited. Send the link now; it is shown once.";
    }
    const made = await inviteUser(getDriver(), m, raw);
    invite = await link(base, made, m.tenantName);
    return "Invitation created. Copy the link now; it is shown once.";
  });
  if (state.ok) { refresh(); return { ...state, invite }; }
  return { ...state, values: typed(form) };
}

export async function resendAction(slug: string, id: string): Promise<InviteState> {
  let invite: InviteResult | undefined;
  const base = origin();
  const state = await runAction(slug, async (m) => { invite = await link(base, await resendInvitation(getDriver(), m, id), m.tenantName); return "New link created. The old one no longer works."; });
  if (state.ok) refresh();
  return { ...state, invite };
}

export async function resetLinkAction(slug: string, userId: string): Promise<InviteState> {
  let invite: InviteResult | undefined;
  const base = origin();
  const state = await runAction(slug, async (m) => { invite = await link(base, await issueResetLink(getDriver(), m, userId)); return "Reset link created. It works once and stops working in 2 days."; });
  if (state.ok) refresh();
  return { ...state, invite };
}

export async function replaceLoginAction(slug: string, userId: string): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    const r = await replaceLogin(getDriver(), m, userId);
    return `Login replaced. ${r.username} no longer works and the employee${r.employee_no ? ` code ${r.employee_no}` : ""} is free. Invite them again to give them a new login.`;
  });
  if (state.ok) refresh();
  return state;
}

export async function revokeAction(slug: string, id: string): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await revokeInvitation(getDriver(), m, id); return "Invitation cancelled."; });
  if (state.ok) refresh();
  return state;
}

export async function changeMemberAction(slug: string, userId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await changeMember(getDriver(), m, userId, { role: str(form, "role"), vehicle_scope: str(form, "vehicle_scope"), status: str(form, "status") });
    return "Saved.";
  });
  if (state.ok) refresh();
  return state;
}
