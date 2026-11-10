// The emails Supabase asks the app to send (ADR-024): confirm a sign-up, reset a password, and the rarer kinds. Pure text
// building, no sending. Every value that came from outside is escaped before it goes into the HTML, and the link is made
// from the secure one-time code Supabase gave us, never from anything typed by a person.
import { z } from "zod";

export const hookSchema = z.object({
  user: z.object({ email: z.string().max(320).pipe(z.email()) }),
  email_data: z.object({
    token: z.string().max(20).optional(),
    token_hash: z.string().min(8).max(200).regex(/^[A-Za-z0-9._-]+$/),
    redirect_to: z.string().max(2000).optional(),
    email_action_type: z.string().min(2).max(40).regex(/^[a-z_]+$/),
  }),
});
export type HookPayload = z.output<typeof hookSchema>;

export type Mail = { to: string; subject: string; text: string; html: string; /** where a reply goes, if not the site-wide address */ replyTo?: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The page where the person lands after Supabase has checked the code. Only an http(s) address is passed on. */
function safeRedirect(r: string | undefined): string | undefined {
  if (!r) return undefined;
  try { const u = new URL(r); return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined; } catch { return undefined; }
}

/** Supabase's own address for checking a one-time code, which then sends the person on to the app. */
export function verifyLink(supabaseUrl: string, d: HookPayload["email_data"]): string {
  const to = safeRedirect(d.redirect_to);
  return `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/verify?token=${encodeURIComponent(d.token_hash)}&type=${encodeURIComponent(d.email_action_type)}${to ? `&redirect_to=${encodeURIComponent(to)}` : ""}`;
}

type Copy = { subject: string; heading: string; lines: string[]; button: string; ignore: string };
const COPY: Record<string, Copy> = {
  signup: {
    subject: "Confirm your Fleet OTG account",
    heading: "Confirm your email address",
    lines: ["Thank you for starting your free trial of Fleet OTG.", "Press the button to confirm your email address. We will then set up your company's workspace, which takes under a minute."],
    button: "Confirm my email",
    ignore: "If you did not sign up for Fleet OTG, you can ignore this email and nothing will happen.",
  },
  recovery: {
    subject: "Reset your Fleet OTG password",
    heading: "Choose a new password",
    lines: ["We received a request to reset the password for your Fleet OTG account.", "Press the button to choose a new one. Open it on the device and browser you asked from."],
    button: "Choose a new password",
    ignore: "If you did not ask for this, ignore this email. Your password has not been changed.",
  },
  magiclink: { subject: "Your Fleet OTG sign-in link", heading: "Sign in to Fleet OTG", lines: ["Press the button to sign in."], button: "Sign in", ignore: "If you did not ask for this, you can ignore this email." },
  invite: { subject: "You have been invited to Fleet OTG", heading: "You have been invited", lines: ["Press the button to accept the invitation and set up your account."], button: "Accept the invitation", ignore: "If you were not expecting this, you can ignore this email." },
  email_change: { subject: "Confirm your new email address", heading: "Confirm your new email address", lines: ["Press the button to confirm the change to your Fleet OTG account."], button: "Confirm", ignore: "If you did not ask for this, contact us at once." },
};
const GENERIC: Copy = { subject: "Fleet OTG", heading: "Fleet OTG", lines: ["Press the button to continue."], button: "Continue", ignore: "If you did not ask for this, you can ignore this email." };

export const SUPPORTED_ACTIONS = Object.keys(COPY);

export function buildMail(payload: HookPayload, o: { supabaseUrl: string; siteUrl: string }): Mail {
  const c = COPY[payload.email_data.email_action_type] ?? GENERIC;
  const link = verifyLink(o.supabaseUrl, payload.email_data);
  const text = [c.heading, "", ...c.lines, "", `${c.button}: ${link}`, "", c.ignore, "", "Fleet OTG, your fleet manager", o.siteUrl].join("\n");
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f3f5f6;font-family:Arial,Helvetica,sans-serif;color:#14202b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#15191d;padding:18px 24px"><img src="${esc(o.siteUrl)}/fleetotg-logo.png" alt="Fleet OTG" width="160" height="40" style="display:block;border:0"></td></tr>
<tr><td style="padding:28px 24px">
<h1 style="margin:0 0 14px;font-size:20px;line-height:1.3">${esc(c.heading)}</h1>
${c.lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#3d4a55">${esc(l)}</p>`).join("\n")}
<p style="margin:22px 0"><a href="${esc(link)}" style="display:inline-block;background:#c2410c;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 22px;border-radius:6px">${esc(c.button)}</a></p>
<p style="margin:0 0 12px;font-size:12px;line-height:1.5;color:#5b6b78">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all">${esc(link)}</span></p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#5b6b78">${esc(c.ignore)}</p>
</td></tr>
<tr><td style="padding:14px 24px;background:#f8fafb;font-size:11px;color:#5b6b78">Fleet OTG, your fleet manager · <a href="${esc(o.siteUrl)}" style="color:#5b6b78">${esc(o.siteUrl.replace(/^https?:\/\//, ""))}</a></td></tr>
</table></td></tr></table></body></html>`;
  return { to: payload.user.email, subject: c.subject, text, html };
}
