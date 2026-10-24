import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { formatPrice } from "@/lib/billing/offer";
import { getInvoice } from "@/lib/billing/payments";
import { loadPlatformSettings } from "@/lib/billing/settings";
import { fmtMinor } from "@/lib/billing/tax";
import { PrintButton } from "./print-button";

export default function InvoicePage({ params }: PageProps<"/w/[slug]/billing/invoices/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const dmy = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

async function Inner({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const m = await requireMembership(slug, { allowLocked: true });   // an invoice is a record you may always open
  const driver = getDriver();
  const [inv, settings] = await Promise.all([getInvoice(driver, m, id), loadPlatformSettings(driver)]);
  if (!inv) notFound();
  return (
    <main className="mx-auto max-w-3xl p-6 text-zinc-900">
      <div className="mb-4 flex items-center justify-between print:hidden"><a href={`/w/${slug}/billing`} className="text-sm underline">Back to billing</a><PrintButton /></div>
      <article className="rounded-xl border border-zinc-200 bg-white p-8 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div><h1 className="text-2xl font-semibold">{inv.tax?.snapshot.scenario?.title ?? (inv.tax ? "Tax invoice" : "Invoice")}</h1><p className="mt-1 font-mono text-lg">{inv.number}</p></div>
          <div className="text-sm sm:text-right">
            <p className="font-semibold">{inv.tax?.snapshot.seller.legal_name ?? "Fleet OTG"}</p>
            {inv.tax && [inv.tax.snapshot.seller.ntn && `NTN ${inv.tax.snapshot.seller.ntn}`, inv.tax.snapshot.seller.tax_reg && `Sales tax reg. ${inv.tax.snapshot.seller.tax_reg}`, inv.tax.snapshot.seller.pseb_no && `PSEB ${inv.tax.snapshot.seller.pseb_no}`].filter(Boolean).length > 0 && <p className="text-zinc-600">{[inv.tax.snapshot.seller.ntn && `NTN ${inv.tax.snapshot.seller.ntn}`, inv.tax.snapshot.seller.tax_reg && `Sales tax reg. ${inv.tax.snapshot.seller.tax_reg}`, inv.tax.snapshot.seller.pseb_no && `PSEB ${inv.tax.snapshot.seller.pseb_no}`].filter(Boolean).join(" · ")}</p>}
            {settings.company_details && <p className="whitespace-pre-wrap text-zinc-600">{settings.company_details}</p>}
          </div>
        </header>
        <dl className="mt-8 grid gap-6 text-sm sm:grid-cols-3">
          <div><dt className="text-zinc-500">Billed to</dt><dd className="mt-1 font-medium">{inv.tax?.snapshot.buyer.legal_name ?? inv.billed_to}</dd>
            {inv.tax && (inv.tax.snapshot.buyer.ntn || inv.tax.snapshot.buyer.strn || inv.tax.snapshot.buyer.address) && <dd className="text-zinc-600">{[inv.tax.snapshot.buyer.ntn && `NTN ${inv.tax.snapshot.buyer.ntn}`, inv.tax.snapshot.buyer.strn && `STRN ${inv.tax.snapshot.buyer.strn}`].filter(Boolean).join(" · ")}{inv.tax.snapshot.buyer.address ? <span className="block whitespace-pre-wrap">{inv.tax.snapshot.buyer.address}</span> : null}</dd>}</div>
          <div><dt className="text-zinc-500">Issued</dt><dd className="mt-1">{dmy(inv.issued_at)}</dd></div>
          <div><dt className="text-zinc-500">Status</dt><dd className="mt-1 font-medium text-green-800">Paid</dd></div>
        </dl>
        <table className="mt-8 w-full text-left text-sm">
          <thead className="border-b border-zinc-300 text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="py-2">Description</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            <tr className="border-b border-zinc-100"><td className="py-3">Fleet OTG subscription, {inv.months} {inv.months === 1 ? "month" : "months"}<br /><span className="text-zinc-500">{dmy(inv.period_start)} to {dmy(inv.period_end)}</span></td><td className="py-3 text-right font-mono">{formatPrice(Number(inv.amount_cents), inv.currency)}</td></tr>
            {inv.tax && (() => {
              const t = inv.tax, ccy = t.snapshot.currency ?? "PKR", none = t.snapshot.scenario?.mode === "none", kept = Number(t.wht_income_minor) + Number(t.wht_sales_minor);
              return none ? (
                <tr className="border-b border-zinc-100"><td className="py-2 text-zinc-600" colSpan={2}>{t.snapshot.scenario?.note ?? "No tax is charged on this invoice."}</td></tr>
              ) : (
                <>
                  <tr className="border-b border-zinc-100"><td className="py-2 text-zinc-600">{ccy === "PKR" ? `Price ${formatPrice(Number(inv.amount_cents), inv.currency)} at Rs ${Number(t.pkr_per_usd)} to the dollar${t.snapshot.fx ? ` (${t.snapshot.fx.source === "settings" ? "rate in force" : `rate of ${dmy(t.snapshot.fx.rate_date)}`}, payment of ${dmy(t.snapshot.fx.payment_date)})` : ""}` : "Price before tax"}</td><td className="py-2 text-right font-mono">{fmtMinor(t.subtotal_minor, ccy)}</td></tr>
                  <tr className="border-b border-zinc-100"><td className="py-2 text-zinc-600">{t.snapshot.buyer.authority} {Number(t.sales_tax_pct)}%</td><td className="py-2 text-right font-mono">{fmtMinor(t.sales_tax_minor, ccy)}</td></tr>
                  <tr className="border-b border-zinc-100"><td className="py-3 font-semibold">Invoice total</td><td className="py-3 text-right font-mono font-semibold">{fmtMinor(t.total_minor, ccy)}</td></tr>
                  {kept > 0 && (
                    <>
                      <tr><td className="py-2 text-zinc-600">Tax withheld by the customer and paid to the government on our behalf (income tax {fmtMinor(t.wht_income_minor, ccy)}{Number(t.wht_sales_minor) > 0 ? `, sales tax ${fmtMinor(t.wht_sales_minor, ccy)}` : ""})</td><td className="py-2 text-right font-mono">−{fmtMinor(kept, ccy)}</td></tr>
                      <tr className="border-b border-zinc-100"><td className="py-2 font-medium">Payable after withholding</td><td className="py-2 text-right font-mono font-medium">{fmtMinor(t.net_expected_minor, ccy)}</td></tr>
                    </>
                  )}
                </>
              );
            })()}
            <tr><td className="py-3 font-semibold">{inv.tax && inv.tax.snapshot.scenario?.mode !== "none" ? "Subscription value (USD)" : "Total paid"}</td><td className="py-3 text-right font-mono font-semibold">{formatPrice(Number(inv.amount_cents), inv.currency)}</td></tr>
          </tbody>
        </table>
        {inv.received_minor && inv.received_currency && <p className="mt-4 text-sm text-zinc-600">Received by bank transfer: {formatPrice(Number(inv.received_minor), inv.received_currency)}.</p>}
        {inv.tax && Number(inv.tax.wht_income_minor) + Number(inv.tax.wht_sales_minor) > 0 && (
          <p className="mt-2 text-sm text-zinc-600 print:hidden">{inv.tax.certificate ? `Withholding certificate ${inv.tax.certificate.certificate_no} received ${dmy(inv.tax.certificate.received_on)}.` : "We are waiting for the withholding certificate for the tax that was kept back."}{" "}
            <a className="text-sky-800 underline" href={`/w/${slug}/billing/invoices/${id}/certificate`}>{inv.tax.certificate?.certificate_no.startsWith("WHC-") ? "Open the certificate" : "Prepare the certificate"}</a></p>
        )}
        {inv.note && <p className="mt-2 text-sm text-zinc-600">{inv.note}</p>}
      </article>
    </main>
  );
}
