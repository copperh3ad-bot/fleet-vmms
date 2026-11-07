import { dmy as long } from "@/lib/format/date";
import { Suspense } from "react";
import { ExportLink } from "@/components/export-link";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { Panel, PageHeader, Pill, Plate, money, type Tone } from "@/components/ui";
import { listVehicles } from "@/lib/master/service";
import { getBudgetBoard, getSettings, listBudgets, type BudgetStatus } from "@/lib/control/service";
import { SettingsForm } from "../settings/forms";
import { BudgetForm, CopyForwardForm } from "./form";

export default function BudgetsPage({ params, searchParams }: PageProps<"/w/[slug]/budgets">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const STATUS: Record<BudgetStatus, { tone: Tone; label: string; bar: string }> = {
  over: { tone: "bad", label: "Over", bar: "bg-red-600" },
  near: { tone: "warn", label: "Near limit", bar: "bg-amber-500" },
  ok: { tone: "ok", label: "On track", bar: "bg-sky-700" },
};

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const m = await requireMembership(slug, { fullScope: true });
  const cur = m.currency || "PKR";
  const driver = getDriver();
  const perms = await permissionsOf(driver, m);
  const manage = perms.has("budget.manage");
  const filter = sp.show === "all" ? "all" : "attention";
  const [board, all, vehicles, settings] = await Promise.all([
    getBudgetBoard(driver, m, { filter }), listBudgets(driver, m),
    manage ? listVehicles(driver, m) : Promise.resolve([]), getSettings(driver, m),
  ]);
  const edit = typeof sp.edit === "string" ? all.find((r) => r.id === sp.edit) : undefined;
  const alertItems = settings.filter((s) => s.key === "budget_warn_pct" || s.key === "budget_flag_pct");
  const f = board.fleet;
  const fleetTone: BudgetStatus = !f ? "ok" : f.pct >= board.flagPct ? "over" : f.pct >= board.warnPct ? "near" : "ok";
  const to = (q: string) => `/w/${slug}/budgets${q}`;
  const tab = (active: boolean) => `rounded-full px-3 py-1 text-xs font-medium ${active ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`;

  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Budgets" sub={`${board.year} · warn at ${board.warnPct}%, over at ${board.flagPct}%`} actions={<ExportLink slug={slug} kind="budgets" query={{}} />} />

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Panel title="Whole fleet" sub={f ? `${long(f.period_start)} to ${long(f.period_end)}` : undefined}>
            {!f ? <p className="text-sm text-zinc-500">No fleet budget for {board.year} yet. Add one on the right.</p> : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1">
                  <p><span className="font-mono text-2xl">{cur} {money(f.spent)}</span> <span className="text-sm text-zinc-500">of {money(f.amount)} spent</span></p>
                  <Pill tone={STATUS[fleetTone].tone}>{f.pct}% used</Pill>
                  <p className="text-sm text-zinc-500">{f.left >= 0 ? `${cur} ${money(f.left)} left` : `${cur} ${money(-f.left)} over`}</p>
                </div>
                <span className="block h-2.5 rounded bg-zinc-100"><span className={`block h-2.5 rounded ${STATUS[fleetTone].bar}`} style={{ width: `${Math.min(100, f.pct)}%` }} /></span>
                <p className="text-sm text-zinc-500">{f.yearGonePct}% of the period has gone. At this pace the year ends near {cur} {money(f.projected)} ({f.projectedPct}% of budget){f.projectedPct > 100 ? ", which is over." : "."}</p>
              </div>
            )}
          </Panel>

          <Panel title="Vehicle budgets" sub={`${board.rows.length} shown of ${board.total}`} flush
            action={<div className="flex gap-2"><a className={tab(filter === "attention")} href={to("")}>Over or near</a><a className={tab(filter === "all")} href={to("?show=all")}>All</a></div>}>
            {board.rows.length === 0 ? <p className="p-5 text-sm text-zinc-500">{board.total === 0 ? "No vehicle budgets yet." : "Every vehicle is on track."}</p> : (
              <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Vehicle</th><th className="text-right">Budget</th><th className="text-right">Spent</th><th>Used</th><th className="px-5">Status</th>{manage && <th />}</tr></thead>
                <tbody>{board.rows.map((r) => (
                  <tr key={r.budget_id} className="border-t border-zinc-100">
                    <td className="px-5 py-3"><a href={`/w/${slug}/vehicles/${r.vehicle_id}`}><Plate>{r.registration_no}</Plate></a>{(r.make || r.model) && <span className="ml-2 text-xs text-zinc-500">{[r.make, r.model].filter(Boolean).join(" ")}</span>}</td>
                    <td className="py-3 text-right font-mono">{money(r.amount)}</td><td className="py-3 text-right font-mono">{money(r.spent)}</td>
                    <td className="py-3"><span className="flex items-center gap-2"><span className="h-2 w-24 rounded bg-zinc-100"><span className={`block h-2 rounded ${STATUS[r.status].bar}`} style={{ width: `${Math.min(100, r.pct)}%` }} /></span><span className="font-mono">{r.pct}%</span></span></td>
                    <td className="px-5 py-3"><Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill></td>
                    {manage && <td className="pr-5 text-right"><a className="text-sky-800 underline" href={to(`?edit=${r.budget_id}`)}>Change</a></td>}
                  </tr>))}</tbody>
              </table></div>
            )}
            <p className="border-t border-zinc-100 px-5 py-4 text-sm text-zinc-500">Spent is counted from job cards raised in the period: the checked invoice amount once finance has verified it, otherwise the estimate.</p>
          </Panel>
        </div>

        <div className="space-y-5">
          {manage && (
            <Panel title={edit ? "Change a budget" : "Set a budget"} sub="Changing an amount needs a reason, which is kept in the history.">
              <BudgetForm key={edit?.id ?? "new"} slug={slug} editing={!!edit} vehicles={vehicles.map((v) => [v.id, v.registration_no])}
                initial={edit ? { id: edit.id, vehicle_id: edit.vehicle_id ?? "", period_start: edit.period_start, period_end: edit.period_end, amount: String(Number(edit.amount)) } : { period_start: `${board.year}-01-01`, period_end: `${board.year}-12-31` }} />
            </Panel>
          )}
          {manage && <Panel title="Next year" sub="Same amounts, same vehicles. Anything already set is left alone."><CopyForwardForm slug={slug} fromYear={board.year} /></Panel>}
          <Panel title="Alerts" sub="When a budget shows as near its limit or over.">
            <SettingsForm slug={slug} group="alerts" items={alertItems} />
          </Panel>
        </div>
      </div>
    </main>
  );
}
