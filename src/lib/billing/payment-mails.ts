// The emails around a subscription payment (ADR-051). Until now nobody was told: the operator had to open the payments screen to find a claim, and the customer
// had to open the Billing page to see the answer. Now:
//   - when a customer files "I have paid", the Billing mailbox (the `billing_email` setting, finance@) is told who, how much and which reference. No receipt is attached.
//   - when the operator confirms, the customer's administrator is told the invoice number and the period covered; when the operator rejects, the reason. Replies go to the
//     Billing mailbox, which also gets a copy.
// All best effort: a mail problem never undoes a claim or a decision, and nothing here logs an address. No bank details are ever in these emails.
import type { Driver } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";
import { emailConfigured, mailFailure, sendMail } from "@/lib/email/send";
import type { Mail } from "@/lib/email/templates";
import { SITE_URL } from "@/lib/site";
import { loadPlatformSettings } from "./settings";
import { fmtMinor } from "./tax";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

type Row = [string, string];
function shell(i: { to: string; replyTo?: string; subject: string; title: string; intro: string; rows: Row[]; outro?: string; cta?: { label: string; url: string } }): Mail {
  const text = [i.title, "", i.intro, "", ...i.rows.map(([k, v]) => `${k}: ${v}`), ...(i.cta ? ["", `${i.cta.label}: ${i.cta.url}`] : []), ...(i.outro ? ["", i.outro] : []), "", "Fleet OTG", SITE_URL].join("\n");
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f3f5f6;font-family:Arial,Helvetica,sans-serif;color:#14202b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#15191d;padding:18px 24px"><img src="${esc(SITE_URL)}/fleetotg-logo.png" alt="Fleet OTG" width="160" height="40" style="display:block;border:0"></td></tr>
<tr><td style="padding:28px 24px">
<h1 style="margin:0 0 10px;font-size:20px">${esc(i.title)}</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#3d4a55">${esc(i.intro)}</p>
<table role="presentation" width="100%" cellpadding="6" cellspacing="0" style="font-size:15px;border-top:1px solid #dde3e7">${i.rows.map(([k, v]) => `<tr><td style="border-bottom:1px solid #eef1f3;color:#3d4a55">${esc(k)}</td><td align="right" style="border-bottom:1px solid #eef1f3"><b>${esc(v)}</b></td></tr>`).join("")}</table>
${i.cta ? `<p style="margin:20px 0 0"><a href="${esc(i.cta.url)}" style="display:inline-block;background:#c2410c;color:#ffffff;text-decoration:none;font-weight:bold;padding:11px 18px;border-radius:6px">${esc(i.cta.label)}</a></p>` : ""}
${i.outro ? `<p style="margin:18px 0 0;font-size:13px;color:#6b7782">${esc(i.outro)}</p>` : ""}
</td></tr></table></td></tr></table></body></html>`;
  return { to: i.to, replyTo: i.replyTo, subject: i.subject, text, html };
}

export type ClaimFacts = { org: string; slug: string | null; reference: string; amountMinor: number; currency: string; paidOn: string; months: number; note: string | null; hasProof: boolean; by: string | null };

/** To the Billing mailbox: a customer says it has paid. */
export function buildClaimAlertMail(to: string, c: ClaimFacts): Mail {
  return shell({
    to, replyTo: c.by ?? undefined, subject: `Payment to confirm: ${c.org} (${c.reference})`,
    title: "A customer says it has paid", intro: `${c.org} has filed a payment on the Billing page. Check it in the bank, then confirm or reject it on the Payments screen.`,
    rows: [["Organization", c.org], ["Reference on the transfer", c.reference], ["Amount", fmtMinor(c.amountMinor, c.currency)], ["Paid on", c.paidOn], ["Months", String(c.months)], ["Receipt uploaded", c.hasProof ? "Yes, on the Payments screen" : "No"], ...(c.note ? [["Their note", c.note] as Row] : []), ...(c.by ? [["Filed by", c.by] as Row] : [])],
    cta: { label: "Open Payments", url: `${SITE_URL}/admin/payments` },
  });
}

/** To the customer's administrator: the payment is confirmed and the invoice issued. */
export function buildPaymentConfirmedMail(to: string, replyTo: string | undefined, c: ClaimFacts, d: { invoiceNumber: string; periodEnd: string; note: string | null }): Mail {
  return shell({
    to, replyTo, subject: `Payment confirmed: Fleet OTG invoice ${d.invoiceNumber}`,
    title: "Your payment is confirmed", intro: `Thank you. We have received your payment for ${c.org} and issued your invoice. Your subscription is paid up to the date below.`,
    rows: [["Invoice", d.invoiceNumber], ["Amount received", fmtMinor(c.amountMinor, c.currency)], ["Your reference", c.reference], ["Months credited", String(c.months)], ["Paid up to", d.periodEnd], ...(d.note ? [["Note from us", d.note] as Row] : [])],
    cta: c.slug ? { label: "Open Billing", url: `${SITE_URL}/w/${encodeURIComponent(c.slug)}/billing` } : undefined,
    outro: "Your invoice is on the Billing page. Reply to this email if anything looks wrong.",
  });
}

/** To the customer's administrator: the payment could not be confirmed, and why. */
export function buildPaymentRejectedMail(to: string, replyTo: string | undefined, c: ClaimFacts, why: string): Mail {
  return shell({
    to, replyTo, subject: "Your Fleet OTG payment could not be confirmed",
    title: "We could not confirm your payment", intro: `We looked at the payment you filed for ${c.org} and could not confirm it. Nothing has been charged or credited. The reason is below; you can file it again from the Billing page once it is fixed.`,
    rows: [["Your reference", c.reference], ["Amount you filed", fmtMinor(c.amountMinor, c.currency)], ["Why", why]],
    cta: c.slug ? { label: "Open Billing", url: `${SITE_URL}/w/${encodeURIComponent(c.slug)}/billing` } : undefined,
    outro: "Reply to this email if you want to talk to us about it.",
  });
}

type Send = (m: Mail) => Promise<void>;
const quiet = async (what: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { console.error(`payment email (${what}) failed: ${mailFailure(e)}`); } };

/** Tells the Billing mailbox about a new claim. */
export async function notifyClaimFiled(driver: Driver, claimId: string, send: Send = sendMail): Promise<void> {
  await quiet("filed", async () => {
    if (!emailConfigured() && send === sendMail) return;
    const billing = (await loadPlatformSettings(driver)).billing_email?.trim();
    if (!billing) return;
    const c = await loadClaim(driver, claimId);
    if (c) await send(buildClaimAlertMail(billing, c));
  });
}

/** Tells the customer, with a copy to the Billing mailbox, what the operator decided. */
export async function notifyClaimDecided(driver: Driver, claimId: string, decision: { kind: "confirmed"; invoiceNumber: string; periodEnd: string; note?: string | null } | { kind: "rejected"; why: string }, send: Send = sendMail): Promise<void> {
  await quiet("decided", async () => {
    if (!emailConfigured() && send === sendMail) return;
    const billing = (await loadPlatformSettings(driver)).billing_email?.trim();
    const c = await loadClaim(driver, claimId);
    if (!c) return;
    const make = (to: string) => decision.kind === "confirmed"
      ? buildPaymentConfirmedMail(to, billing || undefined, c, { invoiceNumber: decision.invoiceNumber, periodEnd: decision.periodEnd, note: decision.note ?? null })
      : buildPaymentRejectedMail(to, billing || undefined, c, decision.why);
    if (c.by) await send(make(c.by));
    if (billing) {
      const copy = make(billing);
      await send({ ...copy, replyTo: c.by ?? undefined, subject: `${decision.kind === "confirmed" ? "Confirmed" : "Rejected"}: ${c.org} (${c.reference})${c.by ? "" : " [the customer has no email on file and was not told]"}` });
    }
  });
}

async function loadClaim(driver: Driver, claimId: string): Promise<ClaimFacts | null> {
  const r = await withPlatform(driver, async (q) => (await q.query<{ org: string; slug: string | null; bank_reference: string; amount_minor: string; currency: string; paid_on: string; months: number; note: string | null; has_proof: boolean; submitter_email: string | null }>(
    `select t.name as org, t.slug, c.bank_reference, c.amount_minor::text, c.currency, c.paid_on::text, c.months, c.note, (c.proof_path is not null) as has_proof, c.submitter_email
       from public.payment_claims c join public.tenants t on t.id = c.tenant_id where c.id = $1`, [claimId])).rows[0]);
  return r ? { org: r.org, slug: r.slug, reference: r.bank_reference, amountMinor: Number(r.amount_minor), currency: r.currency, paidOn: r.paid_on, months: r.months, note: r.note, hasProof: r.has_proof, by: r.submitter_email } : null;
}
