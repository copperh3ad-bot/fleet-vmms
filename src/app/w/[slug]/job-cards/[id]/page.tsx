import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { Card } from "@/components/form";
import { getJobCard, listActiveVendors, listReasonCodes } from "@/lib/jobcards/service";
import { STATUS_LABEL, StatusBadge } from "../status";
import { listJobCardAttachments } from "@/lib/jobcards/attachments";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { ApprovalPanel, DraftPanel, VendorPanel } from "./panel";
import { RemoveFile, UploadForm } from "./files";

export default function JobCardPage({ params }: PageProps<"/w/[slug]/job-cards/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const fmtDate = (s: string) => new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

async function Inner({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [c, perms] = await Promise.all([getJobCard(driver, m, id), permissionsOf(driver, m)]);
  if (!c) notFound();

  const canDecide = c.status === "submitted" && perms.has("jobcard.approve");
  const canAssign = c.status === "approved" && perms.has("jobcard.assign_vendor");
  const canEdit = c.mine && perms.has("jobcard.create") && ["draft", "returned_for_edit"].includes(c.status);
  const files = await listJobCardAttachments(driver, await supabaseBlobStore(), m, id);
  const [reasons, vendors] = await Promise.all([
    canDecide ? listReasonCodes(driver, m) : Promise.resolve([]),
    canAssign ? listActiveVendors(driver, m) : Promise.resolve([]),
  ]);
  const total = c.lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_cost), 0);
  const lastReturn = c.status === "returned_for_edit" ? [...c.events].reverse().find((e) => e.to_status === "returned_for_edit") : null;

  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 p-4 text-zinc-900">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{c.job_no}</h1>
        <StatusBadge status={c.status} />
        <a href={`/w/${slug}/job-cards`} className="ml-auto text-sm text-sky-800 underline">All job cards</a>
      </div>

      {lastReturn?.comment && (
        <p role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Sent back{lastReturn.actor_name ? ` by ${lastReturn.actor_name}` : ""}: {lastReturn.comment}</p>
      )}

      <Card title="Details">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row k="Vehicle"><a className="text-sky-800 hover:underline" href={`/w/${slug}/vehicles/${c.vehicle_id}`}>{c.registration_no}</a></Row>
          <Row k="Held by when raised">{c.custodian_name ?? "Nobody"}</Row>
          <Row k="Requested by">{c.requester_name}</Row>
          <Row k="Type / priority"><span className="capitalize">{c.category} · {c.priority}</span></Row>
          <Row k="Reason">{c.reason_label}{c.reason_label !== c.requested_reason_label && <span className="ml-1 text-xs text-zinc-500">(requested as {c.requested_reason_label})</span>}</Row>
          <Row k="Odometer">{c.odometer_km ? `${Number(c.odometer_km).toLocaleString("en-US")} km` : "—"}</Row>
          <Row k="Needed by">{c.needed_by ?? "—"}</Row>
          <Row k="Approved by">{c.approver_name ?? "—"}</Row>
          {c.vendor_name && <Row k="Vendor">{c.vendor_name}</Row>}
        </dl>
        <div className="mt-3 border-t border-zinc-100 pt-3 text-sm">
          <p className="text-xs font-medium text-zinc-600">What went wrong, and why</p>
          <p className="whitespace-pre-wrap">{c.cause_text}</p>
          {c.description && <><p className="mt-2 text-xs font-medium text-zinc-600">Extra details</p><p className="whitespace-pre-wrap">{c.description}</p></>}
        </div>
      </Card>

      <Card title="Expected work and cost">
        {c.lines.length === 0 ? <p className="text-sm text-zinc-500">No lines.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500"><tr><th className="py-1 pr-3">Kind</th><th className="pr-3">Description</th><th className="pr-3 text-right">Qty</th><th className="pr-3 text-right">Unit cost</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {c.lines.map((l) => (
                  <tr key={l.id} className="border-t border-zinc-100">
                    <td className="py-1 pr-3 capitalize">{l.kind}</td><td className="pr-3">{l.description}</td>
                    <td className="pr-3 text-right tabular-nums">{Number(l.qty)}</td><td className="pr-3 text-right tabular-nums">{money(Number(l.unit_cost))}</td>
                    <td className="text-right tabular-nums">{money(Number(l.qty) * Number(l.unit_cost))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-zinc-200 font-medium"><td colSpan={4} className="py-1 pr-3 text-right">Estimate</td><td className="text-right tabular-nums">{money(total)}</td></tr></tfoot>
            </table>
          </div>
        )}
      </Card>

      {(files.length > 0 || canEdit) && (
        <Card title="Photos and files">
          {files.length > 0 && (
            <ul className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {files.map((f) => (
                <li key={f.id} className="space-y-1 text-xs">
                  {f.url && f.mime_type?.startsWith("image/") && f.mime_type !== "image/heic"
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <a href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={f.file_name} loading="lazy" className="h-24 w-full rounded-md border border-zinc-200 object-cover" /></a>
                    : <a href={f.url ?? undefined} target="_blank" rel="noreferrer" className="flex h-24 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 p-2 text-center text-sky-800">{f.mime_type === "application/pdf" ? "PDF" : "File"}</a>}
                  <p className="truncate text-zinc-600" title={f.file_name}>{f.file_name.replace(/^[0-9a-f-]{36}-/, "")}</p>
                  {canEdit && <RemoveFile slug={slug} attachmentId={f.id} />}
                </li>
              ))}
            </ul>
          )}
          {canEdit && <UploadForm slug={slug} id={id} />}
        </Card>
      )}

      {c.status === "submitted" && c.requester_is_me && !canDecide && <p className="text-sm text-zinc-600">Waiting for a manager to approve.</p>}
      {canDecide && c.requester_is_me && (
        <p role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">You raised this card, so someone else has to approve it.</p>
      )}
      {canDecide && !c.requester_is_me && <Card title="Decision"><ApprovalPanel slug={slug} id={id} reasons={reasons} currentReason={c.reason_code_id} /></Card>}
      {canAssign && <Card title="Choose a workshop"><VendorPanel slug={slug} id={id} vendors={vendors} /></Card>}
      {canEdit && (
        <Card title="Your next step">
          <p className="mb-3 text-sm"><a href={`/w/${slug}/job-cards/${id}/edit`} className="text-sky-800 underline">Edit this job card</a></p>
          <DraftPanel slug={slug} id={id} />
        </Card>
      )}

      <Card title="History">
        <ol className="space-y-2 text-sm">
          {c.events.map((e) => (
            <li key={e.id} className="border-l-2 border-zinc-200 pl-3">
              <p><span className="font-medium">{STATUS_LABEL[e.to_status] ?? e.to_status}</span> <span className="text-zinc-500">· {e.actor_name ?? "System"} · {fmtDate(e.created_at)}</span></p>
              {e.comment && <p className="whitespace-pre-wrap text-zinc-700">{e.comment}</p>}
            </li>
          ))}
        </ol>
      </Card>
    </main>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div><dt className="text-xs font-medium text-zinc-600">{k}</dt><dd>{children}</dd></div>;
}
