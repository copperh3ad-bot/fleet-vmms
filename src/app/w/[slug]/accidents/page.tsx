import { Suspense } from "react";
import { ExportLink } from "@/components/export-link";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { listAccidents, listChallans } from "@/lib/compliance/service";
import { listEmployeeOptions, listVehicles } from "@/lib/master/service";
import { PageHeader, Panel, Pill, Plate, btn, btnPrimary, money, type Tone } from "@/components/ui";
import { ChallanForm, StatusButtons } from "../challans/form";
import { SEVERITY } from "../compliance/tabs";
import { AccidentPanelForm } from "./forms";

export default function AccidentsPage({ params, searchParams }: PageProps<"/w/[slug]/accidents">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const dmy = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const CHALLAN: Record<string, { label: string; tone: Tone }> = { open: { label: "Unpaid", tone: "warn" }, paid: { label: "Paid", tone: "ok" }, disputed: { label: "Disputed", tone: "info" } };

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const m = await requireMembership(slug);
  const driver = getDriver();
  const perms = await permissionsOf(driver, m);
  const manage = perms.has("compliance.manage");
  const [accidents, challans, vehicles, people] = await Promise.all([
    listAccidents(driver, m), listChallans(driver, m),
    manage ? listVehicles(driver, m) : Promise.resolve([]), manage ? listEmployeeOptions(driver, m) : Promise.resolve([]),
  ]);
  const form = one("form") === "challan" ? "challan" : "accident";
  const recent = accidents.filter((a) => a.last_12_months);
  const thisYear = accidents.filter((a) => a.this_year).length;
  const unpaid = challans.filter((c) => c.status === "open").reduce((s, c) => s + Number(c.amount), 0);
  const opts: [string, string][] = vehicles.filter((v) => v.status !== "disposed").map((v) => [v.id, v.registration_no]);
  const initial: Record<string, string> = {};
  if (one("vehicle")) initial.vehicle_id = one("vehicle");
  if (one("job_card")) initial.job_card_id = one("job_card");
  const outcome = (a: (typeof accidents)[number]): { label: string; tone: Tone } =>
    a.insurance_claim ? { label: "Insured claim", tone: "info" } : a.fault === "our_driver" ? { label: "Driver fault", tone: "bad" } : { label: "Not insured", tone: "neutral" };

  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Accidents and challans" sub="Linked to the driver who had the vehicle on that day"
        actions={<><ExportLink slug={slug} kind="accidents" query={{}} />{manage && <><a href={`/w/${slug}/accidents?form=challan`} className={btn}>Log a challan</a><a href={`/w/${slug}/accidents`} className={btnPrimary}>Log an accident</a></>}</>} />

      <div className={`grid gap-5 ${manage ? "xl:grid-cols-[1.6fr_1fr]" : ""}`}>
        <div className="space-y-5">
          <Panel title="Accidents, last 12 months" sub={`${thisYear} this year`} flush>
            {recent.length === 0 ? <p className="p-5 text-sm text-zinc-500">No accidents recorded in the last 12 months.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Date</th><th>Vehicle</th><th>Driver</th><th>What happened</th><th>Severity</th><th className="px-5">Outcome</th></tr></thead>
                <tbody>{recent.map((a) => (
                  <tr key={a.id} className="border-t border-zinc-100 align-top">
                    <td className="px-5 py-3"><a className="hover:underline" href={`/w/${slug}/accidents/${a.id}`}>{dmy(a.occurred_at)}</a></td>
                    <td className="py-3"><a href={`/w/${slug}/vehicles/${a.vehicle_id}`}><Plate>{a.registration_no}</Plate></a></td>
                    <td className="py-3">{a.driver_name ?? "—"}</td>
                    <td className="max-w-xs py-3">{a.description.length > 90 ? `${a.description.slice(0, 90)}…` : a.description}{a.job_no && <a className="ml-2 text-xs text-sky-800 underline" href={`/w/${slug}/job-cards/${a.job_card_id}`}>{a.job_no}</a>}</td>
                    <td className="py-3">{SEVERITY[a.severity] ?? a.severity}</td>
                    <td className="px-5 py-3"><Pill tone={outcome(a).tone}>{outcome(a).label}</Pill></td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </Panel>

          <Panel title="Challans" sub={unpaid > 0 ? `PKR ${money(unpaid)} unpaid` : "Nothing unpaid"} flush action={<ExportLink slug={slug} kind="challans" query={{}} />}>
            {challans.length === 0 ? <p className="p-5 text-sm text-zinc-500">No challans.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Date</th><th>Vehicle</th><th>Driver</th><th>Offence</th><th className="text-right">Amount (PKR)</th><th className="px-5">Status</th>{manage && <th />}</tr></thead>
                <tbody>{challans.map((c) => (
                  <tr key={c.id} className="border-t border-zinc-100 align-top">
                    <td className="px-5 py-3">{dmy(c.issued_on)}{c.reference && <span className="block text-xs text-zinc-500">{c.reference}</span>}</td>
                    <td className="py-3"><a href={`/w/${slug}/vehicles/${c.vehicle_id}`}><Plate>{c.registration_no}</Plate></a></td>
                    <td className="py-3">{c.driver_name ?? "—"}</td><td className="py-3">{c.violation ?? "—"}</td>
                    <td className="py-3 text-right font-mono">{money(c.amount)}</td>
                    <td className="px-5 py-3"><Pill tone={CHALLAN[c.status].tone}>{CHALLAN[c.status].label}</Pill>{c.paid_on && <span className="ml-2 text-xs text-zinc-500">{dmy(c.paid_on)}</span>}</td>
                    {manage && <td className="py-3 pr-5"><StatusButtons slug={slug} id={c.id} status={c.status} /></td>}
                  </tr>))}</tbody>
              </table></div>
            )}
          </Panel>
        </div>

        {manage && (
          <div>
            {form === "challan"
              ? <Panel title="Log a challan"><ChallanForm stack slug={slug} vehicles={opts} people={people.map((p) => [p.id, p.full_name])} /></Panel>
              : <Panel title="Log an accident"><AccidentPanelForm slug={slug} vehicles={opts} initial={initial} canRaiseJob={perms.has("jobcard.create")} /></Panel>}
          </div>
        )}
      </div>
    </main>
  );
}
