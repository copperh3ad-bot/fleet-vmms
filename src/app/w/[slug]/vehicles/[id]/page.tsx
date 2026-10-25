import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { listEmployeeOptions } from "@/lib/master/service";
import { getVehicleRecord, type RecordService } from "@/lib/master/record";
import { Kpi, Panel, Pill, Plate, btn, btnPrimary, money, type Tone } from "@/components/ui";
import { DOC_LABEL } from "@/lib/compliance/schemas";
import { REASON_CATEGORY, dayMonth, plural } from "@/lib/labels";
import { listVehicleFiles } from "@/lib/master/files";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { StatusBadge } from "../../job-cards/status";
import { removeVehicleFileAction, uploadVehicleFileAction } from "../actions";
import { VehicleFileRemove, VehicleFileUpload } from "./files";
import { CustodyForms, StatusForm } from "./forms";

export default function VehiclePage({ params, searchParams }: PageProps<"/w/[slug]/vehicles/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABS = [["history", "History"], ["costs", "Costs"], ["odometer", "Odometer"], ["documents", "Documents"], ["drivers", "Driver history"]] as const;
const long = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const SOURCE: Record<string, string> = { tracker: "Tracker", monthly_entry: "Monthly entry", job_card: "Job card", manual: "Entered by hand", baseline: "Starting value" };

function dueTone(s: RecordService): { tone: Tone; text: string } {
  if (s.status === "overdue") return { tone: "bad", text: s.days_remaining !== null ? `${-s.days_remaining} days overdue` : "Overdue" };
  if (s.status === "due_soon") return { tone: "warn", text: s.days_remaining !== null ? `In ${plural(s.days_remaining, "day")}` : "Due soon" };
  if (s.status === "no_history") return { tone: "neutral", text: "No history" };
  if (s.status === "scheduled") return { tone: "info", text: "Booked" };
  return { tone: "ok", text: s.days_remaining !== null ? `In ${s.days_remaining} days` : "OK" };
}

async function Inner({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug, id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const m = await requireMembership(slug, { fullScope: true });
  const driver = getDriver();
  const perms = await permissionsOf(driver, m);
  const v = await getVehicleRecord(driver, m, id);
  if (!v) notFound();
  const files = await listVehicleFiles(driver, await supabaseBlobStore(), m, id).catch(() => []);
  const canFiles = perms.has("vehicle.write");
  const tab = TABS.some(([k]) => k === sp.tab) ? String(sp.tab) : "history";
  const canWrite = perms.has("vehicle.write");
  const employees = canWrite ? await listEmployeeOptions(driver, m) : [];
  const to = (p: string) => `/w/${slug}/${p}`;
  const next = v.nextService;
  const nextTone = next ? dueTone(next) : null;
  const over = (v.pct ?? 0) >= 100;
  const periodLabel = v.period.fromBudget ? `${v.period.start.slice(0, 4)}` : `${new Date().getUTCFullYear()}`;
  const costTotal = v.jobs.reduce((s, j) => s + j.cost, 0);

  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <div className="flex flex-wrap items-center gap-4">
        <a href={to("vehicles")} aria-label="Back to all vehicles"><Plate large>{v.registration_no}</Plate></a>
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-semibold leading-tight">{[v.make, v.model, v.year].filter(Boolean).join(" ") || v.registration_no}</h1>
          <p className="text-sm text-zinc-500 capitalize">{v.status.replace("_", " ")}{v.holder && <> · driver <span className="font-medium text-zinc-900 normal-case">{v.holder.name}</span>{v.holder.department && <span className="normal-case">, {v.holder.department}</span>}<span className="normal-case">, since {long(v.holder.since)}</span></>}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && <a href="#manage" className={btn}>Transfer to another driver</a>}
          {perms.has("odometer.review") && <a href={to("odometer")} className={btn}>Log odometer</a>}
          {perms.has("jobcard.create") && <a href={to(`job-cards/new?vehicle=${v.id}`)} className={btnPrimary}>Raise job card</a>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label={`Spend in ${periodLabel}`} value={money(v.spend)} note={v.budget !== null ? <>{v.pct !== null && <Pill tone={over ? "bad" : "ok"}>{Math.round(v.pct)}% of budget</Pill>} {money(v.budget)}</> : "No budget set"} />
        <Kpi label="Jobs in last 90 days" value={v.jobs90} note={`Fleet average is ${v.fleetAvgJobs90}`} />
        <Kpi label="Repeat repairs" value={v.repeats.count} note={v.repeats.text ?? "None this period"} />
        <Kpi label="Next service" value={next?.due_on ? dayMonth(next.due_on) : "—"} mono={false}
          note={next ? <>{nextTone && <Pill tone={nextTone.tone}>{nextTone.text}</Pill>} {next.label}{v.serviceRuleText ? ` · ${v.serviceRuleText}` : ""}</> : "No service rules apply"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <Panel flush>
            <nav className="flex gap-6 border-b border-zinc-100 px-5" aria-label="Vehicle sections">
              {TABS.map(([k, label]) => (
                <a key={k} href={`${to(`vehicles/${v.id}`)}?tab=${k}`} aria-current={k === tab ? "page" : undefined}
                  className={`-mb-px border-b-2 py-3.5 text-sm font-medium ${k === tab ? "border-brand text-brand" : "border-transparent text-zinc-500 hover:text-zinc-900"}`}>{label}</a>
              ))}
            </nav>

            {tab === "history" && (v.jobs.length === 0 ? <p className="p-5 text-sm text-zinc-500">No job cards yet.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Date</th><th>Job card</th><th>Reason</th><th>What the driver wrote</th><th className="px-5">Workshop</th></tr></thead>
                <tbody>{v.jobs.map((j) => (
                  <tr key={j.id} className="border-t border-zinc-100 align-top">
                    <td className="px-5 py-3 font-mono text-[13px] whitespace-nowrap">{dayMonth(j.created_at)}</td>
                    <td className="py-3 pr-3"><a className="font-mono hover:underline" href={to(`job-cards/${j.id}`)}>{j.job_no}</a><span className="mt-1 block"><StatusBadge status={j.status} /></span></td>
                    <td className="py-3 pr-3"><span className="flex flex-wrap gap-1"><Pill tone="neutral">{j.reason}</Pill>{j.repeat && <Pill tone="warn">Repeat repair</Pill>}</span></td>
                    <td className="py-3 pr-3 max-w-[22rem] text-zinc-700">{j.cause_text}</td>
                    <td className="px-5 py-3">{j.vendor ?? <span className="text-zinc-600">Not assigned</span>}</td>
                  </tr>))}</tbody>
              </table></div>
            ))}

            {tab === "costs" && (v.jobs.length === 0 ? <p className="p-5 text-sm text-zinc-500">No costs yet.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Date</th><th>Job card</th><th>Reason</th><th className="text-right">Cost</th><th className="px-5 text-right">Share</th></tr></thead>
                <tbody>{v.jobs.filter((j) => j.cost > 0).map((j) => (
                  <tr key={j.id} className="border-t border-zinc-100"><td className="px-5 py-3 font-mono text-[13px]">{dayMonth(j.created_at)}</td>
                    <td className="py-3"><a className="font-mono hover:underline" href={to(`job-cards/${j.id}`)}>{j.job_no}</a></td><td className="py-3">{j.reason}</td>
                    <td className="py-3 text-right font-mono">{money(j.cost)}</td><td className="px-5 py-3 text-right font-mono">{costTotal ? Math.round((j.cost / costTotal) * 100) : 0}%</td></tr>))}</tbody>
                <tfoot><tr className="border-t border-zinc-200 font-medium"><td colSpan={3} className="px-5 py-3 text-right">All time</td><td className="py-3 text-right font-mono">{money(costTotal)}</td><td /></tr></tfoot>
              </table></div>
            ))}

            {tab === "odometer" && (v.readings.length === 0 ? <p className="p-5 text-sm text-zinc-500">No readings yet.</p> : (
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Date</th><th className="text-right">Reading</th><th className="pl-6">Source</th><th className="px-5">Status</th></tr></thead>
                <tbody>{v.readings.map((r, i) => (
                  <tr key={i} className="border-t border-zinc-100"><td className="px-5 py-3 font-mono text-[13px]">{long(r.read_at)}</td><td className="py-3 text-right font-mono">{money(r.reading_km)} km</td>
                    <td className="py-3 pl-6">{SOURCE[r.source] ?? r.source}</td><td className="px-5 py-3">{r.status === "accepted" ? <Pill tone="ok">Accepted</Pill> : r.status === "flagged" ? <Pill tone="warn">Held for checking</Pill> : <Pill tone="neutral">Dismissed</Pill>}</td></tr>))}</tbody>
              </table>
            ))}

            {tab === "documents" && (
              <div className="p-5">
                {v.docs.length === 0 ? <p className="text-sm text-zinc-500">No documents recorded.</p> : (
                  <ul className="divide-y divide-zinc-100 text-sm">{v.docs.map((d) => (
                    <li key={d.entity_id} className="flex flex-wrap items-center gap-3 py-3"><a className="hover:underline" href={to(`compliance/${d.entity_type}/${d.entity_id}`)}>{DOC_LABEL[d.doc_type] ?? d.doc_type}</a>
                      <span className="ml-auto flex items-center gap-3"><span className="font-mono text-[13px]">{long(d.expires_on)}</span><Pill tone={d.doc_status === "expired" ? "bad" : d.doc_status === "ok" ? "ok" : "warn"}>{d.days_left < 0 ? `Expired ${-d.days_left} days ago` : `${d.days_left} days left`}</Pill></span></li>))}</ul>
                )}
                {perms.has("compliance.manage") && <a className={`${btn} mt-4`} href={to(`compliance/new?vehicle=${v.id}`)}>Add or renew a document</a>}
              </div>
            )}

            {tab === "drivers" && (
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Person</th><th>From</th><th>To</th><th className="px-5 text-right">Cost while held</th></tr></thead>
                <tbody>{v.holders.length === 0 && <tr><td colSpan={4} className="px-5 py-4 text-zinc-500">No custody recorded.</td></tr>}
                  {v.holders.map((h, i) => (
                    <tr key={i} className="border-t border-zinc-100"><td className="px-5 py-3">{h.name}{h.department && <span className="block text-xs text-zinc-500">{h.department}</span>}</td>
                      <td className="py-3 font-mono text-[13px]">{long(h.from_date)}</td><td className="py-3">{h.to_date ? <span className="font-mono text-[13px]">{long(h.to_date)}</span> : <Pill tone="ok">Current</Pill>}</td>
                      <td className="px-5 py-3 text-right font-mono">{money(h.cost)}</td></tr>))}</tbody>
              </table>
            )}
          </Panel>

          {canWrite && (
            <Panel title="Manage this vehicle" sub="Past holders stay on the record, and costs go to whoever held the vehicle when the job card was raised.">
              <div id="manage" className="space-y-4 scroll-mt-6">
                <CustodyForms slug={slug} vehicleId={v.id} employees={employees} hasHolder={!!v.holder} />
                <StatusForm slug={slug} vehicleId={v.id} current={v.status} />
              </div>
            </Panel>
          )}
        </div>

        <div className="space-y-4">
          <Panel title={`Budget, ${periodLabel}`} action={v.budget !== null && v.spend > v.budget ? <Pill tone="bad">Over by {money(v.spend - v.budget)}</Pill> : undefined}>
            {v.budget === null ? <p className="text-sm text-zinc-500">No budget is set for this vehicle. <a className="text-brand underline" href={to("budgets")}>Set one</a>.</p> : (
              <>
                <p className="flex items-baseline justify-between font-mono"><span className="text-[22px]">{money(v.spend)}</span><span className="text-zinc-500">of {money(v.budget)}</span></p>
                <div className="mt-2 h-2 rounded bg-zinc-100"><div className={`h-2 rounded ${over ? "bg-red-600" : "bg-brand"}`} style={{ width: `${Math.min(100, v.pct ?? 0)}%` }} /></div>
                <p className="mt-2 text-xs text-zinc-500">{v.budgetUsedUpOn ? `Budget was used up on ${dayMonth(v.budgetUsedUpOn)}.` : "Still inside the budget."}{v.monthsRemaining !== null && ` ${plural(v.monthsRemaining, "month")} of the period remain.`}</p>
              </>
            )}
          </Panel>

          <Panel title="Why it needed work" sub={`${periodLabel}, by cost`}>
            {v.reasons.length === 0 ? <p className="text-sm text-zinc-500">No costs this period.</p> : (
              <ul className="space-y-3 text-sm">{v.reasons.map((r) => {
                const max = Math.max(...v.reasons.map((x) => x.cost), 1);
                return (<li key={r.category}><div className="flex justify-between"><span>{REASON_CATEGORY[r.category] ?? r.category} · {plural(r.jobs, "job")}</span><span className="font-mono">{money(r.cost)}</span></div>
                  <div className="mt-1 h-2 rounded bg-zinc-100"><div className="h-2 rounded bg-brand" style={{ width: `${(r.cost / max) * 100}%` }} /></div></li>);
              })}</ul>
            )}
          </Panel>

          <Panel title="Servicing and odometer">
            <dl className="divide-y divide-zinc-100 text-sm">
              {[
                ["Last service", v.lastService ? <span key="l" className="font-mono">{dayMonth(v.lastService.date)}{v.lastService.km !== null && ` · ${money(v.lastService.km)} km`}</span> : "—"],
                ["Next service", next && nextTone ? <Pill key="n" tone={nextTone.tone}>{next.due_on ? `${dayMonth(next.due_on)}, ${nextTone.text.toLowerCase()}` : nextTone.text}</Pill> : "—"],
                ["Odometer", <span key="o" className="font-mono">{money(v.odometer_km)} km</span>],
                ["Last reading", v.odometer_updated_at ? <span key="r" className="font-mono">{dayMonth(v.odometer_updated_at)}{v.readings[0] ? `, ${(SOURCE[v.readings[0].source] ?? v.readings[0].source).toLowerCase()}` : ""}</span> : "—"],
                ["Since last service", v.sinceServiceKm !== null ? <span key="s" className="font-mono">{money(v.sinceServiceKm)} km</span> : "—"],
              ].map(([k, val]) => <div key={String(k)} className="flex items-center justify-between gap-3 py-2.5"><dt className="text-zinc-500">{k}</dt><dd>{val}</dd></div>)}
            </dl>
          </Panel>

          <Panel title="Who held it, and what it cost">
            {v.holders.length === 0 ? <p className="text-sm text-zinc-500">No custody recorded.</p> : (
              <ul className="divide-y divide-zinc-100 text-sm">{v.holders.map((h, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 py-2.5"><span>{h.name}<span className="block text-xs text-zinc-500">{long(h.from_date)} to {h.to_date ? long(h.to_date) : "now"}</span></span><span className="font-mono">{money(h.cost)}</span></li>))}</ul>
            )}
            <p className="mt-3 text-xs text-zinc-500">Cost goes to whoever held the vehicle on the day the job card was raised.</p>
          </Panel>

          <Panel title="Documents" action={perms.has("compliance.manage") ? <a className={`${btn} h-8`} href={to(`compliance/new?vehicle=${v.id}`)}>Add</a> : undefined}>
            {v.docs.length === 0 ? <p className="text-sm text-zinc-500">None recorded.</p> : (
              <ul className="divide-y divide-zinc-100 text-sm">{v.docs.map((d) => (
                <li key={d.entity_id} className="flex items-center justify-between gap-3 py-2.5"><span>{DOC_LABEL[d.doc_type] ?? d.doc_type}</span>
                  <Pill tone={d.doc_status === "expired" ? "bad" : d.doc_status === "ok" ? "ok" : "warn"}>{d.days_left < 0 ? "Expired" : `Valid to ${long(d.expires_on)}`}</Pill></li>))}</ul>
            )}
          </Panel>

          <Panel title="Photo and papers">
            {files.length > 0 && (
              <ul className="mb-3 grid grid-cols-2 gap-3 text-xs">
                {files.map((f) => (
                  <li key={f.id} className="space-y-1">
                    {f.url && f.mime_type?.startsWith("image/") && f.mime_type !== "image/heic"
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <a href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={f.kind === "photo" ? "Vehicle photo" : f.file_name} loading="lazy" className="h-24 w-full rounded-md border border-zinc-200 object-cover" /></a>
                      : <a href={f.url ?? undefined} target="_blank" rel="noreferrer" className="flex h-24 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 p-2 text-center text-sky-800">{f.mime_type === "application/pdf" ? "PDF" : "File"}</a>}
                    <p className="text-zinc-600">{f.kind === "photo" ? "Photo" : f.kind === "registration" ? "Registration book" : "File"}</p>
                    {canFiles && <VehicleFileRemove action={removeVehicleFileAction.bind(null, slug, f.id)} />}
                  </li>))}
              </ul>
            )}
            {canFiles ? (
              <div className="space-y-4">
                <VehicleFileUpload action={uploadVehicleFileAction.bind(null, slug, v.id, "photo")} label="Photo of the vehicle" accept="image/*" />
                <VehicleFileUpload action={uploadVehicleFileAction.bind(null, slug, v.id, "registration")} label="Registration book scan" accept="image/*,application/pdf" />
              </div>
            ) : files.length === 0 && <p className="text-sm text-zinc-500">None added.</p>}
          </Panel>
        </div>
      </div>
    </main>
  );
}
