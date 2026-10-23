import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { formatPrice } from "@/lib/billing/offer";
import { getInvoice } from "@/lib/billing/payments";
import { loadPlatformSettings } from "@/lib/billing/settings";
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
          <div><h1 className="text-2xl font-semibold">Invoice</h1><p className="mt-1 font-mono text-lg">{inv.number}</p></div>
          <div className="text-sm sm:text-right"><p className="font-semibold">Fleet VMMS</p>{settings.company_details && <p className="whitespace-pre-wrap text-zinc-600">{settings.company_details}</p>}</div>
        </header>
        <dl className="mt-8 grid gap-6 text-sm sm:grid-cols-3">
          <div><dt className="text-zinc-500">Billed to</dt><dd className="mt-1 font-medium">{inv.billed_to}</dd></div>
          <div><dt className="text-zinc-500">Issued</dt><dd className="mt-1">{dmy(inv.issued_at)}</dd></div>
          <div><dt className="text-zinc-500">Status</dt><dd className="mt-1 font-medium text-green-800">Paid</dd></div>
        </dl>
        <table className="mt-8 w-full text-left text-sm">
          <thead className="border-b border-zinc-300 text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="py-2">Description</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            <tr className="border-b border-zinc-100"><td className="py-3">Fleet VMMS subscription, {inv.months} {inv.months === 1 ? "month" : "months"}<br /><span className="text-zinc-500">{dmy(inv.period_start)} to {dmy(inv.period_end)}</span></td><td className="py-3 text-right font-mono">{formatPrice(Number(inv.amount_cents), inv.currency)}</td></tr>
            <tr><td className="py-3 font-semibold">Total paid</td><td className="py-3 text-right font-mono font-semibold">{formatPrice(Number(inv.amount_cents), inv.currency)}</td></tr>
          </tbody>
        </table>
        {inv.received_minor && inv.received_currency && <p className="mt-4 text-sm text-zinc-600">Received by bank transfer: {formatPrice(Number(inv.received_minor), inv.received_currency)}.</p>}
        {inv.note && <p className="mt-2 text-sm text-zinc-600">{inv.note}</p>}
      </article>
    </main>
  );
}
