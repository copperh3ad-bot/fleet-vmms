import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { Card } from "@/components/form";
import { costOverview, getFlags } from "@/lib/analytics/service";
import { Bars, FlagList, ReportTabs, money } from "./shared";

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
  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 p-4 text-zinc-900">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Reports</h1>
        <form className="ml-auto flex items-center gap-2 text-sm"><label htmlFor="months" className="text-zinc-600">Last</label>
          <select id="months" name="months" defaultValue={months} className="h-10 rounded-md border border-zinc-300 bg-white px-2">{[3, 6, 12, 24].map((n) => <option key={n} value={n}>{n} months</option>)}</select>
          <button className="h-10 rounded-md border border-zinc-300 bg-white px-4">Show</button></form>
      </div>
      <ReportTabs slug={slug} active="costs" />

      <section className="space-y-2"><h2 className="text-sm font-semibold">Needs a look <span className="font-normal text-zinc-500">{flags.length}</span></h2>
        <FlagList slug={slug} flags={flags} empty="Nothing is flagged." /></section>

      <div className="grid grid-cols-3 gap-3 text-sm">
        {[["Spent", money(r.total)], ["Job cards", String(r.jobs)], ["Average per job", money(r.average)]].map(([l, v]) => (
          <div key={l} className="rounded-lg border border-zinc-200 bg-white p-3"><p className="text-xs text-zinc-500">{l}</p><p className="text-2xl font-semibold tabular-nums">{v}</p></div>
        ))}
      </div>
      <p className="-mt-2 text-xs text-zinc-500">Cost is the checked invoice amount once finance has verified it, otherwise the estimate. Drafts, cancelled and rejected cards are not counted.</p>

      <Card title="Spending by month"><Bars rows={r.byMonth.map((x) => ({ label: x.month, value: x.cost, note: x.jobs ? `${x.jobs} jobs` : undefined }))} /></Card>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="By reason"><Bars rows={r.byCategory.map((x) => ({ label: CATEGORY[x.label] ?? x.label, value: x.cost, note: `${x.jobs}` }))} /></Card>
        <Card title="Costliest vehicles">{r.byVehicle.length === 0 ? <p className="text-sm text-zinc-500">No spending yet.</p> : <Bars rows={r.byVehicle.map((x) => ({ label: x.label, value: x.cost, note: `${x.jobs}` }))} />}</Card>
        <Card title="By workshop"><Bars rows={r.byVendor.map((x) => ({ label: x.label, value: x.cost, note: `${x.jobs}` }))} /></Card>
        <Card title="By driver (who held the vehicle)"><Bars rows={r.byDriver.map((x) => ({ label: x.label, value: x.cost, note: `${x.jobs}` }))} /></Card>
      </div>
    </main>
  );
}
