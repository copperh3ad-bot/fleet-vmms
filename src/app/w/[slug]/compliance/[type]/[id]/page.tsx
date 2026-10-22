import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { Card } from "@/components/form";
import { RemoveLink, UploadBox } from "@/components/files";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { getDocument, listComplianceFiles } from "@/lib/compliance/service";
import { DOC_LABEL } from "@/lib/compliance/schemas";
import { removeFileAction, uploadFilesAction } from "../../actions";
import { Tabs } from "../../tabs";

export default function DocumentPage({ params }: PageProps<"/w/[slug]/compliance/[type]/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string; type: string; id: string }> }) {
  const { slug, type, id } = await params;
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [doc, perms] = await Promise.all([getDocument(driver, m, type, id), permissionsOf(driver, m)]);
  if (!doc) notFound();
  const files = await listComplianceFiles(driver, await supabaseBlobStore(), m, type, id);
  const manage = perms.has("compliance.manage");
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 text-zinc-900">
      <Tabs slug={slug} active="compliance" />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{DOC_LABEL[doc.doc_type] ?? doc.doc_type} · {doc.registration_no}</h1>
        {manage && doc.current && <a className="ml-auto rounded-md bg-sky-800 px-3 py-2 text-sm text-white" href={`/w/${slug}/compliance/new?vehicle=${doc.vehicle_id}&type=${doc.doc_type}`}>Renew</a>}
      </div>
      {!doc.current && <p role="status" className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">This has been renewed. It is kept here as history.</p>}
      <Card>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-medium text-zinc-600">{doc.doc_type === "insurance" ? "Policy number" : "Reference"}</dt><dd>{doc.reference ?? "—"}</dd></div>
          <div><dt className="text-xs font-medium text-zinc-600">{doc.doc_type === "insurance" ? "Insurer" : "Issued by"}</dt><dd>{doc.issued_by ?? "—"}</dd></div>
          <div><dt className="text-xs font-medium text-zinc-600">Valid from</dt><dd>{doc.valid_from ?? "—"}</dd></div>
          <div><dt className="text-xs font-medium text-zinc-600">Expires on</dt><dd>{doc.expires_on}</dd></div>
          {doc.amount && <div><dt className="text-xs font-medium text-zinc-600">{doc.doc_type === "insurance" ? "Premium" : "Cost"}</dt><dd className="tabular-nums">{Number(doc.amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}</dd></div>}
        </dl>
      </Card>
      <Card title="Scans and photos">
        {files.length > 0 && (
          <ul className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {files.map((f) => (
              <li key={f.id} className="space-y-1 text-xs">
                <a href={f.url ?? undefined} target="_blank" rel="noreferrer" className="flex h-24 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 p-2 text-center text-sky-800">{f.mime_type === "application/pdf" ? "PDF" : "Photo"}</a>
                <p className="truncate text-zinc-600" title={f.file_name}>{f.file_name}</p>
                {manage && <RemoveLink action={removeFileAction.bind(null, slug, f.id)} />}
              </li>
            ))}
          </ul>
        )}
        {manage ? <UploadBox action={uploadFilesAction.bind(null, slug, type, id)} /> : files.length === 0 && <p className="text-sm text-zinc-500">No files.</p>}
      </Card>
      {doc.history.length > 1 && (
        <Card title="History">
          <ul className="space-y-1 text-sm">{doc.history.map((h) => (
            <li key={h.id}>{h.id === id ? <span className="font-medium">{h.reference ?? "No reference"} · until {h.expires_on}</span> : <a className="text-sky-800 hover:underline" href={`/w/${slug}/compliance/${h.entity_type}/${h.id}`}>{h.reference ?? "No reference"} · until {h.expires_on}</a>}</li>
          ))}</ul>
        </Card>
      )}
    </main>
  );
}
