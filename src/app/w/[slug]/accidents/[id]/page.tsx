import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { Card } from "@/components/form";
import { RemoveLink, UploadBox } from "@/components/files";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { getAccident, listComplianceFiles } from "@/lib/compliance/service";
import { removeFileAction, uploadFilesAction } from "../../compliance/actions";
import { FAULT, SEVERITY, Tabs } from "../../compliance/tabs";

export default function AccidentPage({ params }: PageProps<"/w/[slug]/accidents/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [a, perms] = await Promise.all([getAccident(driver, m, id), permissionsOf(driver, m)]);
  if (!a) notFound();
  const files = await listComplianceFiles(driver, await supabaseBlobStore(), m, "accident", id);
  const manage = perms.has("compliance.manage");
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 text-zinc-900">
      <Tabs slug={slug} active="accidents" />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{a.registration_no} · {SEVERITY[a.severity] ?? a.severity}</h1>
        {manage && !a.job_card_id && <a className="ml-auto rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm" href={`/w/${slug}/job-cards/new?vehicle=${a.vehicle_id}`}>Raise a job card for the repair</a>}
      </div>
      <Card>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-medium text-zinc-600">When</dt><dd>{new Date(a.occurred_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</dd></div>
          <div><dt className="text-xs font-medium text-zinc-600">Where</dt><dd>{a.location ?? "—"}</dd></div>
          <div><dt className="text-xs font-medium text-zinc-600">Driver</dt><dd>{a.driver_name ?? "Not known"}</dd></div>
          <div><dt className="text-xs font-medium text-zinc-600">At fault</dt><dd>{a.fault ? FAULT[a.fault] : "Not known yet"}</dd></div>
          {a.cover && <div><dt className="text-xs font-medium text-zinc-600">Company policy</dt><dd>{a.cover.cover === "covered" ? `Covered by the company: driver's accident ${a.cover.nth} of ${a.cover.free} allowed` : `The driver bears the depreciation (accident ${a.cover.nth} for this driver)`}</dd></div>}
          <div><dt className="text-xs font-medium text-zinc-600">Insurance claim</dt><dd>{a.insurance_claim ? a.claim_ref ?? "Yes, no reference yet" : "No"}</dd></div>
          <div><dt className="text-xs font-medium text-zinc-600">Job card</dt><dd>{a.job_no ? <a className="text-sky-800 hover:underline" href={`/w/${slug}/job-cards/${a.job_card_id}`}>{a.job_no}</a> : "—"}</dd></div>
        </dl>
        <p className="mt-3 whitespace-pre-wrap border-t border-zinc-100 pt-3 text-sm">{a.description}</p>
      </Card>
      <Card title="Photos and reports">
        {files.length > 0 && (
          <ul className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {files.map((f) => (
              <li key={f.id} className="space-y-1 text-xs">
                {f.url && f.mime_type?.startsWith("image/") && f.mime_type !== "image/heic"
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <a href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={f.file_name} loading="lazy" className="h-24 w-full rounded-md border border-zinc-200 object-cover" /></a>
                  : <a href={f.url ?? undefined} target="_blank" rel="noreferrer" className="flex h-24 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 p-2 text-center text-sky-800">{f.mime_type === "application/pdf" ? "PDF" : "File"}</a>}
                <p className="truncate text-zinc-600" title={f.file_name}>{f.file_name}</p>
                {manage && <RemoveLink action={removeFileAction.bind(null, slug, f.id)} />}
              </li>
            ))}
          </ul>
        )}
        {manage ? <UploadBox action={uploadFilesAction.bind(null, slug, "accident", id)} /> : files.length === 0 && <p className="text-sm text-zinc-500">No files.</p>}
      </Card>
    </main>
  );
}
