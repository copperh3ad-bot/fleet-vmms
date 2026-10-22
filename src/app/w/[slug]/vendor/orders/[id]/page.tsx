import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { Card } from "@/components/form";
import { vendorGetOrder } from "@/lib/vendorflow/service";
import { CompleteForm, InvoiceForm, StartButton } from "./forms";

export default function OrderPage({ params }: PageProps<"/w/[slug]/vendor/orders/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const money = (s: string) => Number(s).toLocaleString("en-US", { maximumFractionDigits: 2 });
const INV_LABEL: Record<string, string> = { submitted: "Waiting for check", verified: "Checked", disputed: "Returned to you", paid: "Paid" };

async function Inner({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const m = await requireMembership(slug);
  const o = await vendorGetOrder(getDriver(), m, id);
  if (!o) notFound();
  const openInvoice = o.invoices.some((i) => ["submitted", "verified", "paid"].includes(i.status));
  const canInvoice = o.wo_status === "completed" && o.job_status === "completed" && !openInvoice;
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 text-zinc-900">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{o.wo_no}</h1>
        <a href={`/w/${slug}/vendor`} className="ml-auto text-sm text-sky-800 underline">My work</a>
      </div>

      <Card title="The job">
        <p className="text-sm font-medium">{[o.registration_no, o.make, o.model, o.year].filter(Boolean).join(" · ")} <span className="font-normal text-zinc-500">({o.job_no})</span></p>
        <p className="mt-2 whitespace-pre-wrap text-sm">{o.cause_text}</p>
        <p className="mt-2 text-sm">Approved amount <span className="font-medium tabular-nums">{money(o.approved_amount)}</span></p>
      </Card>

      <Card title="Approved quotation">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-zinc-500"><tr><th className="py-1 pr-3">Description</th><th className="pr-3 text-right">Qty</th><th className="pr-3 text-right">Unit cost</th><th className="text-right">Amount</th></tr></thead>
          <tbody>{o.quotation_lines.map((l) => (
            <tr key={l.line_id} className="border-t border-zinc-100"><td className="py-1 pr-3">{l.description}</td><td className="pr-3 text-right tabular-nums">{Number(l.qty)}</td><td className="pr-3 text-right tabular-nums">{money(l.unit_cost)}</td><td className="text-right tabular-nums">{money(String(Number(l.qty) * Number(l.unit_cost)))}</td></tr>
          ))}</tbody>
        </table>
      </Card>

      {o.wo_status === "issued" && <Card title="Next step"><StartButton slug={slug} woId={id} /></Card>}
      {o.wo_status === "in_progress" && <Card title="Next step"><CompleteForm slug={slug} woId={id} /></Card>}

      {o.invoices.length > 0 && (
        <Card title="Your invoices">
          <ul className="space-y-2 text-sm">
            {o.invoices.map((i) => (
              <li key={i.invoice_id} className="border-l-2 border-zinc-200 pl-3">
                <p><span className="font-medium">{i.invoice_no}</span> · {money(i.amount)} · <span className="text-zinc-600">{INV_LABEL[i.status] ?? i.status}</span></p>
                {i.status === "verified" && i.payable_amount && <p className="text-zinc-700">Payable {money(i.payable_amount)}</p>}
                {i.return_note && <p className="text-amber-900">Returned: {i.return_note}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canInvoice && (
        <Card title={o.invoices.length ? "Send a corrected invoice" : "Send your invoice"}>
          <InvoiceForm slug={slug} woId={id} prefill={o.quotation_lines.map((l) => ({ kind: l.kind, description: l.description, qty: String(Number(l.qty)), unit_cost: String(Number(l.unit_cost)), ref: l.line_id }))} />
        </Card>
      )}
    </main>
  );
}
