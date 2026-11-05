import { Suspense } from "react";
import { ExportLink } from "@/components/export-link";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { Kpi, PageHeader, Panel } from "@/components/ui";
import { costOverview, getFlags } from "@/lib/analytics/service";
import { costPerKm, downtime } from "@/lib/analytics/fleet-use";
import { Bars, FlagList, money } from "./shared";
import { monthShort } from "@/lib/labels";

export default function ReportsPage({ params, searchParams }: PageProps<"/w/[slug]/reports">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const CATEGORY: Record<string, string> = {
  scheduled_service: "Scheduled service", wear_and_tear: "Wear and tear", driver_misuse: "Driver misuse", accident_damage: "Accident damage",
  defect: "Defect", poor_previous_repair: "Poor previous repair", environmental: "Environmental", other: "Other",
};

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const months = [3, 6, 12, 24].includes(Number(sp.months)) ? Number(sp.months) : 12;
  const m = await requireMembership(slug, { fullScope: true });
  const cur = m.currency || "PKR";
  const driver = getDriver();
  const [r, flags, perKm, down] = await Promise.all([costOverview(driver, m, months), getFlags(driver, m), costPerKm(driver, m, months), downtime(driver, m, months)]);
  const money2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sel = "h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm";
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Reports" sub={`Costs over the last ${months} months`} actions={
        <>
          <form className="flex items-center gap-2 text-sm"><label htmlFor="months" className="text-zinc-600">Last</label>
            <select id="months" name="months" defaultValue={months} className={sel}>{[3, 6, 12, 24].map((n) => <option key={n} value={n}>{n} months</option>)}</select>
            <button className={`${sel} font-medium hover:bg-zinc-50`}>Show</button></form>
          <ExportLink slug={slug} kind="costs-by-vehicle" label="Export costs by vehicle" /><ExportLink slug={slug} kind="flags" label="Export flags" />
          <ExportLink slug={slug} kind="cost-per-km" query={{ months: String(months) }} label="Export cost per km" /><ExportLink slug={slug} kind="workshop-time" query={{ months: String(months) }} label="Export workshop time" />
        </>} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi label={`Spent (${cur})`} value={money(r.total)} />
        <Kpi label="Job cards" value={r.jobs} />
        <Kpi label={`Average per job (${cur})`} value={money(r.average)} />
      </div>
      <p className="-mt-2 text-xs text-zinc-500">Cost is the checked invoice amount once finance has verified it, otherwise the estimate. Drafts, cancelled and rejected cards are not counted.</p>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Panel title="Spending by month"><Bars rows={r.byMonth.map((x) => ({ label: `${monthShort(x.month)} ${x.month.slice(0, 4)}`, value: x.cost, note: x.jobs ? `${x.jobs} ${x.jobs === 1 ? "job" : "jobs"}` : undefined }))} /></Panel>
        <Panel title="Needs a look" sub={`${flags.length} flagged`}><FlagList slug={slug} flags={flags} empty="Nothing is flagged." /></Panel>
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Panel title="By reason"><Bars rows={r.byCategory.map((x) => ({ label: CATEGORY[x.label] ?? x.label, value: x.cost, note: `${x.jobs}` }))} /></Panel>
        <Panel title="Costliest vehicles">{r.byVehicle.length === 0 ? <p className="text-sm text-zinc-500">No spending yet.</p> : <Bars rows={r.byVehicle.map((x) => ({ label: x.label, value: x.cost, note: `${x.jobs}` }))} />}</Panel>
        <Panel title="By workshop"><Bars rows={r.byVendor.map((x) => ({ label: x.label, value: x.cost, note: `${x.jobs}` }))} /></Panel>
        <Panel title="By driver" sub="Whoever held the vehicle when the job card was raised"><Bars rows={r.byDriver.map((x) => ({ label: x.label, value: x.cost, note: `${x.jobs}` }))} /></Panel>
        <Panel title="Cost per kilometre" sub={perKm.fleet.per_km !== null ? `Fleet ${money2(perKm.fleet.per_km)} ${cur} per km over ${money(perKm.fleet.km)} km` : "Worst first"}>
          {perKm.rows.length === 0 ? <p className="text-sm text-zinc-500">No spending or odometer readings in this period.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="py-2">Vehicle</th><th className="text-right">Cost</th><th className="text-right">Km</th><th className="text-right">Per km</th></tr></thead>
              <tbody>{perKm.rows.slice(0, 15).map((x) => (
                <tr key={x.vehicle_id} className="border-t border-zinc-100">
                  <td className="py-2"><a className="font-medium text-sky-800 hover:underline" href={`/w/${slug}/vehicles/${x.vehicle_id}`}>{x.registration_no}</a></td>
                  <td className="py-2 text-right font-mono">{money(x.cost)}</td>
                  <td className="py-2 text-right font-mono">{x.km === null ? <span className="font-sans text-xs text-zinc-500">Not enough readings</span> : money(x.km)}</td>
                  <td className="py-2 text-right font-mono">{x.per_km === null ? "—" : money2(x.per_km)}</td>
                </tr>))}</tbody>
            </table></div>
          )}
          <p className="mt-3 text-xs text-zinc-500">Cost is the same figure as above. Kilometres come from accepted odometer readings: the last one in the period minus the last one before it. A vehicle needs two readings to show a distance.</p>
        </Panel>
        <Panel title="Time in the workshop" sub={down.fleet.availability !== null ? `Fleet availability ${(down.fleet.availability * 100).toFixed(1)}%` : undefined}>
          {down.rows.length === 0 ? <p className="text-sm text-zinc-500">No vehicle was in the workshop in this period.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="py-2">Vehicle</th><th className="text-right">Days</th><th className="text-right">Visits</th><th className="text-right">Longest</th><th className="text-right">Available</th></tr></thead>
              <tbody>{down.rows.slice(0, 15).map((x) => (
                <tr key={x.vehicle_id} className="border-t border-zinc-100">
                  <td className="py-2"><a className="font-medium text-sky-800 hover:underline" href={`/w/${slug}/vehicles/${x.vehicle_id}`}>{x.registration_no}</a></td>
                  <td className="py-2 text-right font-mono">{x.workshop_days}</td><td className="py-2 text-right font-mono">{x.visits}</td>
                  <td className="py-2 text-right font-mono">{x.longest_days} d</td>
                  <td className="py-2 text-right font-mono">{x.availability === null ? "—" : `${(x.availability * 100).toFixed(0)}%`}</td>
                </tr>))}</tbody>
            </table></div>
          )}
          <p className="mt-3 text-xs text-zinc-500">A day counts as a workshop day if the vehicle was in the workshop for any part of it (UTC days). Before this was recorded, vehicles are treated as available.</p>
        </Panel>
      </div>
    </main>
  );
}
