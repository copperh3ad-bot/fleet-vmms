import { Suspense } from "react";
import { ExportLink } from "@/components/export-link";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { GROUPS, PERIODS, breakingReport } from "@/lib/analytics/breaking";
import { PageHeader, Panel, Pill, Plate, money } from "@/components/ui";
import { REASON_CATEGORY, dayMonth, plural } from "@/lib/labels";

export default function BreakingPage({ params, searchParams }: PageProps<"/w/[slug]/reports/breaking">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const GROUP_LABEL: Record<string, string> = { driver: "Driver", vehicle: "Vehicle", workshop: "Workshop" };
const PERIOD_LABEL: Record<number, string> = { 30: "Last 30 days", 90: "Last 90 days", 180: "Last 6 months", 365: "Last 12 months" };
const long = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const mil = (n: number) => (n >= 1_000_000 ? `PKR ${(n / 1_000_000).toFixed(2)} million` : `PKR ${money(n)}`);

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const m = await requireMembership(slug, { fullScope: true });
  const r = await breakingReport(getDriver(), m, { days: Number(sp.days), group: typeof sp.group === "string" ? sp.group : undefined });
  const to = (p: string) => `/w/${slug}/${p}`;
  const avg = r.jobs ? r.cost / r.jobs : 0;
  const maxJobs = Math.max(1, ...r.reasons.map((x) => x.jobs));
  const note = r.reasonNote;
  const sel = "h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm";

  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Why it keeps breaking" sub={`${plural(r.jobs, "job card")} · ${mil(r.cost)} · ${long(r.from)} to ${long(r.to)}`} actions={
        <>
          <form className="flex flex-wrap items-end gap-3" aria-label="Report options">
            <label className="text-xs text-zinc-500">Period<select name="days" defaultValue={r.days} className={`${sel} mt-1 block`}>{PERIODS.map((d) => <option key={d} value={d}>{PERIOD_LABEL[d]}</option>)}</select></label>
            <label className="text-xs text-zinc-500">Group by<select name="group" defaultValue={r.group} className={`${sel} mt-1 block`}>{GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}</select></label>
            <button className={`${sel} font-medium hover:bg-zinc-50`}>Show</button>
          </form>
          <ExportLink slug={slug} kind="repeat-repairs" label="Export CSV" />
        </>} />

      <Panel title="Is the data good enough to trust?">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <span className="flex items-center gap-2"><Pill tone={r.quality.otherOk ? "ok" : "warn"}>{r.quality.otherPct}%</Pill> of jobs use “Other” as the reason. Target is under 10%.</span>
          <span className="flex items-center gap-2"><Pill tone={r.quality.shortNotes === 0 ? "ok" : "warn"}>{r.quality.shortNotes}</Pill> cause notes shorter than 25 characters.</span>
          <span className="flex items-center gap-2"><Pill tone="ok">{r.quality.noReason}</Pill> jobs without a reason.</span>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <Panel title="Jobs by reason" sub="Ordered by number of jobs" flush>
          {r.reasons.length === 0 ? <p className="p-5 text-sm text-zinc-500">No job cards in this period.</p> : (
            <>
              <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Reason</th><th>Jobs</th><th /><th className="text-right">Share</th><th className="text-right">Running total</th><th className="px-5 text-right">Cost (PKR k)</th></tr></thead>
                <tbody>{r.reasons.map((x) => (
                  <tr key={x.category} className="border-t border-zinc-100">
                    <td className="px-5 py-3">{REASON_CATEGORY[x.category] ?? x.category}{x.costly && <span className="ml-2"><Pill tone="bad">Costly</Pill></span>}</td>
                    <td className="py-3 pr-2"><span className="block h-2 w-24 rounded bg-zinc-100"><span className="block h-2 rounded bg-brand" style={{ width: `${(x.jobs / maxJobs) * 100}%` }} /></span></td>
                    <td className="py-3 font-mono">{x.jobs}</td><td className="py-3 text-right font-mono">{x.share}%</td><td className="py-3 text-right font-mono">{x.running}%</td>
                    <td className="px-5 py-3 text-right font-mono">{money(x.cost / 1000)}</td>
                  </tr>))}</tbody>
              </table></div>
              {note && <p className="border-t border-zinc-100 px-5 py-4 text-sm text-zinc-500">{REASON_CATEGORY[note.top] ?? note.top} is the most common reason.{note.dear && <> {REASON_CATEGORY[note.dear.category] ?? note.dear.category} costs {money(note.dear.avgCost)} per job, {note.dear.multiple} times the average{avg ? ` of ${money(avg)}` : ""}.</>}</p>}
            </>
          )}
        </Panel>

        <Panel title="Repeat repairs" sub="Same vehicle, same reason, more than once" flush>
          {r.repeats.rows.length === 0 ? <p className="p-5 text-sm text-zinc-500">None in this period.</p> : (
            <>
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Vehicle</th><th>Reason</th><th className="text-right">Times</th><th className="text-right">Gap</th><th className="px-5 text-right">PKR</th></tr></thead>
                <tbody>{r.repeats.rows.map((x) => (
                  <tr key={`${x.vehicle_id}-${x.reason}`} className="border-t border-zinc-100">
                    <td className="px-5 py-3"><a href={to(`vehicles/${x.vehicle_id}`)}><Plate>{x.registration_no}</Plate></a></td><td className="py-3">{x.reason}</td>
                    <td className="py-3 text-right font-mono">{x.times}</td><td className="py-3 text-right font-mono">{x.gapDays} d</td><td className="px-5 py-3 text-right font-mono">{money(x.cost)}</td>
                  </tr>))}</tbody>
              </table>
              <p className="border-t border-zinc-100 px-5 py-4 text-sm text-zinc-500">{plural(r.repeats.jobs, "job")}, PKR {money(r.repeats.cost)}. Ask the workshop whether the first repair was under guarantee before approving the second.</p>
            </>
          )}
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <Panel title={`By ${r.group}`} sub={PERIOD_LABEL[r.days]} flush>
          {r.groups.length === 0 ? <p className="p-5 text-sm text-zinc-500">Nothing to show.</p> : (
            <>
              <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr>
                  <th className="px-5 py-3">{GROUP_LABEL[r.group]}</th>{r.group === "driver" && <th>Vehicle</th>}<th className="text-right">Jobs</th><th className="text-right">Cost (PKR)</th>
                  {r.group !== "workshop" && <th className="text-right">Jobs per 10,000 km</th>}<th className="px-5 text-right">Misuse jobs</th></tr></thead>
                <tbody>{r.groups.map((g) => (
                  <tr key={g.key} className="border-t border-zinc-100 align-top">
                    <td className="px-5 py-3">{r.group === "vehicle" && g.vehicle_id ? <a href={to(`vehicles/${g.vehicle_id}`)}><Plate>{g.label}</Plate></a> : g.label}{g.sub && <span className="block text-xs text-zinc-500">{g.sub}</span>}</td>
                    {r.group === "driver" && <td className="py-3">{g.vehicle && <Plate>{g.vehicle}</Plate>}</td>}
                    <td className="py-3 text-right font-mono">{g.jobs}</td><td className="py-3 text-right font-mono">{money(g.cost)}</td>
                    {r.group !== "workshop" && <td className="py-3 text-right font-mono">{g.per10k ?? "—"}</td>}
                    <td className="px-5 py-3 text-right font-mono">{g.misuse}</td>
                  </tr>))}</tbody>
              </table></div>
              <p className="border-t border-zinc-100 px-5 py-4 text-sm text-zinc-500">These are prompts for a conversation, not verdicts. A driver on a rough route or a heavy load will look worse than one on an easy route.</p>
            </>
          )}
        </Panel>

        <Panel title="What drivers wrote" sub="Grouped by keyword">
          {r.keywords.length === 0 ? <p className="text-sm text-zinc-500">No notes to group yet.</p> : (
            <>
              <div className="flex flex-wrap gap-2">{r.keywords.map((k) => <span key={k.label} className="rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-800">{k.label} · {k.count}</span>)}</div>
              <ul className="mt-4 space-y-4 text-sm">{r.quotes.map((q) => (
                <li key={q.job_id} className="border-b border-zinc-100 pb-3 last:border-0 last:pb-0">
                  <p>“{q.text}”</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500"><a href={to(`job-cards/${q.job_id}`)}><Plate>{q.registration_no}</Plate></a> · {q.keyword}{q.repeat && <> · <span className="text-amber-800">repeat repair</span></>}</p>
                </li>))}</ul>
            </>
          )}
        </Panel>
      </div>
      <p className="text-xs text-zinc-500">Cost is the checked invoice amount once finance has verified it, otherwise the estimate. {dayMonth(r.from)} to {dayMonth(r.to)}.</p>
    </main>
  );
}
