import { Suspense } from "react";
import { ExportLink } from "@/components/export-link";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { Card } from "@/components/form";
import { whyItKeepsBreaking } from "@/lib/analytics/service";
import { Bars, FlagList, ReportTabs, money } from "../shared";

export default function BreakingPage({ params }: PageProps<"/w/[slug]/reports/breaking">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  const w = await whyItKeepsBreaking(getDriver(), m);
  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 p-4 text-zinc-900">
      <h1 className="text-xl font-semibold">Why it keeps breaking</h1>
      <ReportTabs slug={slug} active="breaking" />
      <div className="flex justify-end"><ExportLink slug={slug} kind="repeat-repairs" label="Export repeat repairs" /></div>
      <p className="text-sm text-zinc-600">The last 12 months. The same fault coming back within {w.repeatThresholdDays} days counts as a repeat; routine service never does. Change the limits in Settings.</p>

      <section className="space-y-2"><h2 className="text-sm font-semibold">Vehicles to look at <span className="font-normal text-zinc-500">{w.flags.length}</span></h2>
        <FlagList slug={slug} flags={w.flags} empty="No vehicle is over the limits." /></section>

      <Card title={`Repeat repairs (${w.repeats.length})`}>
        {w.repeats.length === 0 ? <p className="text-sm text-zinc-500">None. Nothing came back inside {w.repeatThresholdDays} days.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500"><tr><th className="py-1 pr-3">Vehicle</th><th className="pr-3">Fault</th><th className="pr-3">Earlier job</th><th className="pr-3">Came back</th><th className="pr-3 text-right">Days</th><th>Earlier work done by</th></tr></thead>
            <tbody>{w.repeats.map((r) => (
              <tr key={r.job_card_id} className="border-t border-zinc-100">
                <td className="py-1 pr-3 font-medium">{r.registration_no}</td><td className="pr-3">{r.reason}</td>
                <td className="pr-3"><a className="text-sky-800 hover:underline" href={`/w/${slug}/job-cards/${r.previous_job_card_id}`}>{r.previous_job_no}</a></td>
                <td className="pr-3"><a className="text-sky-800 hover:underline" href={`/w/${slug}/job-cards/${r.job_card_id}`}>{r.job_no}</a></td>
                <td className="pr-3 text-right tabular-nums">{r.days_since}</td><td>{r.previous_vendor ?? "—"}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Workshops whose work came back">
          {w.cameBackByVendor.length === 0 ? <p className="text-sm text-zinc-500">None.</p> : <Bars rows={w.cameBackByVendor.map((v) => ({ label: v.vendor, value: v.repeats }))} />}
        </Card>
        <Card title="Job cards by reason">
          <Bars rows={w.categories.map((c) => ({ label: c.label.replace(/_/g, " "), value: c.jobs, note: `${money(c.cost)}` }))} />
        </Card>
      </div>

      <Card title="Most jobs in 12 months">
        {w.busiest.length === 0 ? <p className="text-sm text-zinc-500">No vehicle has had two or more jobs.</p> : (
          <table className="w-full text-left text-sm"><thead className="text-xs text-zinc-500"><tr><th className="py-1 pr-3">Vehicle</th><th className="pr-3 text-right">Jobs</th><th className="pr-3 text-right">Cost</th><th>Most common reason</th></tr></thead>
            <tbody>{w.busiest.map((b) => (
              <tr key={b.vehicle_id} className="border-t border-zinc-100"><td className="py-1 pr-3 font-medium"><a className="text-sky-800 hover:underline" href={`/w/${slug}/vehicles/${b.vehicle_id}`}>{b.registration_no}</a></td>
                <td className="pr-3 text-right tabular-nums">{b.jobs}</td><td className="pr-3 text-right tabular-nums">{money(b.cost)}</td><td>{b.top_reason}</td></tr>))}</tbody></table>
        )}
      </Card>

      <Card title="Who says why: requester or manager">
        <p className="mb-2 text-sm">Managers changed the reason on <span className="font-medium">{w.retagged.changed}</span> of {w.retagged.total} job cards. A large share means requesters and managers see the causes differently.</p>
        {w.retagged.examples.length > 0 && (
          <table className="w-full text-left text-sm"><thead className="text-xs text-zinc-500"><tr><th className="py-1 pr-3">Job</th><th className="pr-3">Vehicle</th><th className="pr-3">Requester said</th><th>Manager decided</th></tr></thead>
            <tbody>{w.retagged.examples.map((e) => (
              <tr key={e.job_card_id} className="border-t border-zinc-100"><td className="py-1 pr-3"><a className="text-sky-800 hover:underline" href={`/w/${slug}/job-cards/${e.job_card_id}`}>{e.job_no}</a></td>
                <td className="pr-3">{e.registration_no}</td><td className="pr-3">{e.requested} <span className="text-xs text-zinc-500">({e.requester})</span></td><td>{e.final}</td></tr>))}</tbody></table>
        )}
      </Card>
    </main>
  );
}
