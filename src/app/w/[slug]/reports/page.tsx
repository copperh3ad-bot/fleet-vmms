import { Suspense } from "react";
import { ExportLink } from "@/components/export-link";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { Kpi, PageHeader, Panel } from "@/components/ui";
import { costOverview, getFlags } from "@/lib/analytics/service";
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
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [r, flags] = await Promise.all([costOverview(driver, m, months), getFlags(driver, m)]);
  const sel = "h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm";
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Reports" sub={`Costs over the last ${months} months`} actions={
        <>
          <form className="flex items-center gap-2 text-sm"><label htmlFor="months" className="text-zinc-600">Last</label>
            <select id="months" name="months" defaultValue={months} className={sel}>{[3, 6, 12, 24].map((n) => <option key={n} value={n}>{n} months</option>)}</select>
            <button className={`${sel} font-medium hover:bg-zinc-50`}>Show</button></form>
          <ExportLink slug={slug} kind="costs-by-vehicle" label="Export costs by vehicle" /><ExportLink slug={slug} kind="flags" label="Export flags" />
        </>} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi label="Spent (PKR)" value={money(r.total)} />
        <Kpi label="Job cards" value={r.jobs} />
        <Kpi label="Average per job (PKR)" value={money(r.average)} />
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
      </div>
    </main>
  );
}
