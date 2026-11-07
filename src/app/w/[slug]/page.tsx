import { dmy } from "@/lib/format/date";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { ForbiddenError, permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { getDashboard, type Dashboard } from "@/lib/dashboard/service";
import { getOverview, type Overview } from "@/lib/dashboard/overview";
import { getOnboarding, onboardingCookie } from "@/lib/dashboard/onboarding";
import { GetStarted, GetStartedShow } from "./get-started";
import { cookies } from "next/headers";
import { Kpi, Panel, Pill, Plate, btn, money } from "@/components/ui";
import { StatusBadge } from "./job-cards/status";
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
  const start = await getOnboarding(driver, m);
  const unfinished = start !== null && start.doneCount < start.steps.length;
  const hidden = (await cookies()).get(onboardingCookie(slug))?.value === "1";
  const to = (href: string) => `/w/${slug}/${href}`;
  const today = `${new Date().toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })} ${dmy(new Date())}`;

  const actions = (
    <>
      <form action={to("vehicles")} role="search"><input name="q" placeholder="Search plate or job no." aria-label="Search" className="h-10 w-56 rounded-lg border border-white/20 bg-white/95 px-3 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-500" /></form>
      {perms.has("jobcard.create") && <a href={to("job-cards/new")} className="btn-base inline-flex h-10 items-center rounded-lg bg-badge px-4 text-sm font-semibold text-side shadow-[0_6px_16px_-6px_rgb(242_184_75/0.7)] hover:brightness-105">New job card</a>}
    </>
  );

  return (
    <main className="space-y-5 p-6 text-zinc-900">
      {/* the welcome band: the one dark, lit surface on the page, so the eye starts here */}
      <header className="dash-hero rise relative overflow-hidden rounded-2xl px-6 py-6 text-white">
        <div aria-hidden className="hero-grid pointer-events-none absolute inset-0 opacity-70" />
        <div className="relative flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] font-semibold leading-tight tracking-tight">{o ? "Fleet overview" : "Home"}</h1>
            <p className="mt-1 text-sm text-[#B6C6D0]">{o ? `${today} · ${plural(o.activeVehicles, "active vehicle")}` : today}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      </header>
      {start && unfinished && !hidden && <GetStarted o={start} slug={slug} to={to} />}
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
      {d?.expenses && <Expenses e={d.expenses} to={to} />}
      {start && unfinished && hidden && <GetStartedShow slug={slug} />}
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
            <li key={a.key} className="panel rounded-xl border border-zinc-200/80 bg-white p-4">
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
      <div className="rise grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" style={{ "--i": 1 } as React.CSSProperties}>
        {o.approvals && <Kpi icon={I.check} label="Awaiting your approval" value={o.approvals.count} note={o.approvals.oldestDays !== null ? `Oldest waiting ${plural(o.approvals.oldestDays, "day")}` : "Nothing waiting"} href={to("job-cards?status=submitted")} />}
        <Kpi icon={I.card} label="Open job cards" value={o.openCards.count} note={`${o.openCards.atWorkshop} at a workshop now`} href={to("job-cards")} />
        <Kpi icon={I.coin} label={`Spend this month (${cur})`} value={money(sm.spent)}
          note={sm.monthlyBudget !== null ? <>of {cur} {money(sm.monthlyBudget)} · {sm.pacing === "over" ? <Pill tone="bad">Pacing over budget</Pill> : <Pill tone="ok">On pace</Pill>}</> : "No fleet budget set"} href={to("reports")} />
        <Kpi icon={I.gauge} label="Vehicles over budget" value={o.overBudget} note={o.costliest.some((c) => c.pct !== null) || sm.monthlyBudget !== null ? "This budget period" : "No budgets set yet"} href={to("budgets")} />
        <Kpi icon={I.wrench} label="Service due" value={o.serviceDue.overdue + o.serviceDue.soon}
          note={<>{o.serviceDue.overdue > 0 && <Pill tone="bad">{o.serviceDue.overdue} overdue</Pill>} {o.serviceDue.soon} within {o.serviceDue.warnDays} days</>} href={to("vehicles")} />
        <Kpi icon={I.doc} label="Documents expiring" value={o.docsExpiring.count} note="Within the next 30 days" href={to("compliance")} />
      </div>

      <div className={`rise grid gap-4 ${o.approvals ? "xl:grid-cols-[1.35fr_1fr]" : ""}`} style={{ "--i": 2 } as React.CSSProperties}>
        {o.approvals && (
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
        )}
        <Panel title="Service due" flush action={o.serviceDue.overdue + o.serviceDue.soon > 0 ? <a href={to("vehicles")} className={`${btn} h-8`}>See all {o.serviceDue.overdue + o.serviceDue.soon}</a> : undefined}>
          {o.serviceDue.rows.length === 0 ? <p className="p-5 text-sm text-zinc-500">Nothing is due.</p> : (
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-2.5">Vehicle</th><th>Driver</th><th>Due</th><th /></tr></thead>
              <tbody>{o.serviceDue.rows.map((r) => (
                <tr key={r.vehicle_id} className="border-t border-zinc-100">
                  <td className="px-5 py-3"><a href={to(`vehicles/${r.vehicle_id}`)}><Plate>{r.registration_no}</Plate></a><span className="mt-0.5 block text-xs text-zinc-500">{r.label}</span></td>
                  <td className="py-3 pr-3">{r.driver ?? <span className="text-zinc-600">Unassigned</span>}</td>
                  <td className="py-3 pr-3">{r.status === "overdue" ? <Pill tone="bad">{r.days !== null ? `${-r.days} days overdue` : "Overdue"}</Pill> : <Pill tone="warn">{r.days !== null ? `In ${plural(r.days, "day")}` : "Due soon"}</Pill>}</td>
                  <td className="px-5 py-3 text-right"><a href={to(`job-cards/new?vehicle=${r.vehicle_id}`)} className={`${btn} h-8`}>Raise</a></td>
                </tr>))}</tbody>
            </table>
          )}
        </Panel>
      </div>

      <div className="rise grid gap-4 xl:grid-cols-[1.35fr_1fr]" style={{ "--i": 3 } as React.CSSProperties}>
        <Panel title="Maintenance spend, last 12 months" sub={`${cur} thousands${sm.monthlyBudget !== null ? " · dashed line is the monthly budget" : ""}`}>
          <div className="chart-grid relative flex h-44 items-end gap-1 border-b sm:gap-2 border-zinc-200" role="img" aria-label={`Spend by month, this month so far ${money(sm.spent)}`}>
            {sm.monthlyBudget !== null && <div className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-red-600" style={{ bottom: `${(sm.monthlyBudget / maxBar) * 100}%` }} />}
            {o.spendByMonth.map((b, i) => (
              <div key={b.month} className="flex h-full flex-1 items-end" title={`${monthShort(b.month)}: ${money(b.cost)}`}>
                <div className={`chart-bar w-full rounded-t-md ${i === o.spendByMonth.length - 1 ? "chart-bar-now" : ""}`} style={{ height: `${Math.max(1, (b.cost / maxBar) * 100)}%`, "--i": i } as React.CSSProperties} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1 font-mono text-[9px] text-zinc-500 sm:gap-2 sm:text-[11px]">{o.spendByMonth.map((b) => <span key={b.month} className="min-w-0 flex-1 text-center">{monthShort(b.month)}</span>)}</div>
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
                    {c.pct === null
                      ? <p className="mt-1 text-xs text-zinc-500">No budget set for this vehicle</p>
                      : <div className="mt-1.5 h-2 rounded-full bg-zinc-100"><div className={`h-2 rounded-full ${over ? "bg-red-600" : "meter"}`} style={{ width: `${Math.min(100, c.pct)}%` }} /></div>}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="rise grid gap-4 lg:grid-cols-2 xl:grid-cols-3" style={{ "--i": 4 } as React.CSSProperties}>
        <Panel title="Why jobs happen" sub="Last 90 days" action={<a href={to("reports/breaking")} className={`${btn} h-8`}>Details</a>}>
          {o.whyJobs.length === 0 ? <p className="text-sm text-zinc-500">No job cards in the last 90 days.</p> : (
            <ul className="space-y-3 text-sm">{o.whyJobs.map((w) => (
              <li key={w.category} className="grid grid-cols-[9rem_1fr_2.5rem] items-center gap-3"><span>{REASON_CATEGORY[w.category] ?? w.category}</span>
                <span className="h-2 rounded-full bg-zinc-100"><span className="meter block h-2 rounded-full" style={{ width: `${w.pct}%` }} /></span><span className="text-right font-mono">{w.pct}%</span></li>))}</ul>
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

// Small line icons for the number cards. Decoration only: each card's words and numbers say everything.
const ico = (d: string) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const I = {
  check: ico("M5 12.5l4.5 4.5L19 7.5"),
  card: ico("M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6"),
  coin: ico("M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v10M9.5 9.5c0-1 1-1.7 2.5-1.7s2.5.7 2.5 1.7-1 1.5-2.5 1.8-2.5.8-2.5 1.8 1 1.7 2.5 1.7 2.5-.7 2.5-1.7"),
  gauge: ico("M4 16a8 8 0 1116 0M12 16l4-5M8 16h.01M16 16h.01"),
  wrench: ico("M14.5 6.5a4 4 0 00-5.3 5.2L4 17l3 3 5.3-5.2a4 4 0 005.2-5.3l-2.6 2.6-2.4-.6-.6-2.4z"),
  doc: ico("M7 3h7l4 4v14H7zM14 3v4h4M10 13h5M10 17h5"),
};

/** For someone limited to their own vehicle: what it has cost, month by month so far, and the latest job cards against it. */
function Expenses({ e, to }: { e: NonNullable<Dashboard["expenses"]>; to: (h: string) => string }) {
  const cur = e.currency ? `${e.currency} ` : "";
  return (
    <section aria-labelledby="exp" className="space-y-3">
      <h2 id="exp" className="text-sm font-semibold">What your vehicle has cost</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="This month" value={`${cur}${money(e.monthSpend)}`} />
        <Kpi label="This year" value={`${cur}${money(e.yearSpend)}`} />
        <Kpi label="All time" value={`${cur}${money(e.totalSpend)}`} />
        <Kpi label="Job cards open" value={String(e.openCards)} />
      </div>
      {e.byVehicle.length === 0 ? <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600">No repairs have been charged to your vehicle yet.</p> : (
        <Panel title="By vehicle" flush>
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Vehicle</th><th className="text-right">This month</th><th className="text-right">This year</th><th className="text-right">All time</th><th className="px-5 text-right">Jobs</th></tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {e.byVehicle.map((v) => (
                <tr key={v.vehicle_id}>
                  <td className="px-5 py-3"><Plate>{v.registration_no}</Plate> <span className="text-zinc-500">{v.label}</span></td>
                  <td className="text-right font-mono">{money(v.month)}</td><td className="text-right font-mono">{money(v.year)}</td><td className="text-right font-mono">{money(v.total)}</td><td className="px-5 text-right">{v.jobs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      {e.recent.length > 0 && (
        <Panel title="Latest job cards" action={<a className="text-sm text-brand hover:underline" href={to("job-cards")}>See all</a>}>
          <ul className="divide-y divide-zinc-100 text-sm">
            {e.recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <a className="font-medium text-brand hover:underline" href={to(`job-cards/${r.id}`)}>{r.job_no}</a><Plate>{r.registration_no}</Plate>
                <span className="text-zinc-500">{dayMonth(r.created_at)}</span>
                <span className="ml-auto flex items-center gap-3"><StatusBadge status={r.status} /><span className="w-24 text-right font-mono">{money(r.cost)}</span></span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </section>
  );
}
