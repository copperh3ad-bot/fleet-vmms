import { Suspense } from "react";
import { ExportLink } from "@/components/export-link";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { listJobCards } from "@/lib/jobcards/service";
import { PageHeader, Panel, Pill, Plate, btn, btnPrimary, money, type Tone } from "@/components/ui";
import { STATUS_LABEL, StatusBadge } from "./status";

export default function JobCardsPage({ params, searchParams }: PageProps<"/w/[slug]/job-cards">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const PRIORITY: Record<string, Tone> = { urgent: "bad", high: "warn", normal: "neutral", low: "neutral" };

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [rows, perms] = await Promise.all([listJobCards(driver, m, { search: q || undefined, status: status || undefined }), permissionsOf(driver, m)]);
  const control = "h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm";
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Job cards" sub={`${rows.length} shown`} actions={<><ExportLink slug={slug} kind="job-cards" query={{ q, status }} />{perms.has("jobcard.create") && <a href={`/w/${slug}/job-cards/import`} className={btn}>Offline form</a>}{perms.has("jobcard.create") && <a href={`/w/${slug}/job-cards/new`} className={btnPrimary}>New job card</a>}</>} />
      <form className="flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Search job number, plate or requester" className={`${control} min-w-0 flex-1`} aria-label="Search job cards" />
        <select name="status" defaultValue={status} className={control} aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className={`${control} font-medium hover:bg-zinc-50`}>Search</button>
      </form>
      <Panel flush>
        {rows.length === 0 ? <p className="p-5 text-sm text-zinc-500">{q || status ? "No job card matches." : "No job cards yet."}</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-zinc-500">
              <tr><th className="px-5 py-3">Job</th><th>Vehicle</th><th>Reason</th><th>Requested by</th><th>Priority</th><th className="text-right">Estimate (PKR)</th><th className="px-5">Status</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-zinc-100">
                  <td className="px-5 py-3 font-medium"><a className="text-sky-800 hover:underline" href={`/w/${slug}/job-cards/${r.id}`}>{r.job_no}</a></td>
                  <td className="py-3"><Plate>{r.registration_no}</Plate></td>
                  <td className="py-3">{r.reason_label}</td>
                  <td className="py-3">{r.requester_name}</td>
                  <td className="py-3"><Pill tone={PRIORITY[r.priority] ?? "neutral"}>{r.priority[0].toUpperCase() + r.priority.slice(1)}</Pill></td>
                  <td className="py-3 text-right font-mono">{r.estimated_cost ? money(r.estimated_cost) : "—"}</td>
                  <td className="px-5 py-3"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Panel>
    </main>
  );
}
