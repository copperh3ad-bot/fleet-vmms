import { Suspense } from "react";
import { ExportLink } from "@/components/export-link";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { getBoard, type BoardRow, type ServiceFilter } from "@/lib/master/board";
import { planUsage } from "@/lib/admin/service";
import { PageHeader, Pill, Plate, btn, btnPrimary, money, type Tone } from "@/components/ui";
import { DOC_LABEL } from "@/lib/compliance/schemas";
import { dayMonth, plural } from "@/lib/labels";

export default function VehiclesPage({ params, searchParams }: PageProps<"/w/[slug]/vehicles">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Vehicles params={params} searchParams={searchParams} /></Suspense>;
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

function service(r: BoardRow): { tone: Tone; text: string; sub: string } {
  const last = r.last_done_on ? `last ${dayMonth(r.last_done_on)}` : "";
  const due = r.due_on ? `due ${dayMonth(r.due_on)}` : "";
  const sub = [last, due].filter(Boolean).join(" · ");
  switch (r.service) {
    case "overdue": return { tone: "bad", text: r.days_remaining !== null ? `${-r.days_remaining} days overdue` : "Overdue", sub };
    case "due_soon": return { tone: "warn", text: r.days_remaining !== null ? `Due in ${plural(r.days_remaining, "day")}` : "Due soon", sub };
    case "scheduled": return { tone: "info", text: "Job in progress", sub: r.open_job_no ?? "" };
    case "no_history": return { tone: "neutral", text: "No history", sub: "Enter the last service date" };
    default: return { tone: "ok", text: "On track", sub };
  }
}

async function Vehicles({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 80), filter = one(sp.filter), page = Number(one(sp.page)) || 1;
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [b, perms, plan] = await Promise.all([getBoard(driver, m, { q: q || undefined, filter, page }), permissionsOf(driver, m), planUsage(driver, m)]);
  const canWrite = perms.has("vehicle.write");
  const active = (["all", "overdue", "due_soon", "scheduled", "no_history", "ok"] as ServiceFilter[]).includes(filter as ServiceFilter) ? (filter as ServiceFilter) : "all";
  const href = (over: Record<string, string>) => {
    const p = new URLSearchParams({ ...(q ? { q } : {}), ...(active !== "all" ? { filter: active } : {}), ...over });
    for (const [k, v] of [...p]) if (!v) p.delete(k);
    return `/w/${slug}/vehicles${p.size ? `?${p}` : ""}`;
  };
  const pills: [ServiceFilter, string][] = [
    ["all", "All"], ["overdue", "Overdue"], ["due_soon", `Due within ${b.warnDays} days`], ["scheduled", "Scheduled"], ["no_history", "No history"], ["ok", "On track"],
  ];
  const sub = [`${plural(b.counts.all, "active vehicle")}`, b.ruleText,
    plan.vehicles.limit !== null ? `${plan.vehicles.used} of ${plan.vehicles.limit} allowed by your plan` : null].filter(Boolean).join(" · ");

  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Vehicles" sub={sub} actions={<>
        <ExportLink slug={slug} kind="vehicles" query={{ q, status: "" }} />
        {canWrite && <a href={`/w/${slug}/vehicles/import`} className={btn}>Import from CSV</a>}
        {canWrite && <a href={`/w/${slug}/vehicles/new`} className={btnPrimary}>Add vehicle</a>}
      </>} />

      <div className="flex flex-wrap items-center gap-2">
        {pills.map(([k, label]) => (
          <a key={k} href={href({ filter: k === "all" ? "" : k, page: "" })} aria-current={k === active ? "true" : undefined}
            className={`inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm ${k === active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white hover:bg-zinc-50"}`}>
            {label} <span className="font-mono">{b.counts[k]}</span>
          </a>
        ))}
        <form className="ml-auto" role="search">
          {active !== "all" && <input type="hidden" name="filter" value={active} />}
          <input name="q" defaultValue={q} placeholder="Plate, model or driver" aria-label="Search vehicles" className="h-10 w-64 rounded-md border border-zinc-300 bg-white px-3 text-sm" />
        </form>
      </div>

      {b.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-600">
          {q || active !== "all" ? "No vehicle matches." : "No vehicles yet."} {canWrite && !q && active === "all" && <>Start with <a className="text-brand underline" href={`/w/${slug}/vehicles/new`}>Add vehicle</a> or <a className="text-brand underline" href={`/w/${slug}/vehicles/import`}>import a CSV</a>.</>}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b border-zinc-200 text-[11px] uppercase tracking-wide text-zinc-500">
                <tr><th className="px-5 py-3">Vehicle</th><th>Driver</th><th className="text-right">Odometer</th><th className="pl-6">Service</th><th>Spend vs budget</th><th className="text-right">Jobs, 90 d</th><th className="px-5">Flags</th></tr>
              </thead>
              <tbody>
                {b.rows.map((r) => {
                  const s = service(r);
                  const over = (r.pct ?? 0) >= 100;
                  return (
                    <tr key={r.id} className="border-b border-zinc-100 align-top last:border-0">
                      <td className="px-5 py-4"><a href={`/w/${slug}/vehicles/${r.id}`}><Plate>{r.registration_no}</Plate></a><span className="mt-1 block text-xs text-zinc-500">{[r.make, r.model, r.year].filter(Boolean).join(" ")}</span></td>
                      <td className="py-4 pr-3">{r.holder ?? <span className="text-zinc-400">Unassigned</span>}{r.department && <span className="block text-xs text-zinc-500">{r.department}</span>}</td>
                      <td className="py-4 pr-3 text-right"><span className="font-mono">{money(r.odometer_km)} km</span>
                        <span className="mt-1 block text-xs text-zinc-500">{r.odometer_age_days === null ? "no reading yet" : r.odometer_stale ? <Pill tone="warn">Stale · {r.odometer_age_days} days</Pill> : `updated ${plural(r.odometer_age_days, "day")} ago`}</span></td>
                      <td className="py-4 pl-6 pr-3"><Pill tone={s.tone}>{s.text}</Pill>{s.sub && <span className="mt-1 block text-xs text-zinc-500">{s.sub}</span>}</td>
                      <td className="py-4 pr-3 min-w-[190px]">
                        {r.budget !== null ? (
                          <>
                            <div className="h-2 rounded bg-zinc-100"><div className={`h-2 rounded ${over ? "bg-red-600" : "bg-brand"}`} style={{ width: `${Math.min(100, r.pct ?? 0)}%` }} /></div>
                            <span className="mt-1 block font-mono text-xs text-zinc-500">{money(r.spent)} of {money(r.budget)} · {Math.round(r.pct ?? 0)}%</span>
                          </>
                        ) : <span className="font-mono text-xs text-zinc-500">{money(r.spent)} · no budget</span>}
                      </td>
                      <td className="py-4 pr-3 text-right font-mono">{r.jobs_90d}</td>
                      <td className="px-5 py-4"><div className="flex flex-wrap gap-1.5">
                        {r.flags.length === 0 && r.docs.length === 0 && <span className="text-zinc-400">None</span>}
                        {r.flags.map((f) => <Pill key={f.text} tone={f.tone}>{f.text}</Pill>)}
                        {r.docs.map((d) => <Pill key={d.type} tone={d.days_left < 0 ? "bad" : "warn"}>{DOC_LABEL[d.type] ?? d.type} {d.days_left < 0 ? "expired" : `expires ${dayMonth(d.expires_on)}`}</Pill>)}
                      </div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <footer className="flex flex-wrap items-center gap-3 border-t border-zinc-100 px-5 py-3 text-sm text-zinc-500">
            <span>Showing {b.rows.length} of {b.total}</span>
            <span className="ml-auto flex gap-2">
              {b.page > 1 ? <a className={btn} href={href({ page: String(b.page - 1) })}>Previous</a> : <span className={`${btn} opacity-50`} aria-disabled="true">Previous</span>}
              {b.page < b.pages ? <a className={btn} href={href({ page: String(b.page + 1) })}>Next</a> : <span className={`${btn} opacity-50`} aria-disabled="true">Next</span>}
            </span>
          </footer>
        </div>
      )}
    </main>
  );
}
