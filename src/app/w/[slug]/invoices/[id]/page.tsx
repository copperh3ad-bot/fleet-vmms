import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { Card } from "@/components/form";
import { getInvoiceCheck } from "@/lib/vendorflow/service";
import { DecisionForm } from "./form";

export default function InvoicePage({ params }: PageProps<"/w/[slug]/invoices/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const money = (s: string | number) => Number(s).toLocaleString("en-US", { maximumFractionDigits: 2 });

async function Inner({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const m = await requireMembership(slug);
  const inv = await getInvoiceCheck(getDriver(), m, id);
  if (!inv) notFound();
  const over = Number(inv.variance) > 0;
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 text-zinc-900">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Invoice {inv.invoice_no}</h1>
        <a href={`/w/${slug}/invoices`} className="ml-auto text-sm text-sky-800 underline">All invoices</a>
      </div>
      <Card>
        <p className="text-sm"><a className="text-sky-800 hover:underline" href={`/w/${slug}/job-cards/${inv.job_card_id}`}>{inv.job_no}</a> · {inv.registration_no} · {inv.vendor_name} · {inv.invoice_date}</p>
        <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
          <div><dt className="text-xs font-medium text-zinc-600">Approved</dt><dd className="tabular-nums">{money(inv.approved_amount)}</dd></div>
          <div><dt className="text-xs font-medium text-zinc-600">Invoiced</dt><dd className="tabular-nums">{money(inv.amount)}</dd></div>
          <div><dt className="text-xs font-medium text-zinc-600">Difference</dt><dd className={`tabular-nums ${over ? "font-medium text-red-800" : ""}`}>{over ? "+" : ""}{money(inv.variance)}{inv.variance_pct ? ` (${inv.variance_pct}%)` : ""}</dd></div>
        </dl>
        {Number(inv.tax_amount) > 0 && <p className="mt-2 text-xs text-zinc-500">Tax {money(inv.tax_amount)} is extra and not part of this comparison.</p>}
        {inv.unapproved_lines > 0 && <p role="status" className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{inv.unapproved_lines} line{inv.unapproved_lines > 1 ? "s were" : " was"} not in the approved quotation.</p>}
      </Card>
      <Card title="Lines">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-zinc-500"><tr><th className="py-1 pr-3">Description</th><th className="pr-3 text-right">Qty</th><th className="pr-3 text-right">Unit cost</th><th className="pr-3 text-right">Amount</th><th>In quotation</th></tr></thead>
          <tbody>{inv.lines.map((l) => (
            <tr key={l.id} className={`border-t border-zinc-100 ${l.approved ? "" : "bg-amber-50"}`}>
              <td className="py-1 pr-3">{l.description}</td><td className="pr-3 text-right tabular-nums">{Number(l.qty)}</td><td className="pr-3 text-right tabular-nums">{money(l.unit_cost)}</td>
              <td className="pr-3 text-right tabular-nums">{money(Number(l.qty) * Number(l.unit_cost))}</td><td>{l.approved ? "Yes" : "No"}</td>
            </tr>))}</tbody>
        </table>
      </Card>
      {inv.status === "submitted"
        ? <Card title="Decision"><DecisionForm slug={slug} id={id} approved={money(inv.approved_amount)} invoiced={money(inv.amount)} /></Card>
        : <Card title="Decision"><p className="text-sm">{inv.status === "disputed" ? "Returned to the vendor" : "Checked"}{inv.payable_amount ? `, payable ${money(inv.payable_amount)}` : ""}.{inv.decision_note ? ` Note: ${inv.decision_note}` : ""}</p></Card>}
    </main>
  );
}
