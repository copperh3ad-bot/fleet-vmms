import { Suspense } from "react";
import { ExportLink } from "@/components/export-link";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { listAccidents } from "@/lib/compliance/service";
import { SEVERITY, Tabs } from "../compliance/tabs";

export default function AccidentsPage({ params }: PageProps<"/w/[slug]/accidents">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const when = (s: string) => new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [rows, perms] = await Promise.all([listAccidents(driver, m), permissionsOf(driver, m)]);
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4 p-4 text-zinc-900">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Accidents</h1>
        {perms.has("compliance.manage") && <a href={`/w/${slug}/accidents/new`} className="ml-auto rounded-md bg-sky-800 px-3 py-2 text-sm text-white">Record an accident</a>}
      </div>
      <Tabs slug={slug} active="accidents" />
      <div className="flex justify-end"><ExportLink slug={slug} kind="accidents" query={{}} /></div>
      {rows.length === 0 ? <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-600">No accidents recorded.</p> : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500"><tr><th className="p-3">When</th><th className="p-3">Vehicle</th><th className="p-3">Driver</th><th className="p-3">Severity</th><th className="p-3">Claim</th><th className="p-3">Job card</th></tr></thead>
            <tbody>{rows.map((a) => (
              <tr key={a.id} className="border-b border-zinc-100 last:border-0">
                <td className="p-3"><a className="text-sky-800 hover:underline" href={`/w/${slug}/accidents/${a.id}`}>{when(a.occurred_at)}</a></td>
                <td className="p-3 font-medium">{a.registration_no}</td><td className="p-3">{a.driver_name ?? "—"}</td>
                <td className="p-3">{SEVERITY[a.severity] ?? a.severity}</td><td className="p-3">{a.insurance_claim ? a.claim_ref ?? "Yes" : "—"}</td>
                <td className="p-3">{a.job_no ? <a className="text-sky-800 hover:underline" href={`/w/${slug}/job-cards/${a.job_card_id}`}>{a.job_no}</a> : "—"}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </main>
  );
}
