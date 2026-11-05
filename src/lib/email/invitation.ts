// The email an invited person gets with their link (ADR-041, which adds email to ADR-026's phone-only sending). Pure text building, no sending. The link is the
// one-time link made by createInvite, never anything typed by a person; everything that came from outside is escaped.
import type { Mail } from "./templates";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export type InvitationMailInput = { to: string; fullName: string; orgName: string; url: string; siteUrl: string; days: number; replyTo?: string };

export function buildInvitationMail(i: InvitationMailInput): Mail {
  const subject = `${i.orgName} has invited you to Fleet OTG`;
  const text = [
    `Hello ${i.fullName},`, "",
    `${i.orgName} has invited you to join its fleet system on Fleet OTG.`,
    `Press the link to create your account. It works once and stops working after ${i.days} days.`, "",
    `Create my account: ${i.url}`, "",
    "Use the email address this message came to. If you were not expecting this, you can ignore it. Nothing happens unless you use the link.", "",
    "Fleet OTG", i.siteUrl,
  ].join("\n");
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f3f5f6;font-family:Arial,Helvetica,sans-serif;color:#14202b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#15191d;padding:18px 24px"><img src="${esc(i.siteUrl)}/fleetotg-logo.png" alt="Fleet OTG" width="160" height="40" style="display:block;border:0"></td></tr>
<tr><td style="padding:28px 24px">
<h1 style="margin:0 0 14px;font-size:20px;line-height:1.3">You are invited to ${esc(i.orgName)}</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#3d4a55">Hello ${esc(i.fullName)},</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#3d4a55">${esc(i.orgName)} has invited you to join its fleet system. Press the button to create your account. The link works once and stops working after ${i.days} days.</p>
<p style="margin:0 0 20px"><a href="${esc(i.url)}" style="display:inline-block;background:#c2410c;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 22px;border-radius:6px">Create my account</a></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#6b7782">Use the email address this message came to. If you were not expecting this, you can ignore it. Nothing happens unless you use the link.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { to: i.to, subject, text, html, replyTo: i.replyTo };
}

export type InviteCodeMailInput = { to: string; fullName: string; orgName: string; code: string; minutes: number; siteUrl: string; replyTo?: string };

/** The one-time code on an invitation, sent to the invited person's email (ADR-046). It never contains the invitation link: the link and the code
 *  travel separately so that one alone is of no use. The code is made by the server, never typed by a person. */
export function buildInviteCodeMail(i: InviteCodeMailInput): Mail {
  const subject = "Your Fleet OTG code";
  const text = [
    `Hello ${i.fullName},`, "",
    `Your Fleet OTG code to join ${i.orgName} is:`, "", `    ${i.code}`, "",
    `Type it on the invitation page. It works for ${i.minutes} minutes.`,
    "If you did not ask to join, ignore this message and do not share the code with anyone.", "",
    "Fleet OTG", i.siteUrl,
  ].join("\n");
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f3f5f6;font-family:Arial,Helvetica,sans-serif;color:#14202b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#15191d;padding:18px 24px"><img src="${esc(i.siteUrl)}/fleetotg-logo.png" alt="Fleet OTG" width="160" height="40" style="display:block;border:0"></td></tr>
<tr><td style="padding:28px 24px">
<h1 style="margin:0 0 14px;font-size:20px;line-height:1.3">Your code to join ${esc(i.orgName)}</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#3d4a55">Hello ${esc(i.fullName)}, type this code on the invitation page:</p>
<p style="margin:0 0 20px;font-size:32px;letter-spacing:6px;font-weight:bold;font-family:'Courier New',monospace">${esc(i.code)}</p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#6b7782">It works for ${i.minutes} minutes. If you did not ask to join, ignore this message and do not share the code with anyone.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { to: i.to, subject, text, html, replyTo: i.replyTo };
}
