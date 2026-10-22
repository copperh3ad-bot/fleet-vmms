import { Suspense } from "react";
import { ExportLink } from "@/components/export-link";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { Card } from "@/components/form";
import { listVehicles } from "@/lib/master/service";
import { listBudgets } from "@/lib/control/service";
import { BudgetForm } from "./form";

export default function BudgetsPage({ params, searchParams }: PageProps<"/w/[slug]/budgets">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const money = (s: string) => Number(s).toLocaleString("en-US", { maximumFractionDigits: 0 });

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const m = await requireMembership(slug);
  const driver = getDriver();
  const perms = await permissionsOf(driver, m);
  const manage = perms.has("budget.manage");
  const [rows, vehicles] = await Promise.all([listBudgets(driver, m), manage ? listVehicles(driver, m) : Promise.resolve([])]);
  const edit = typeof sp.edit === "string" ? rows.find((r) => r.id === sp.edit) : undefined;
  const year = new Date().getUTCFullYear();
  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 p-4 text-zinc-900">
      <h1 className="text-xl font-semibold">Budgets</h1>
      {manage && (
        <Card title={edit ? "Change a budget" : "Add a budget"}>
          <BudgetForm key={edit?.id ?? "new"} slug={slug} editing={!!edit} vehicles={vehicles.map((v) => [v.id, v.registration_no])}
            initial={edit ? { id: edit.id, vehicle_id: edit.vehicle_id ?? "", period_start: edit.period_start, period_end: edit.period_end, amount: String(Number(edit.amount)) } : { period_start: `${year}-01-01`, period_end: `${year}-12-31` }} />
        </Card>
      )}
      <div className="flex justify-end"><ExportLink slug={slug} kind="budgets" query={{}} /></div>
      {rows.length === 0 ? <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-600">No budgets yet.</p> : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500"><tr><th className="p-3">Applies to</th><th className="p-3">Period</th><th className="p-3 text-right">Budget</th><th className="p-3 text-right">Spent</th><th className="p-3">Used</th>{manage && <th className="p-3" />}</tr></thead>
            <tbody>{rows.map((b) => {
              const pct = Number(b.pct_used ?? 0);
              return (
                <tr key={b.id} className={`border-b border-zinc-100 last:border-0 ${b.when === "current" ? "" : "text-zinc-500"}`}>
                  <td className="p-3 font-medium">{b.registration_no ?? "Whole fleet"}</td>
                  <td className="p-3">{b.period_start} to {b.period_end}{b.when !== "current" && <span className="ml-1 text-xs">({b.when})</span>}{b.reason && <span className="block text-xs text-zinc-500">{b.reason}</span>}</td>
                  <td className="p-3 text-right tabular-nums">{money(b.amount)}</td><td className="p-3 text-right tabular-nums">{money(b.spent)}</td>
                  <td className="p-3"><span className="flex items-center gap-2"><span className="h-2 w-24 rounded bg-zinc-100"><span className={`block h-2 rounded ${b.over_budget ? "bg-red-600" : pct >= 80 ? "bg-amber-500" : "bg-sky-700"}`} style={{ width: `${Math.min(100, pct)}%` }} /></span><span className="tabular-nums">{pct}%</span></span></td>
                  {manage && <td className="p-3"><a className="text-sky-800 underline" href={`/w/${slug}/budgets?edit=${b.id}`}>Change</a></td>}
                </tr>);
            })}</tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-zinc-500">Spent is counted from job cards raised in the period: the checked invoice amount once finance has verified it, otherwise the estimate. The warning and over-limit levels are in Settings.</p>
    </main>
  );
}
