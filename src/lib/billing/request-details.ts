// "Request bill" (Billing page). The administrator presses a button; the system makes the bill and emails it to that
// administrator with the payment reference and the bank account from Admin, Settings. The bank details are never shown on a
// screen: this email is the only place they leave the system. A copy goes to the Billing mailbox so the owner sees who asked.
// Permission is checked first (CLAUDE.md rule 3); the limit stops a held-down button.
import type { Driver } from "@/lib/db/types";
import { authorized, type Membership } from "@/lib/auth/can";
import { allowShared } from "@/lib/rate-limit";
import { UserError } from "@/lib/master/service";
import { SITE_URL } from "@/lib/site";
import { sendMail, emailConfigured } from "@/lib/email/send";
import { loadPlatformSettings } from "./settings";
import { BILLING_PERMISSION, paymentReference } from "./payments";
import { quoteTax } from "./tax-data";
import { buildBillMail } from "./bill";
import { formatPrice } from "./offer";

const HOUR = 3600;

export async function requestBill(driver: Driver, m: Membership, requesterEmail: string): Promise<string> {
  await authorized(driver, m, BILLING_PERMISSION, async () => undefined);
  const s = await loadPlatformSettings(driver);
  const bank = s.bank_details?.trim();
  if (!bank || !requesterEmail || !emailConfigured() || !m.billing) throw new UserError("We cannot send a bill from here yet. Please try again later.");
  if (!(await allowShared(driver, `bill-request:${m.tenantId}`, 3, HOUR))) throw new UserError("A bill was sent a moment ago. Please check your email, including the spam folder.");
  const a = m.billing, billing = s.billing_email?.trim();
  const quote = await quoteTax(driver, m, a.priceCents, a.currency, 1);
  const rate = Number(s.pkr_per_usd);
  const mail = buildBillMail({
    to: requesterEmail, replyTo: billing || undefined, orgName: m.tenantName ?? "Your organization", reference: paymentReference(m.tenantId),
    date: new Date().toISOString().slice(0, 10), priceText: formatPrice(a.priceCents, a.currency),
    tax: quote ? { result: quote.result, currency: quote.snapshot.currency ?? "PKR", authority: quote.snapshot.buyer.authority } : null,
    pkrEstimate: !quote && a.currency === "USD" && rate > 0 ? Math.round((a.priceCents / 100) * rate) : null,
    seller: s.company_details?.trim() || "Fleet OTG", bankDetails: bank, paymentNote: s.payment_note?.trim() || undefined, siteUrl: SITE_URL,
  });
  await sendMail(mail);
  // the owner's copy: who asked, which reference, no need to repeat the bank account
  if (billing) await sendMail({ to: billing, replyTo: requesterEmail, subject: `Bill sent to ${m.tenantName ?? "an organization"} (${paymentReference(m.tenantId)})`, text: `${m.tenantName ?? "An organization"} asked for a bill. It was emailed to ${requesterEmail}.\nPayment reference: ${paymentReference(m.tenantId)}`, html: `<p>${(m.tenantName ?? "An organization").replace(/[<>&]/g, "")} asked for a bill. It was emailed to ${requesterEmail.replace(/[<>&]/g, "")}.</p><p>Payment reference: <b>${paymentReference(m.tenantId)}</b></p>` });
  return `Thank you. We sent the bill to ${requesterEmail}.`;
}
