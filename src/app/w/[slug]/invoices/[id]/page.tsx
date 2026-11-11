import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { adminBlockedFromOthers, permissionsOf } from "@/lib/auth/can";
import { REPEAT_PAYERS } from "@/lib/jobcards/schemas";
import { getDriver } from "@/lib/db";
import { getInvoiceReview, listCommercialFiles, type CompareRow } from "@/lib/vendorflow/service";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { Panel, Pill, Plate, btn, money } from "@/components/ui";
import { dayMonth } from "@/lib/labels";
import { DecisionForm } from "./form";
import { getPayments } from "@/lib/payments/service";
import { PaymentsPanel } from "@/components/payments-panel";

export default function InvoicePage({ params }: PageProps<"/w/[slug]/invoices/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const CHECK: Record<CompareRow["check"], { text: string; tone: "ok" | "bad" | "warn" | "neutral" } | null> = {
  ok: null, not_approved: { text: "Not approved", tone: "bad" }, qty: { text: "Quantity changed", tone: "warn" }, price: { text: "Price changed", tone: "warn" }, not_billed: { text: "Not billed", tone: "neutral" },
};
const cell = (n: number | null) => (n === null ? "–" : money(n));

async function Inner({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const m = await requireMembership(slug, { fullScope: true });
  const cur = m.currency || "PKR";
  const driver = getDriver();
  const inv = await getInvoiceReview(driver, m, id);
  if (!inv) notFound();
  const files = await listCommercialFiles(driver, await supabaseBlobStore(), m, "invoice", id);
  const payments = await getPayments(driver, m, "workshop", id);
  const canVerify = (await permissionsOf(driver, m)).has("invoice.verify");
  const blockedCheck = canVerify && inv.status === "submitted" ? await adminBlockedFromOthers(driver, m, "invoice.verify") : false;   // company rule (ADR-088): the database refuses, so no form is shown
  const to = (p: string) => `/w/${slug}/${p}`;
  const bad = inv.comparison.filter((r) => r.check === "not_approved");
  const changed = inv.comparison.filter((r) => r.check === "qty" || r.check === "price");
  const over = inv.totals.over > 0;
  const received = dayMonth(inv.invoice_date);

  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-zinc-500"><a className="underline" href={to("invoices")}>Invoices</a> / {inv.invoice_no}</p>
          <h1 className="text-[22px] font-semibold leading-tight">Verify invoice <span className="font-mono">{inv.invoice_no}</span></h1>
          <p className="mt-0.5 text-sm text-zinc-500">Job card <a className="font-mono hover:underline" href={to(`job-cards/${inv.job_card_id}`)}>{inv.job_no}</a> · {inv.vendor_name} · received {received}</p>
        </div>
        {inv.next ? <a className={btn} href={to(`invoices/${inv.next}`)}>Next invoice ({inv.waiting} waiting)</a> : <span className={`${btn} opacity-50`} aria-disabled="true">No other invoice waiting</span>}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-5">
          <Panel title={`Quotation against invoice (${cur})`} flush>
            <div className="overflow-x-auto"><table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Item</th><th>Type</th><th className="text-right">Quoted</th><th className="text-right">Approved</th><th className="text-right">Invoiced</th><th className="px-5">Check</th></tr></thead>
              <tbody>{inv.comparison.map((r) => {
                const c = CHECK[r.check];
                return (
                  <tr key={r.key} className={`border-t border-zinc-100 ${r.check === "not_approved" ? "bg-red-50" : r.check === "ok" ? "" : "bg-amber-50"}`}>
                    <td className="px-5 py-3">{r.item}</td><td className="py-3 capitalize">{r.kind}</td>
                    <td className="py-3 text-right font-mono">{cell(r.quoted)}</td><td className="py-3 text-right font-mono">{cell(r.approved)}</td><td className="py-3 text-right font-mono">{cell(r.invoiced)}</td>
                    <td className="px-5 py-3">{c ? <Pill tone={c.tone}>{c.text}</Pill> : <span className="text-zinc-600">—</span>}</td>
                  </tr>);
              })}</tbody>
            </table></div>
            <div className="flex flex-wrap items-baseline justify-end gap-x-8 gap-y-1 border-t border-zinc-100 px-5 py-4 text-sm">
              <span className="text-zinc-500">Approved <span className="ml-1 font-mono font-semibold text-zinc-900">{money(inv.totals.approved)}</span></span>
              <span className="text-zinc-500">Invoiced <span className="ml-1 font-mono font-semibold text-zinc-900">{money(inv.totals.invoiced)}</span></span>
              {over ? <span className="font-mono font-semibold text-red-700">Over by {money(inv.totals.over)}{inv.totals.overPct !== null && ` (${inv.totals.overPct}%)`}</span>
                : inv.totals.over < 0 ? <span className="font-mono text-zinc-700">Under by {money(-inv.totals.over)}</span> : <span className="text-green-800">Matches the approved amount</span>}
            </div>
          </Panel>

          {bad.length > 0 && (
            <p role="status" className="rounded-md bg-red-50 p-4 text-sm text-red-800 border border-red-200">
              <strong>{bad.length === 1 ? "One line was never approved." : `${bad.length} lines were never approved.`}</strong> The workshop billed {bad.map((b) => b.item.toLowerCase()).join(", ")} without asking.
              Pay the approved {money(inv.totals.approved)}, or ask the workshop to explain. The {money(bad.reduce((s, b) => s + (b.invoiced ?? 0), 0))} is not added to the vehicle cost until you decide.
            </p>
          )}
          {changed.length > 0 && <p role="status" className="rounded-md bg-amber-100 p-4 text-sm text-amber-800"><strong>{changed.length === 1 ? "One approved line changed." : `${changed.length} approved lines changed.`}</strong> Check the quantity or price against the quotation before paying.</p>}

          <Panel title="Proof of work">
            {files.length === 0 ? <p className="text-sm text-zinc-500">The workshop attached no files to this invoice.</p> : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">{files.map((f) => (
                <li key={f.id} className="space-y-1 text-xs">
                  {f.url && f.mime_type?.startsWith("image/") && f.mime_type !== "image/heic"
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <a href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={f.file_name} loading="lazy" className="h-24 w-full rounded-md border border-zinc-200 object-cover" /></a>
                    : <a href={f.url ?? undefined} target="_blank" rel="noreferrer" className="flex h-24 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 p-2 text-center text-brand">{f.mime_type === "application/pdf" ? "PDF" : "File"}</a>}
                  <p className="truncate text-zinc-500" title={f.file_name}>{f.file_name.replace(/^[0-9a-f-]{36}-/, "")}</p>
                </li>))}</ul>
            )}
          </Panel>
        </div>

        <aside className="space-y-5">
          <Panel title="Job">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
              <div className="col-span-2"><dt className="text-xs text-zinc-500">Vehicle</dt><dd className="mt-0.5 flex items-center gap-2"><a href={to(`vehicles/${inv.vehicle_id}`)}><Plate>{inv.registration_no}</Plate></a> {inv.vehicle_label}</dd></div>
              <div><dt className="text-xs text-zinc-500">Driver</dt><dd className="mt-0.5">{inv.driver ?? "—"}</dd></div>
              <div><dt className="text-xs text-zinc-500">Reason</dt><dd className="mt-0.5">{inv.reason}</dd></div>
              <div><dt className="text-xs text-zinc-500">Approved by</dt><dd className="mt-0.5">{inv.approver_name ?? "—"}{inv.approved_on && <>, {dayMonth(inv.approved_on)}</>}</dd></div>
              <div><dt className="text-xs text-zinc-500">Work order</dt><dd className="mt-0.5 font-mono">{inv.wo_no}</dd></div>
            </dl>
          </Panel>

          {inv.repeat && (
            <p role="status" className="rounded-md bg-amber-100 p-3 text-sm text-amber-800">
              This job repeats {inv.repeat.of}. The approver said who pays: <strong>{REPEAT_PAYERS[inv.repeat.payer] ?? inv.repeat.payer}</strong>. Reason: {inv.repeat.reason}
              {inv.repeat.payer === "workshop" && " Check whether the amount payable should be less than the invoice."}
            </p>
          )}

          <Panel title="Your decision">
            {inv.status === "submitted" && !canVerify ? (
              <p className="text-sm text-zinc-600">Waiting for Finance to check this invoice.</p>
            ) : inv.status !== "submitted" ? (
              <p className="text-sm">{inv.status === "disputed" ? "Returned to the workshop" : "Checked"}{inv.payable_amount ? `, payable ${money(Number(inv.payable_amount))}` : ""}.{inv.decision_note ? ` Note: ${inv.decision_note}` : ""}</p>
            ) : blockedCheck ? (
              <p role="status" className="rounded-md bg-amber-100 p-3 text-sm text-amber-800">Your company rule keeps the administrator from checking invoices while Finance or another approver is active. They check this one.</p>
            ) : inv.blocked ? (
              <p role="status" className="rounded-md bg-amber-100 p-3 text-sm text-amber-800">{inv.blocked.by === "approver" ? `You approved this job card, so you cannot check its invoice. Ask someone else in finance.` : `You raised this job card, so you cannot check its invoice. Ask someone else in finance.`}</p>
            ) : (
              <div className="space-y-3">
                <p className="rounded-md bg-amber-100 p-3 text-sm text-amber-800">You approved neither the request nor the quote, so you can check this.{inv.approver_name ? ` ${inv.approver_name} cannot, because they approved it.` : ""}</p>
                <DecisionForm slug={slug} id={id} approved={money(inv.totals.approved)} invoiced={money(inv.totals.invoiced)} currency={cur} />
              </div>
            )}
          </Panel>

          {inv.status !== "disputed" && (
            <Panel title="Payment">
              <PaymentsPanel slug={slug} summary={payments} currency={cur} />
            </Panel>
          )}
        </aside>
      </div>
    </main>
  );
}
