import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { ForbiddenError, permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { getDashboard, type Dashboard } from "@/lib/dashboard/service";
import { getOverview, type Overview } from "@/lib/dashboard/overview";
import { Kpi, PageHeader, Panel, Pill, Plate, btn, btnPrimary, money } from "@/components/ui";
import { DOC_LABEL } from "@/lib/compliance/schemas";
import { REASON_CATEGORY, dayMonth, monthShort, plural } from "@/lib/labels";

export default function WorkspaceHome({ params }: PageProps<"/w/[slug]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Workspace params={params} /></Suspense>;
}

const PM: Record<string, { text: string; tone: "ok" | "warn" | "bad" | "info" | "neutral" }> = {
  overdue: { text: "Service overdue", tone: "bad" }, due_soon: { text: "Service due soon", tone: "warn" }, no_history: { text: "No service history", tone: "neutral" },
  scheduled: { text: "Service booked", tone: "info" }, ok: { text: "Service OK", tone: "ok" },
};

async function Workspace({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  if (m.role === "vendor") redirect(`/w/${slug}/vendor`);   // workshops only have their own work list
  const driver = getDriver();
  const perms = await permissionsOf(driver, m);
  let d: Dashboard | null = null;
  try { d = await getDashboard(driver, m); } catch (e) { if (!(e instanceof ForbiddenError)) throw e; }
  let o: Overview | null = null;
  if (perms.has("report.view")) o = await getOverview(driver, m);
  const to = (href: string) => `/w/${slug}/${href}`;
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  const actions = (
    <>
      <form action={to("vehicles")} role="search"><input name="q" placeholder="Search plate or job no." aria-label="Search" className="h-10 w-56 rounded-md border border-zinc-300 bg-white px-3 text-sm" /></form>
      {perms.has("jobcard.create") && <a href={to("job-cards/new")} className={btnPrimary}>New job card</a>}
    </>
  );

  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title={o ? "Fleet overview" : "Home"} sub={o ? `${today} · ${plural(o.activeVehicles, "active vehicle")}` : today} actions={actions} />
      {!d && !o && <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">Nothing is set up for your role yet. Ask your administrator.</p>}

      {o ? <OverviewBlocks o={o} to={to} /> : d && <Needs d={d} to={to} />}
      {o && d && d.actions.length > 0 && <Needs d={{ ...d, myVehicles: [] }} to={to} />}

      {d && d.myVehicles.length > 0 && (
        <Panel title={d.myVehicles.length === 1 ? "Your vehicle" : "Your vehicles"}>
          <ul className="divide-y divide-zinc-100 text-sm">
            {d.myVehicles.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <a href={to(`vehicles/${v.id}`)}><Plate>{v.registration_no}</Plate></a><span className="text-zinc-500">{v.label}</span>
                <span className="ml-auto flex flex-wrap gap-2">
                  {v.pm_worst && <Pill tone={PM[v.pm_worst].tone}>{PM[v.pm_worst].text}</Pill>}
                  {v.docs_expired > 0 && <Pill tone="bad">{plural(v.docs_expired, "document")} expired</Pill>}
                  {v.docs_due > 0 && <Pill tone="warn">{v.docs_due} expiring soon</Pill>}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </main>
  );
}

function Needs({ d, to }: { d: Dashboard; to: (h: string) => string }) {
  return (
    <section aria-labelledby="todo" className="space-y-2">
      <h2 id="todo" className="text-sm font-semibold">Needs you</h2>
      {d.actions.length === 0 ? <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600">Nothing is waiting for you.</p> : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {d.actions.map((a) => (
            <li key={a.key} className="rounded-lg border border-zinc-200 bg-white p-4">
              <a href={to(a.href)} className="flex items-baseline gap-3"><span className="font-mono text-[28px] font-semibold">{a.count}</span><span className="text-sm text-brand hover:underline">{a.label}</span></a>
              {a.samples.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-zinc-500">{a.samples.map((s) => <li key={s.href}><a className="hover:underline" href={to(s.href)}>{s.text}</a></li>)}</ul>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OverviewBlocks({ o, to }: { o: Overview; to: (h: string) => string }) {
  const cur = o.currency || "PKR";
  const sm = o.spendMonth;
  const monthName = new Date().toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const maxBar = Math.max(1, ...o.spendByMonth.map((x) => x.cost), o.spendMonth.monthlyBudget ?? 0);
  const k = (n: number) => `${Math.round(n / 1000).toLocaleString("en-US")}k`;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {o.approvals && <Kpi label="Awaiting your approval" value={o.approvals.count} note={o.approvals.oldestDays !== null ? `Oldest waiting ${plural(o.approvals.oldestDays, "day")}` : "Nothing waiting"} href={to("job-cards?status=submitted")} />}
        <Kpi label="Open job cards" value={o.openCards.count} note={`${o.openCards.atWorkshop} at a workshop now`} href={to("job-cards")} />
        <Kpi label="Spend this month" value={money(sm.spent)}
          note={sm.monthlyBudget !== null ? <>of {cur} {money(sm.monthlyBudget)} · {sm.pacing === "over" ? <Pill tone="bad">Pacing over budget</Pill> : <Pill tone="ok">On pace</Pill>}</> : "No fleet budget set"} href={to("reports")} />
        <Kpi label="Vehicles over budget" value={o.overBudget} note="This budget period" href={to("budgets")} />
        <Kpi label="Service due" value={o.serviceDue.overdue + o.serviceDue.soon}
          note={<>{o.serviceDue.overdue > 0 && <Pill tone="bad">{o.serviceDue.overdue} overdue</Pill>} {o.serviceDue.soon} within {o.serviceDue.warnDays} days</>} href={to("vehicles")} />
        <Kpi label="Documents expiring" value={o.docsExpiring.count} note="Within the next 30 days" href={to("compliance")} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        {o.approvals ? (
          <Panel title="Approval queue" flush action={<a href={to("job-cards?status=submitted")} className={`${btn} h-8`}>Open all {o.approvals.count}</a>}>
            {o.approvals.rows.length === 0 ? <p className="p-5 text-sm text-zinc-500">Nothing is waiting for your approval.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-2.5">Job card</th><th>Vehicle</th><th>Reason</th><th>Requested by</th><th className="text-right">Estimate ({cur})</th><th className="px-5">Waiting</th></tr></thead>
                <tbody>{o.approvals.rows.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-100 align-top">
                    <td className="px-5 py-3 font-mono"><a className="hover:underline" href={to(`job-cards/${r.id}`)}>{r.job_no}</a></td>
                    <td className="py-3 pr-3"><Plate>{r.registration_no}</Plate></td>
                    <td className="py-3 pr-3">{r.reason}{r.repeat && <span className="ml-1"><Pill tone="warn">Repeat</Pill></span>}</td>
                    <td className="py-3 pr-3">{r.requester}</td>
                    <td className="py-3 pr-3 text-right font-mono">{r.estimate === null ? "—" : money(r.estimate)}</td>
                    <td className="px-5 py-3 whitespace-nowrap">{r.waiting_days === 0 ? "Today" : plural(r.waiting_days, "day")}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </Panel>
        ) : <div />}
        <Panel title="Service due" flush action={<a href={to("vehicles")} className={`${btn} h-8`}>See all {o.serviceDue.overdue + o.serviceDue.soon}</a>}>
          {o.serviceDue.rows.length === 0 ? <p className="p-5 text-sm text-zinc-500">Nothing is due.</p> : (
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-2.5">Vehicle</th><th>Driver</th><th>Due</th><th /></tr></thead>
              <tbody>{o.serviceDue.rows.map((r) => (
                <tr key={r.vehicle_id} className="border-t border-zinc-100">
                  <td className="px-5 py-3"><a href={to(`vehicles/${r.vehicle_id}`)}><Plate>{r.registration_no}</Plate></a><span className="mt-0.5 block text-xs text-zinc-500">{r.label}</span></td>
                  <td className="py-3 pr-3">{r.driver ?? <span className="text-zinc-400">Unassigned</span>}</td>
                  <td className="py-3 pr-3">{r.status === "overdue" ? <Pill tone="bad">{r.days !== null ? `${-r.days} days overdue` : "Overdue"}</Pill> : <Pill tone="warn">{r.days !== null ? `In ${plural(r.days, "day")}` : "Due soon"}</Pill>}</td>
                  <td className="px-5 py-3 text-right"><a href={to(`job-cards/new?vehicle=${r.vehicle_id}`)} className={`${btn} h-8`}>Raise</a></td>
                </tr>))}</tbody>
            </table>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Panel title="Maintenance spend, last 12 months" sub={`${cur} thousands${sm.monthlyBudget !== null ? " · dashed line is the monthly budget" : ""}`}>
          <div className="relative flex h-44 items-end gap-2 border-b border-zinc-100" role="img" aria-label={`Spend by month, this month so far ${money(sm.spent)}`}>
            {sm.monthlyBudget !== null && <div className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-red-600" style={{ bottom: `${(sm.monthlyBudget / maxBar) * 100}%` }} />}
            {o.spendByMonth.map((b, i) => (
              <div key={b.month} className="flex h-full flex-1 items-end" title={`${monthShort(b.month)}: ${money(b.cost)}`}>
                <div className={`w-full rounded-t-[3px] ${i === o.spendByMonth.length - 1 ? "bg-brand/50" : "bg-brand"}`} style={{ height: `${Math.max(1, (b.cost / maxBar) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-2 font-mono text-[11px] text-zinc-500">{o.spendByMonth.map((b) => <span key={b.month} className="flex-1 text-center">{monthShort(b.month)}</span>)}</div>
          <p className="mt-3 text-sm text-zinc-500">
            {monthName} so far is {k(sm.spent)} after {plural(sm.daysElapsed, "day")}.
            {sm.monthlyBudget !== null && sm.pctOverPace !== null && <> At this pace the month ends near {k(sm.projected)}, about {Math.abs(sm.pctOverPace)}% {sm.pctOverPace > 0 ? "over" : "under"} budget.</>}
          </p>
        </Panel>
        <Panel title="Costliest vehicles" sub="This budget year" flush>
          {o.costliest.length === 0 ? <p className="p-5 text-sm text-zinc-500">No spending yet.</p> : (
            <ul className="space-y-4 p-5">
              {o.costliest.map((c) => {
                const over = (c.pct ?? 0) >= 100;
                return (
                  <li key={c.vehicle_id}>
                    <div className="flex items-center justify-between gap-2 text-sm"><a href={to(`vehicles/${c.vehicle_id}`)}><Plate>{c.registration_no}</Plate></a>
                      <span className="font-mono">{money(c.spent)}{c.pct !== null && <> · <span className={over ? "font-semibold text-red-700" : ""}>{Math.round(c.pct)}%</span></>}</span></div>
                    <div className="mt-1.5 h-2 rounded bg-zinc-100"><div className={`h-2 rounded ${over ? "bg-red-600" : "bg-brand"}`} style={{ width: `${Math.min(100, c.pct ?? 0)}%` }} /></div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Panel title="Why jobs happen" sub="Last 90 days" action={<a href={to("reports/breaking")} className={`${btn} h-8`}>Details</a>}>
          {o.whyJobs.length === 0 ? <p className="text-sm text-zinc-500">No job cards in the last 90 days.</p> : (
            <ul className="space-y-3 text-sm">{o.whyJobs.map((w) => (
              <li key={w.category} className="grid grid-cols-[9rem_1fr_2.5rem] items-center gap-3"><span>{REASON_CATEGORY[w.category] ?? w.category}</span>
                <span className="h-2 rounded bg-zinc-100"><span className="block h-2 rounded bg-brand" style={{ width: `${w.pct}%` }} /></span><span className="text-right font-mono">{w.pct}%</span></li>))}</ul>
          )}
        </Panel>
        <Panel title="Documents expiring" action={<a href={to("compliance")} className={`${btn} h-8`}>Compliance</a>} flush>
          {o.docsExpiring.rows.length === 0 ? <p className="p-5 text-sm text-zinc-500">Nothing expires in the next 30 days.</p> : (
            <ul className="divide-y divide-zinc-100 text-sm">{o.docsExpiring.rows.map((r) => (
              <li key={r.entity_id} className="flex items-center gap-3 px-5 py-3"><Plate>{r.registration_no}</Plate><span className="flex-1">{DOC_LABEL[r.doc_type] ?? r.doc_type}</span>
                <Pill tone={r.days_left < 0 ? "bad" : "warn"}>{r.days_left < 0 ? "Expired" : dayMonth(r.expires_on)}</Pill></li>))}</ul>
          )}
        </Panel>
        <Panel title="Workshop scorecard" sub="Last 90 days" flush>
          {o.scorecard.length === 0 ? <p className="p-5 text-sm text-zinc-500">No finished work yet.</p> : (
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-2.5">Workshop</th><th>Days</th><th>Quote vs bill</th><th className="px-5 text-right">Rework</th></tr></thead>
              <tbody>{o.scorecard.map((s) => (
                <tr key={s.vendor_id} className="border-t border-zinc-100"><td className="px-5 py-3">{s.name}</td>
                  <td className="py-3 pr-3 font-mono">{s.avg_days ?? "—"}</td>
                  <td className={`py-3 pr-3 font-mono ${(s.quote_vs_bill_pct ?? 0) > 5 ? "text-red-700" : ""}`}>{s.quote_vs_bill_pct === null ? "—" : `${s.quote_vs_bill_pct > 0 ? "+" : ""}${s.quote_vs_bill_pct}%`}</td>
                  <td className={`px-5 py-3 text-right font-mono ${(s.rework_pct ?? 0) >= 8 ? "text-red-700" : ""}`}>{s.rework_pct === null ? "—" : `${s.rework_pct}%`}</td></tr>))}</tbody>
            </table>
          )}
        </Panel>
      </div>
    </>
  );
}
