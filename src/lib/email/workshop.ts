// The email a workshop gets from an organization that wants its estimate or its invoice (ADR-033). Workshops are added by each organization
// and never sign up, so this email, or a message to their phone, is how they are asked. Pure text building, no sending. Everything that came
// from outside is escaped; the link is the one-time link made by createWorkshopLink, never anything typed by a person.
import type { Mail } from "./templates";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export type WorkshopMailInput = {
  to: string; kind: "quotation" | "invoice"; vendorName: string; orgName: string; jobNo: string; url: string; siteUrl: string;
  /** when set, the workshop may also answer by replying to this email with the document attached, and the reply goes to this address */
  replyTo?: string;
};

export function buildWorkshopMail(i: WorkshopMailInput): Mail {
  const what = i.kind === "quotation" ? "estimate" : "invoice";
  const subject = `${i.orgName}: please send your ${what} for job card ${i.jobNo}`;
  const lines = [
    `${i.orgName} would like your ${what} for job card ${i.jobNo}.`,
    `Press the button and fill in the form. You do not need an account. The link works once and stops working after 7 days.`,
    ...(i.replyTo ? [`Or reply to this email with your ${what} attached (a PDF or a photo), and it is saved against the same job card.`] : []),
  ];
  const button = `Send my ${what}`;
  const text = [`Hello ${i.vendorName},`, "", ...lines, "", `${button}: ${i.url}`, "", "If you were not expecting this, you can ignore it. Nothing happens unless you use the link.", "", "Fleet OTG", i.siteUrl].join("\n");
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f3f5f6;font-family:Arial,Helvetica,sans-serif;color:#14202b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#15191d;padding:18px 24px"><img src="${esc(i.siteUrl)}/fleetotg-logo.png" alt="Fleet OTG" width="160" height="40" style="display:block;border:0"></td></tr>
<tr><td style="padding:28px 24px">
<h1 style="margin:0 0 14px;font-size:20px;line-height:1.3">Your ${esc(what)} for job card ${esc(i.jobNo)}</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#3d4a55">Hello ${esc(i.vendorName)},</p>
${lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#3d4a55">${esc(l)}</p>`).join("\n")}
<p style="margin:22px 0"><a href="${esc(i.url)}" style="display:inline-block;background:#c2410c;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 22px;border-radius:6px">${esc(button)}</a></p>
<p style="margin:0 0 12px;font-size:12px;line-height:1.5;color:#5b6b78">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all">${esc(i.url)}</span></p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#5b6b78">If you were not expecting this, you can ignore it. Nothing happens unless you use the link.</p>
</td></tr>
<tr><td style="padding:14px 24px;background:#f8fafb;font-size:11px;color:#5b6b78">Sent through Fleet OTG for ${esc(i.orgName)} · <a href="${esc(i.siteUrl)}" style="color:#5b6b78">${esc(i.siteUrl.replace(/^https?:\/\//, ""))}</a></td></tr>
</table></td></tr></table></body></html>`;
  return { to: i.to, subject, text, html, replyTo: i.replyTo };
}
