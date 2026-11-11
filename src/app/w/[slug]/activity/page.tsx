import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { ACTIVITY_DAYS, ACTIVITY_PAGE, listCompanyActivity, tableLabel } from "@/lib/activity/company-log";
import { dmyTime } from "@/lib/format/date";
import { PageHeader, Panel, Pill, type Tone } from "@/components/ui";

export default function ActivityPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ table?: string; days?: string }> }) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const TONE: Record<string, Tone> = { INSERT: "ok", UPDATE: "info", DELETE: "bad" };
const VERB: Record<string, string> = { INSERT: "Added", UPDATE: "Changed", DELETE: "Removed" };

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ table?: string; days?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const m = await requireMembership(slug, { fullScope: true });
  const days = Number(sp.days) || 30;
  const { rows, tables } = await listCompanyActivity(getDriver(), m, { table: sp.table || undefined, days });
  const shownDays = (ACTIVITY_DAYS as readonly number[]).includes(days) ? days : 30;
  const control = "h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm";
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Activity log" sub="Who added, changed or removed what in your company, and every download. Read-only. It shows which fields changed, not the values." />
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Records<select name="table" defaultValue={sp.table ?? ""} className={`${control} mt-1 block`}>
          <option value="">All</option>
          {tables.map((t) => <option key={t} value={t}>{tableLabel(t)}</option>)}
        </select></label>
        <label className="text-sm">Period<select name="days" defaultValue={String(shownDays)} className={`${control} mt-1 block`}>
          {ACTIVITY_DAYS.map((d) => <option key={d} value={d}>{d === 1 ? "Last day" : `Last ${d} days`}</option>)}
        </select></label>
        <button type="submit" className={`${control} font-medium`}>Show</button>
      </form>
      <Panel title={`${rows.length}${rows.length === ACTIVITY_PAGE ? "+" : ""} entries`} sub={rows.length === ACTIVITY_PAGE ? `The newest ${ACTIVITY_PAGE}. Narrow it with a record type or a shorter period.` : undefined} flush>
        {rows.length === 0 ? <p className="p-5 text-sm text-zinc-500">Nothing in this period.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">When</th><th>Who</th><th>What</th><th>Record</th><th className="px-5">Fields changed</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100 align-top">
                <td className="px-5 py-3 whitespace-nowrap">{dmyTime(r.at)}</td>
                <td className="py-3">{r.actor_name ?? "System or a link"}</td>
                <td className="py-3"><Pill tone={TONE[r.action] ?? "neutral"}>{VERB[r.action] ?? r.action}</Pill></td>
                <td className="py-3">{tableLabel(r.table_name)}{r.row_id && <span className="block font-mono text-xs text-zinc-500">{r.row_id.slice(0, 8)}</span>}</td>
                <td className="px-5 py-3 text-zinc-600">{r.changed?.length ? r.changed.map((c) => c.replace(/_/g, " ")).join(", ") : "—"}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Panel>
    </main>
  );
}
