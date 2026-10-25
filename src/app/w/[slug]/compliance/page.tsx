import { Suspense } from "react";
import { ExportLink } from "@/components/export-link";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { listDocuments, listMissingDocuments } from "@/lib/compliance/service";
import { DOC_LABEL } from "@/lib/compliance/schemas";
import { getSettings } from "@/lib/control/service";
import { listVehicles } from "@/lib/master/service";
import { Kpi, PageHeader, Panel, Pill, Plate, btnPrimary, type Tone } from "@/components/ui";
import { DocumentForm } from "./new/form";
import { Tabs } from "./tabs";

export default function CompliancePage({ params, searchParams }: PageProps<"/w/[slug]/compliance">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const TONE: Record<string, Tone> = { expired: "bad", due_30: "warn", due_90: "info", ok: "ok" };
const dmy = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const left = (d: number) => (d < 0 ? `Expired ${-d} days` : d === 0 ? "Expires today" : `${d} days`);
const CHIP_TYPES = ["insurance", "registration", "fitness", "token_tax", "route_permit"] as const;

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 80) : "");
  const [q, status, type] = [one("q"), one("status"), one("type")];
  const m = await requireMembership(slug, { fullScope: true });
  const driver = getDriver();
  const perms = await permissionsOf(driver, m);
  const manage = perms.has("compliance.manage");
  const [all, missing, settings, vehicles] = await Promise.all([
    listDocuments(driver, m, { search: q || undefined }),
    listMissingDocuments(driver, m, ["registration", "fitness", "token_tax", "insurance"]),
    getSettings(driver, m).catch(() => []),
    manage ? listVehicles(driver, m) : Promise.resolve([]),
  ]);
  const needs = (r: { doc_status: string }) => r.doc_status === "expired" || r.doc_status === "due_30";
  const rows = all.filter((r) => (type ? r.doc_type === type : true) && (status === "action" ? needs(r) : status ? r.doc_status === status : true));
  const n = (s: string) => all.filter((r) => r.doc_status === s).length;
  const days = (settings.find((s) => s.key === "doc_reminder_days")?.value || "60,30,14").split(",").map((x) => x.trim()).filter(Boolean);
  const href = (o: Record<string, string>) => { const u = new URLSearchParams({ ...(q ? { q } : {}), ...o }); const t = u.toString(); return `/w/${slug}/compliance${t ? `?${t}` : ""}`; };
  const chip = (active: boolean) => `rounded-full border px-4 py-1.5 text-sm ${active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50"}`;
  const typeCount = (t: string) => all.filter((r) => r.doc_type === t).length;

  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Insurance and compliance documents" sub="Everything with an expiry date, soonest first"
        actions={<>{<ExportLink slug={slug} kind="documents" query={{ q, status, type }} />}{manage && <a href={`/w/${slug}/compliance/new`} className={btnPrimary}>Add a document</a>}</>} />
      <Tabs slug={slug} active="compliance" />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Expired" value={n("expired")} tone={n("expired") ? "bad" : undefined} href={href({ status: "expired" })} />
        <Kpi label="Due in 30 days" value={n("due_30")} tone={n("due_30") ? "warn" : undefined} href={href({ status: "due_30" })} />
        <Kpi label="Due in 90 days" value={n("due_90")} href={href({ status: "due_90" })} />
        <Kpi label="All documents" value={all.length} href={href({})} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <a href={href({ status: "action" })} className={chip(status === "action" && !type)}>Needs action <span className="ml-1 font-mono">{all.filter(needs).length}</span></a>
        {CHIP_TYPES.map((t) => <a key={t} href={href({ type: t })} className={chip(type === t)}>{DOC_LABEL[t].replace(" certificate", "")} <span className="ml-1 font-mono">{typeCount(t)}</span></a>)}
        <form role="search" className="ml-auto"><input name="q" defaultValue={q} placeholder="Search plate or reference" className="h-10 w-64 rounded-md border border-zinc-300 bg-white px-3 text-sm" aria-label="Search documents" />{status && <input type="hidden" name="status" value={status} />}{type && <input type="hidden" name="type" value={type} />}</form>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <Panel title="Documents" sub={`${rows.length} shown`} flush>
            {rows.length === 0 ? <p className="p-5 text-sm text-zinc-500">{q || status || type ? "No document matches." : "No documents yet."}</p> : (
              <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Vehicle</th><th>Document</th><th>Expires</th><th>Time left</th><th className="px-5">Issued by</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.entity_id} className={`border-t border-zinc-100 ${r.doc_status === "expired" || (r.doc_status === "due_30" && r.days_left <= 14) ? "bg-red-50/60" : ""}`}>
                    <td className="px-5 py-3"><a href={`/w/${slug}/vehicles/${r.vehicle_id}`}><Plate>{r.registration_no}</Plate></a>{(r.make || r.model) && <span className="mt-1 block text-xs text-zinc-500">{[r.make, r.model].filter(Boolean).join(" ")}</span>}</td>
                    <td className="py-3"><a className="hover:underline" href={`/w/${slug}/compliance/${r.entity_type}/${r.entity_id}`}>{DOC_LABEL[r.doc_type] ?? r.doc_type}</a>{r.reference && <span className="block text-xs text-zinc-500">{r.reference}</span>}</td>
                    <td className="py-3">{dmy(r.expires_on)}</td>
                    <td className="py-3"><Pill tone={TONE[r.doc_status]}>{left(r.days_left)}</Pill></td>
                    <td className="px-5 py-3">{r.issued_by ?? "—"}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </Panel>
          {missing.length > 0 && !q && !status && !type && (
            <Panel title="No document on file" sub={`${missing.length} missing`}>
              <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                {missing.slice(0, 200).map((x) => (
                  <li key={`${x.vehicle_id}-${x.doc_type}`}>{x.registration_no} · {DOC_LABEL[x.doc_type]}{manage && <> · <a className="text-sky-800 underline" href={`/w/${slug}/compliance/new?vehicle=${x.vehicle_id}&type=${x.doc_type}`}>add</a></>}</li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="space-y-5">
          {manage && (
            <Panel title="Add or renew a document">
              <DocumentForm bare slug={slug} initial={{}} vehicles={vehicles.filter((v) => v.status !== "disposed").map((v) => [v.id, v.registration_no])} types={Object.entries(DOC_LABEL)} />
            </Panel>
          )}
          <Panel title="Reminders" sub="Fleet manager gets a message at these points before expiry.">
            <div className="flex flex-wrap gap-2">
              {days.map((d, i) => <Pill key={d} tone={i === 0 ? "info" : i === 1 ? "info" : "warn"}>{d} days</Pill>)}
              <Pill tone="bad">On expiry</Pill>
            </div>
            <p className="mt-3 text-xs text-zinc-500">Change the days in Settings.</p>
          </Panel>
        </div>
      </div>
    </main>
  );
}
