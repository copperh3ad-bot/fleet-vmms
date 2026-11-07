// The bill a customer gets by email when its administrator presses "Request bill" (Billing page). It is the amount to send,
// the payment reference and the bank account, in one message. It is a request for payment, not the tax invoice: that is still
// issued when the payment is confirmed. Pure text building, no sending. The bank details live only in Admin, Settings and
// leave the system only in this email.
import { fmtMinor, type TaxResult } from "./tax";
import { dmy } from "@/lib/format/date";
import type { Mail } from "@/lib/email/templates";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export type BillInput = {
  to: string; replyTo?: string; orgName: string; reference: string; date: string;
  /** one month at the plan price, e.g. "USD 149.00" */ priceText: string;
  /** the figures worked out with tax, when a tax scenario applies */ tax?: { result: TaxResult; currency: string; authority: string } | null;
  /** a rupee estimate for a dollar price when there is no tax figure, in whole rupees */ pkrEstimate?: number | null;
  seller: string; bankDetails: string; paymentNote?: string; siteUrl: string;
};

export const billNumber = (reference: string, date: string) => `BILL-${reference.replace(/^FVM-/, "")}-${date.replace(/-/g, "")}`;

export function buildBillMail(i: BillInput): Mail {
  const no = billNumber(i.reference, i.date);
  const rows: [string, string][] = [["Fleet OTG subscription, 1 month", i.priceText]];
  let pay = i.priceText;
  if (i.tax) {
    const r = i.tax.result, c = i.tax.currency;
    rows[0] = ["Fleet OTG subscription, 1 month", fmtMinor(r.subtotalMinor, c)];
    if (r.salesTaxMinor > 0) rows.push([`${i.tax.authority} ${r.salesTaxPct}%`, fmtMinor(r.salesTaxMinor, c)]);
    const kept = r.whtIncomeMinor + r.whtSalesMinor;
    rows.push([kept > 0 ? "Invoice total" : "Total to send", fmtMinor(r.totalMinor, c)]);
    pay = fmtMinor(r.totalMinor, c);
    if (kept > 0) {   // a customer that withholds keeps tax back and pays it to the government for us, so it sends less
      rows.push(["You keep back and pay to the government for us", `−${fmtMinor(kept, c)}`], ["Send us", fmtMinor(r.netExpectedMinor, c)]);
      pay = fmtMinor(r.netExpectedMinor, c);
    }
  } else if (i.pkrEstimate) rows.push(["About", `Rs ${i.pkrEstimate.toLocaleString("en-US")}`]);
  const subject = `Your Fleet OTG bill ${no}`;
  const steps = [
    `Send ${pay} to the account below.`,
    `Write ${i.reference} in the transfer's reference or description.`,
    `Open Billing in your workspace, press "I have paid" and add your receipt.`,
  ];
  const text = [
    `Bill ${no}`, `Date: ${dmy(i.date)}`, `For: ${i.orgName}`, `Payment reference: ${i.reference}`, "",
    ...rows.map(([k, v]) => `${k}: ${v}`), "",
    ...steps.map((s, n) => `${n + 1}. ${s}`), "", "Pay to:", i.bankDetails, ...(i.paymentNote ? ["", i.paymentNote] : []), "",
    "This is a request for payment. Your invoice is issued when we confirm the payment.", "", i.seller, i.siteUrl,
  ].join("\n");
  const last = rows.length - 1;
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f3f5f6;font-family:Arial,Helvetica,sans-serif;color:#14202b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#15191d;padding:18px 24px"><img src="${esc(i.siteUrl)}/fleetotg-logo.png" alt="Fleet OTG" width="160" height="40" style="display:block;border:0"></td></tr>
<tr><td style="padding:28px 24px">
<h1 style="margin:0 0 6px;font-size:20px">Bill ${esc(no)}</h1>
<p style="margin:0 0 16px;font-size:14px;color:#3d4a55">${esc(dmy(i.date))} · ${esc(i.orgName)}<br>Payment reference: <b>${esc(i.reference)}</b></p>
<table role="presentation" width="100%" cellpadding="6" cellspacing="0" style="font-size:15px;border-top:1px solid #dde3e7">${rows.map(([k, v], n) => { const b = n === last && i.tax ? ' style="font-weight:bold"' : ""; return `<tr style="border-bottom:1px solid #dde3e7"><td${b}>${esc(k)}</td><td align="right"${b}>${esc(v)}</td></tr>`; }).join("")}</table>
<ol style="margin:18px 0 12px;padding-left:20px;font-size:15px;line-height:1.5">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
<p style="margin:0 0 4px;font-size:14px;color:#3d4a55">Pay to:</p>
<pre style="margin:0 0 14px;padding:12px;background:#f3f5f6;border-radius:6px;font-size:14px;white-space:pre-wrap">${esc(i.bankDetails)}</pre>
${i.paymentNote ? `<p style="margin:0 0 14px;font-size:14px;color:#3d4a55">${esc(i.paymentNote).replace(/\n/g, "<br>")}</p>` : ""}
<p style="margin:0;font-size:13px;color:#6b7782">This is a request for payment. Your invoice is issued when we confirm the payment.</p>
<p style="margin:14px 0 0;font-size:13px;color:#6b7782;white-space:pre-line">${esc(i.seller)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { to: i.to, replyTo: i.replyTo, subject, text, html };
}
