import { Suspense } from "react";
import { ExportLink } from "@/components/export-link";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { listJobCards } from "@/lib/jobcards/service";
import { STATUS_LABEL, StatusBadge } from "./status";

export default function JobCardsPage({ params, searchParams }: PageProps<"/w/[slug]/job-cards">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [rows, perms] = await Promise.all([listJobCards(driver, m, { search: q || undefined, status: status || undefined }), permissionsOf(driver, m)]);
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4 p-4 text-zinc-900">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Job cards <span className="text-sm font-normal text-zinc-500">{rows.length}</span></h1>
        {perms.has("jobcard.create") && <a href={`/w/${slug}/job-cards/new`} className="ml-auto rounded-md bg-sky-800 px-3 py-2 text-sm text-white">New job card</a>}
      </div>
      <form className="flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Search job number, plate or requester" className="h-10 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3" aria-label="Search job cards" />
        <select name="status" defaultValue={status} className="h-10 rounded-md border border-zinc-300 bg-white px-2" aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="h-10 rounded-md border border-zinc-300 bg-white px-4">Search</button>
      </form>
      <div className="flex justify-end"><ExportLink slug={slug} kind="job-cards" query={{ q, status }} /></div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-600">
          {q || status ? "No job card matches." : "No job cards yet."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500">
              <tr><th className="p-3">Job</th><th className="p-3">Vehicle</th><th className="p-3">Reason</th><th className="p-3">Requested by</th><th className="p-3">Priority</th><th className="p-3 text-right">Estimate</th><th className="p-3">Status</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 last:border-0">
                  <td className="p-3 font-medium"><a className="text-sky-800 hover:underline" href={`/w/${slug}/job-cards/${r.id}`}>{r.job_no}</a></td>
                  <td className="p-3">{r.registration_no}</td>
                  <td className="p-3">{r.reason_label}</td>
                  <td className="p-3">{r.requester_name}</td>
                  <td className="p-3 capitalize">{r.priority}</td>
                  <td className="p-3 text-right tabular-nums">{r.estimated_cost ? Number(r.estimated_cost).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}</td>
                  <td className="p-3"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
