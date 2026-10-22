import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { getJobCard, getReviewContext, listActiveVendors, listReasonCodes } from "@/lib/jobcards/service";
import { STATUS_LABEL, StatusBadge, Stepper } from "../status";
import { listJobCardAttachments } from "@/lib/jobcards/attachments";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { getJobFlow } from "@/lib/vendorflow/service";
import { Panel, Pill, Plate, btn, money } from "@/components/ui";
import { ClosePanel, DraftPanel, VendorPanel } from "./panel";
import { DecisionForm } from "./decision";
import { QuoteDecision } from "./quote-decision";
import { RemoveFile, UploadForm } from "./files";
import { dayMonth, plural } from "@/lib/labels";

export default function JobCardPage({ params, searchParams }: PageProps<"/w/[slug]/job-cards/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const stamp = (s: string) => new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false }).replace(",", "");

async function Inner({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const note = typeof sp.note === "string" ? sp.note.slice(0, 300) : "";
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [c, perms] = await Promise.all([getJobCard(driver, m, id), permissionsOf(driver, m)]);
  if (!c) notFound();
  const to = (p: string) => `/w/${slug}/${p}`;

  const canDecide = c.status === "submitted" && perms.has("jobcard.approve") && !c.requester_is_me;
  const canAssign = c.status === "approved" && perms.has("jobcard.assign_vendor");
  const canEdit = c.mine && perms.has("jobcard.create") && ["draft", "returned_for_edit"].includes(c.status);
  const commercial = perms.has("jobcard.read_all") && !["draft", "submitted", "returned_for_edit", "rejected", "cancelled", "approved"].includes(c.status);
  const flow = commercial ? await getJobFlow(driver, m, id) : null;
  const canDecideQuote = c.status === "quotation_received" && perms.has("quotation.approve") && !c.requester_is_me;
  const canClose = c.status === "invoice_verified" && perms.has("invoice.verify");
  const [files, ctx, reasons, assignable] = await Promise.all([
    listJobCardAttachments(driver, await supabaseBlobStore(), m, id),
    getReviewContext(driver, m, id),
    canDecide ? listReasonCodes(driver, m) : Promise.resolve([]),
    canAssign ? listActiveVendors(driver, m) : Promise.resolve([]),
  ]);
  const total = c.lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_cost), 0);
  const lastReturn = c.status === "returned_for_edit" ? [...c.events].reverse().find((e) => e.to_status === "returned_for_edit") : null;
  const waiting = c.status === "submitted" ? c.age_days : null;
  const raised = new Date(c.created_at).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false }).replace(",", " at");
  const odo = c.odometer_km ? Number(c.odometer_km) : null;
  const delta = odo !== null && ctx?.previousReading ? odo - ctx.previousReading.km : null;
  const year = new Date().getUTCFullYear();
  const showCrumbQueue = canDecide && ctx?.queue;

  return (
    <main className="space-y-5 p-6 text-zinc-900">
      {note && <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{note}</p>}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-zinc-500"><a className="underline" href={to(showCrumbQueue ? "job-cards?status=submitted" : "job-cards")}>{showCrumbQueue ? "Approval queue" : "Job cards"}</a> / {c.job_no}</p>
          <h1 className="mt-0.5 flex flex-wrap items-center gap-3 text-[22px] font-semibold leading-tight"><span className="font-mono">{c.job_no}</span> {c.reason_label} <StatusBadge status={c.status} />{ctx?.repeat && <Pill tone="warn">Repeat repair</Pill>}</h1>
          <p className="mt-1 text-sm text-zinc-500">Raised by {c.requester_name} on {raised}{waiting !== null && ` · waiting ${plural(waiting, "day")}`}</p>
        </div>
        {ctx?.queue && (
          <div className="flex gap-2">
            {ctx.queue.prev ? <a className={btn} href={to(`job-cards/${ctx.queue.prev}`)}>Previous</a> : <span className={`${btn} opacity-50`} aria-disabled="true">Previous</span>}
            {ctx.queue.next ? <a className={btn} href={to(`job-cards/${ctx.queue.next}`)}>Next in queue</a> : <span className={`${btn} opacity-50`} aria-disabled="true">Next in queue</span>}
          </div>
        )}
      </div>
      <Stepper status={c.status} />

      {lastReturn?.comment && <p role="status" className="rounded-md bg-amber-100 p-3 text-sm text-amber-800"><strong>Sent back{lastReturn.actor_name ? ` by ${lastReturn.actor_name}` : ""}:</strong> {lastReturn.comment}</p>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-5">
          <Panel title="Request" action={<a className={`${btn} h-8`} href={to(`vehicles/${c.vehicle_id}`)}>Open vehicle record</a>}>
            <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
              <div><dt className="text-xs text-zinc-500">Vehicle</dt><dd className="mt-0.5 flex items-center gap-2"><Plate>{c.registration_no}</Plate> <span>{ctx?.vehicle.label}</span></dd></div>
              <div><dt className="text-xs text-zinc-500">Driver</dt><dd className="mt-0.5">{c.custodian_name ?? "Nobody"}{ctx?.vehicle.department && c.custodian_name === ctx.vehicle.holder ? `, ${ctx.vehicle.department}` : ""}</dd></div>
              <div><dt className="text-xs text-zinc-500">Odometer</dt><dd className="mt-0.5 font-mono">{odo !== null ? `${money(odo)} km` : "—"}{delta !== null && ctx?.previousReading && <span className="font-sans text-zinc-500"> ({delta >= 0 ? "+" : ""}{money(delta)} since {dayMonth(ctx.previousReading.read_at)})</span>}</dd></div>
              <div><dt className="text-xs text-zinc-500">Type and priority</dt><dd className="mt-0.5 capitalize">{c.category === "corrective" ? "Repair" : c.category} · {c.priority}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-zinc-500">Reason chosen</dt><dd className="mt-0.5">{c.requested_reason_label}{c.reason_label !== c.requested_reason_label && <span className="text-zinc-500"> · changed to {c.reason_label}{c.approver_name ? ` by ${c.approver_name}` : ""}</span>}</dd></div>
              {c.needed_by && <div><dt className="text-xs text-zinc-500">Needed by</dt><dd className="mt-0.5">{dayMonth(c.needed_by)}</dd></div>}
              {c.approver_name && <div><dt className="text-xs text-zinc-500">Approved by</dt><dd className="mt-0.5">{c.approver_name}</dd></div>}
              {c.vendor_name && <div><dt className="text-xs text-zinc-500">Workshop</dt><dd className="mt-0.5">{c.vendor_name}</dd></div>}
            </dl>
            <div className="mt-4 rounded-md bg-zinc-50 p-4 text-sm"><p className="text-xs text-zinc-500">What the driver wrote</p><p className="mt-1 whitespace-pre-wrap">“{c.cause_text}”</p>{c.description && <p className="mt-2 whitespace-pre-wrap text-zinc-600">{c.description}</p>}</div>
          </Panel>

          <Panel title="Work needed" sub="Estimates from the requester" flush>
            {c.lines.length === 0 ? <p className="p-5 text-sm text-zinc-500">No lines.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Type</th><th>Description</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="px-5 text-right">Total</th></tr></thead>
                <tbody>{c.lines.map((l) => (
                  <tr key={l.id} className="border-t border-zinc-100"><td className="px-5 py-3 capitalize">{l.kind}</td><td className="py-3">{l.description}</td>
                    <td className="py-3 text-right font-mono">{Number(l.qty)}</td><td className="py-3 text-right font-mono">{money(Number(l.unit_cost))}</td><td className="px-5 py-3 text-right font-mono">{money(Number(l.qty) * Number(l.unit_cost))}</td></tr>))}</tbody>
              </table></div>
            )}
            <p className="border-t border-zinc-100 px-5 py-4 text-right text-sm text-zinc-600">Estimated total <span className="ml-2 font-mono text-[22px] font-semibold text-zinc-900">PKR {money(total)}</span></p>
          </Panel>

          {(files.length > 0 || canEdit) && (
            <Panel title="Photos">
              {files.length > 0 && (
                <ul className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {files.map((f) => (
                    <li key={f.id} className="space-y-1 text-xs">
                      {f.url && f.mime_type?.startsWith("image/") && f.mime_type !== "image/heic"
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <a href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={f.file_name} loading="lazy" className="h-24 w-full rounded-md border border-zinc-200 object-cover" /></a>
                        : <a href={f.url ?? undefined} target="_blank" rel="noreferrer" className="flex h-24 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 p-2 text-center text-brand">{f.mime_type === "application/pdf" ? "PDF" : "File"}</a>}
                      <p className="truncate text-zinc-500" title={f.file_name}>{f.file_name.replace(/^[0-9a-f-]{36}-/, "")}</p>
                      {canEdit && <RemoveFile slug={slug} attachmentId={f.id} />}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && <UploadForm slug={slug} id={id} />}
            </Panel>
          )}

          {canDecide && ctx && (ctx.repeat || (ctx.budget && ctx.budget.afterPct >= 100) || ctx.due.length > 0) && (
            <Panel title="Before you decide">
              <div className="space-y-3 text-sm">
                {ctx.repeat && (
                  <div className="rounded-md bg-amber-100 p-3 text-amber-800">
                    <p><strong>Repeat repair.</strong> {ctx.repeat.reason} on this vehicle {ctx.repeat.days_ago} days ago: {ctx.repeat.job_no}, {money(ctx.repeat.cost)}{ctx.repeat.vendor ? `, ${ctx.repeat.vendor}` : ""}, {ctx.repeat.cause_text.toLowerCase().slice(0, 80)}.</p>
                    <a className={`${btn} mt-2 h-8 bg-white`} href={to(`job-cards/${ctx.repeat.job_id}`)}>See it</a>
                  </div>
                )}
                {ctx.budget && ctx.budget.afterPct >= 100 && <p className="rounded-md bg-amber-100 p-3 text-amber-800"><strong>{ctx.budget.pct >= 100 ? "Over budget." : "Would go over budget."}</strong> {c.registration_no} has used {money(ctx.budget.spent)} of {money(ctx.budget.budget)} in {year}. Approving takes it to {ctx.budget.afterPct}%.</p>}
                {ctx.due[0] && <p className="rounded-md bg-sky-100 p-3 text-sky-800"><strong>{ctx.due[0].label} {ctx.due[0].status === "overdue" ? "is overdue" : `due${ctx.due[0].due_on ? ` ${dayMonth(ctx.due[0].due_on)}` : ""}`}.</strong> Ask the requester to add it, or add it when you assign the workshop.</p>}
              </div>
            </Panel>
          )}

          {flow && (
            <Panel title="Quotation, work order and invoice">
              {c.status === "vendor_assigned" && <p className="mb-3 text-sm text-zinc-600">Waiting for {c.vendor_name} to send a quotation.</p>}
              {flow.quotations.map((qt) => (
                <div key={qt.id} className="mb-4 rounded-md border border-zinc-200 p-4 text-sm">
                  <p className="font-medium">{qt.vendor_name} <span className="font-normal text-zinc-500">· {qt.status} · <span className="font-mono">{money(Number(qt.amount))}</span>{qt.days_needed ? ` · ${qt.days_needed} days` : ""}{qt.warranty_months ? ` · ${qt.warranty_months} months warranty` : ""}{qt.valid_until ? ` · valid until ${qt.valid_until}` : ""}</span></p>
                  {qt.details && <p className="mt-1 whitespace-pre-wrap text-zinc-700">{qt.details}</p>}
                  <ul className="mt-2 text-zinc-700">{qt.lines.map((l) => <li key={l.id}>{l.description} · {Number(l.qty)} × <span className="font-mono">{money(Number(l.unit_cost))}</span></li>)}</ul>
                  {canDecideQuote && qt.status === "submitted" && <QuoteDecision slug={slug} quotationId={qt.id} />}
                </div>
              ))}
              {c.status === "quotation_received" && !canDecideQuote && c.requester_is_me && perms.has("quotation.approve") && (
                <p role="status" className="mb-3 rounded-md bg-amber-100 p-3 text-sm text-amber-800">You raised this card, so someone else has to approve the quotation.</p>
              )}
              {flow.workOrder && <p className="text-sm"><span className="font-mono font-medium">{flow.workOrder.wo_no}</span> · {flow.workOrder.status.replace("_", " ")} · approved <span className="font-mono">{money(Number(flow.workOrder.approved_amount))}</span></p>}
              {flow.invoices.map((i) => (
                <p key={i.id} className="mt-1 text-sm">
                  Invoice {i.invoice_no} · <span className="font-mono">{money(Number(i.amount))}</span> · {i.status}
                  {i.payable_amount && <> · payable <span className="font-mono">{money(Number(i.payable_amount))}</span></>}
                  {perms.has("invoice.verify") && <> · <a className="text-brand underline" href={to(`invoices/${i.id}`)}>{i.status === "submitted" ? "Check it" : "Open"}</a></>}
                </p>
              ))}
            </Panel>
          )}

          <Panel title="Activity">
            <ol className="space-y-3 text-sm">
              {[...c.events].reverse().map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-4 border-b border-zinc-100 pb-3 last:border-0 last:pb-0">
                  <div><p className="font-medium">{STATUS_LABEL[e.to_status] ?? e.to_status}</p><p className="text-xs text-zinc-500">{e.actor_name ?? "System"}</p>{e.comment && <p className="mt-1 whitespace-pre-wrap text-zinc-700">{e.comment}</p>}</div>
                  <time className="whitespace-nowrap font-mono text-xs text-zinc-500" dateTime={e.created_at}>{stamp(e.created_at)}</time>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <aside className="space-y-5">
          {canDecide && ctx && (
            <Panel title="Your decision">
              <DecisionForm slug={slug} id={id} requester={c.requester_name} reasons={reasons} currentReasonId={c.reason_code_id} vendors={ctx.vendors} canAssign={perms.has("jobcard.assign_vendor")} />
            </Panel>
          )}
          {c.status === "submitted" && c.requester_is_me && <p role="status" className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600">{perms.has("jobcard.approve") ? "You raised this card, so someone else has to approve it." : "Waiting for a manager to approve."}</p>}
          {canAssign && <Panel title="Choose a workshop"><VendorPanel slug={slug} id={id} vendors={assignable} /></Panel>}
          {canEdit && (
            <Panel title="Your next step">
              <p className="mb-3 text-sm"><a href={to(`job-cards/${id}/edit`)} className="text-brand underline">Edit this job card</a></p>
              <DraftPanel slug={slug} id={id} />
            </Panel>
          )}
          {canClose && <Panel title="Finish"><ClosePanel slug={slug} id={id} /></Panel>}

          {ctx?.budget && (
            <Panel title={<>Budget impact, <span className="font-mono">{c.registration_no}</span></>}>
              <p className="flex items-baseline justify-between font-mono text-sm"><span>{money(ctx.budget.spent)} now</span><span className={ctx.budget.afterPct >= 100 ? "font-semibold text-red-700" : ""}>{money(ctx.budget.after)} after</span></p>
              <div className="mt-2 h-2 rounded bg-zinc-100"><div className={`h-2 rounded ${ctx.budget.afterPct >= 100 ? "bg-red-600" : "bg-brand"}`} style={{ width: `${Math.min(100, ctx.budget.afterPct)}%` }} /></div>
              <p className="mt-2 text-xs text-zinc-500">Budget {money(ctx.budget.budget)}. After this job: {ctx.budget.afterPct}%.</p>
            </Panel>
          )}
        </aside>
      </div>
    </main>
  );
}
