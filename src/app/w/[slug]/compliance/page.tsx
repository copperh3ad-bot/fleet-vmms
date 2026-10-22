import { Suspense } from "react";
import { ExportLink } from "@/components/export-link";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { listDocuments, listMissingDocuments } from "@/lib/compliance/service";
import { DOC_LABEL } from "@/lib/compliance/schemas";
import { DOC_CHIP, Tabs } from "./tabs";

export default function CompliancePage({ params, searchParams }: PageProps<"/w/[slug]/compliance">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 80) : "");
  const [q, status, type] = [one("q"), one("status"), one("type")];
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [rows, missing, perms] = await Promise.all([
    listDocuments(driver, m, { search: q || undefined, status: status || undefined, type: type || undefined }),
    listMissingDocuments(driver, m, ["registration", "fitness", "token_tax", "insurance"]),
    permissionsOf(driver, m),
  ]);
  const count = (s: string) => rows.filter((r) => r.doc_status === s).length;
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4 p-4 text-zinc-900">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Compliance</h1>
        {perms.has("compliance.manage") && <a href={`/w/${slug}/compliance/new`} className="ml-auto rounded-md bg-sky-800 px-3 py-2 text-sm text-white">Add or renew a document</a>}
      </div>
      <Tabs slug={slug} active="compliance" />
      <div className="grid grid-cols-3 gap-3 text-sm">
        {([["expired", "Expired"], ["due_30", "Due in 30 days"], ["due_90", "Due in 90 days"]] as const).map(([k, l]) => (
          <a key={k} href={`/w/${slug}/compliance?status=${k}`} className={`rounded-lg border p-3 ${DOC_CHIP[k].cls} border-transparent`}>
            <span className="block text-2xl font-semibold tabular-nums">{status ? (status === k ? rows.length : "·") : count(k)}</span>{l}
          </a>
        ))}
      </div>
      <form className="flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Search plate or reference" className="h-10 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3" aria-label="Search documents" />
        <select name="type" defaultValue={type} className="h-10 rounded-md border border-zinc-300 bg-white px-2" aria-label="Type">
          <option value="">Any type</option>{Object.entries(DOC_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select name="status" defaultValue={status} className="h-10 rounded-md border border-zinc-300 bg-white px-2" aria-label="Status">
          <option value="">Any status</option>{Object.entries(DOC_CHIP).map(([k, c]) => <option key={k} value={k}>{c.text}</option>)}
        </select>
        <button className="h-10 rounded-md border border-zinc-300 bg-white px-4">Filter</button>
      </form>
      <div className="flex justify-end"><ExportLink slug={slug} kind="documents" query={{ q, status, type }} /></div>
      {rows.length === 0 ? <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-600">{q || status || type ? "No document matches." : "No documents yet."}</p> : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500"><tr><th className="p-3">Vehicle</th><th className="p-3">Document</th><th className="p-3">Reference</th><th className="p-3">Issued by</th><th className="p-3">Expires</th><th className="p-3">Status</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.entity_id} className="border-b border-zinc-100 last:border-0">
                <td className="p-3 font-medium">{r.registration_no}</td>
                <td className="p-3"><a className="text-sky-800 hover:underline" href={`/w/${slug}/compliance/${r.entity_type}/${r.entity_id}`}>{DOC_LABEL[r.doc_type] ?? r.doc_type}</a></td>
                <td className="p-3">{r.reference ?? "—"}</td><td className="p-3">{r.issued_by ?? "—"}</td>
                <td className="p-3">{r.expires_on} <span className="text-xs text-zinc-500">({r.days_left < 0 ? `${-r.days_left} days ago` : `${r.days_left} days`})</span></td>
                <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs ${DOC_CHIP[r.doc_status].cls}`}>{DOC_CHIP[r.doc_status].text}</span></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {missing.length > 0 && !q && !status && !type && (
        <details className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
          <summary className="cursor-pointer font-medium">No document on file ({missing.length})</summary>
          <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {missing.slice(0, 200).map((x) => (
              <li key={`${x.vehicle_id}-${x.doc_type}`}>{x.registration_no} · {DOC_LABEL[x.doc_type]}{perms.has("compliance.manage") && <> · <a className="text-sky-800 underline" href={`/w/${slug}/compliance/new?vehicle=${x.vehicle_id}&type=${x.doc_type}`}>add</a></>}</li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
