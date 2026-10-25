import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { vendorGetOrder } from "@/lib/vendorflow/service";
import { Panel, Pill, Plate, money } from "@/components/ui";
import { dayMonth } from "@/lib/labels";
import { VendorStepper } from "../../stepper";
import { CompleteForm, InvoiceForm, StartButton } from "./forms";

export default function OrderPage({ params }: PageProps<"/w/[slug]/vendor/orders/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const INV_LABEL: Record<string, { text: string; tone: "ok" | "warn" | "info" | "bad" }> = {
  submitted: { text: "Waiting for check", tone: "info" }, verified: { text: "Checked", tone: "ok" }, disputed: { text: "Returned to you", tone: "warn" }, paid: { text: "Paid", tone: "ok" },
};

async function Inner({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const m = await requireMembership(slug);
  const cur = m.currency || "PKR";
  const o = await vendorGetOrder(getDriver(), m, id);
  if (!o) notFound();
  const openInvoice = o.invoices.some((i) => ["submitted", "verified", "paid"].includes(i.status));
  const canInvoice = o.wo_status === "completed" && o.job_status === "completed" && !openInvoice;
  const statusPill = o.job_status === "invoiced" ? <Pill tone="info">Invoice sent</Pill> : ["invoice_verified", "closed"].includes(o.job_status) ? <Pill tone="ok">Invoice checked</Pill>
    : o.wo_status === "issued" ? <Pill tone="info">Ready to start</Pill> : o.wo_status === "in_progress" ? <Pill tone="info">In repair</Pill> : <Pill tone="warn">Work done, send your invoice</Pill>;
  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 p-6 text-zinc-900">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-zinc-500"><a className="underline" href={`/w/${slug}/vendor`}>My work</a> / {o.wo_no}</p>
          <h1 className="text-[22px] font-semibold leading-tight">Work order <span className="font-mono">{o.wo_no}</span></h1>
          <p className="mt-0.5 text-sm text-zinc-500">From {m.tenantName ?? "the fleet office"} · issued {dayMonth(o.issued_at)} · job card <span className="font-mono">{o.job_no}</span></p>
        </div>
        {statusPill}
      </div>
      <VendorStepper jobStatus={o.job_status} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Panel title="What needs fixing" action={<Plate>{o.registration_no}</Plate>}>
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div><dt className="text-xs text-zinc-500">Vehicle</dt><dd className="mt-0.5">{[o.make, o.model, o.year].filter(Boolean).join(" ")}</dd></div>
              <div><dt className="text-xs text-zinc-500">Priority</dt><dd className="mt-0.5 capitalize">{o.priority}</dd></div>
              <div><dt className="text-xs text-zinc-500">Approved amount</dt><dd className="mt-0.5 font-mono">{cur} {money(o.approved_amount)}</dd></div>
            </dl>
            <p className="mt-4 text-xs font-medium text-zinc-500">Reported problem</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{o.cause_text}</p>
          </Panel>

          <Panel title="Approved quotation" flush>
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Item</th><th>Type</th><th className="text-right">Qty</th><th className="text-right">Unit price</th><th className="px-5 text-right">Total</th></tr></thead>
              <tbody>{o.quotation_lines.map((l) => (
                <tr key={l.line_id} className="border-t border-zinc-100"><td className="px-5 py-3">{l.description}</td><td className="py-3 capitalize">{l.kind}</td>
                  <td className="py-3 text-right font-mono">{Number(l.qty)}</td><td className="py-3 text-right font-mono">{money(l.unit_cost)}</td><td className="px-5 py-3 text-right font-mono">{money(Number(l.qty) * Number(l.unit_cost))}</td></tr>))}</tbody>
            </table>
          </Panel>

          {o.wo_status === "issued" && <Panel title="Next step"><StartButton slug={slug} woId={id} /></Panel>}
          {o.wo_status === "in_progress" && <Panel title="Next step"><CompleteForm slug={slug} woId={id} /></Panel>}

          {canInvoice && (
            <Panel title={o.invoices.length ? "Send a corrected invoice" : "Send your invoice"}>
              <InvoiceForm slug={slug} woId={id} prefill={o.quotation_lines.map((l) => ({ kind: l.kind, description: l.description, qty: String(Number(l.qty)), unit_cost: String(Number(l.unit_cost)), ref: l.line_id }))} />
            </Panel>
          )}
        </div>

        <aside className="space-y-5">
          <Panel title="Your invoices">
            {o.invoices.length === 0 ? <p className="text-sm text-zinc-500">{o.wo_status === "completed" ? "You have not sent an invoice yet." : "You can send your invoice once the work is marked done."}</p> : (
              <ul className="space-y-3 text-sm">
                {o.invoices.map((i) => {
                  const st = INV_LABEL[i.status] ?? { text: i.status, tone: "info" as const };
                  return (
                    <li key={i.invoice_id} className="border-b border-zinc-100 pb-3 last:border-0 last:pb-0">
                      <p className="flex items-center justify-between gap-2"><span className="font-mono font-medium">{i.invoice_no}</span><Pill tone={st.tone}>{st.text}</Pill></p>
                      <p className="mt-1 font-mono text-xs text-zinc-500">{money(i.amount)}{i.status === "verified" && i.payable_amount && ` · payable ${money(i.payable_amount)}`}</p>
                      {i.return_note && <p className="mt-1 rounded bg-amber-100 p-2 text-xs text-amber-800">Returned: {i.return_note}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          <Panel title="Rules for this order">
            <p className="rounded-md bg-amber-100 p-3 text-sm text-amber-800">Extra work found after you open the vehicle needs a new approval before you do it. The invoice is checked against the approved quotation.</p>
          </Panel>
        </aside>
      </div>
    </main>
  );
}
