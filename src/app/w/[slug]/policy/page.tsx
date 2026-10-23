import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { listPolicies } from "@/lib/master/policy";
import { getPolicyImpact } from "@/lib/master/policy-rules";
import { getSettings } from "@/lib/control/service";
import { SettingsForm } from "../settings/forms";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { PolicyRemove, PolicyUpload } from "./forms";
import { PolicyReader } from "./reader";
import { getReading } from "@/lib/master/policy-reading";

export default function PolicyPage({ params }: PageProps<"/w/[slug]/policy">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [perms, versions, settings, impact] = await Promise.all([
    permissionsOf(driver, m), supabaseBlobStore().then((s) => listPolicies(driver, s, m)), getSettings(driver, m), getPolicyImpact(driver, m)]);
  const rules = settings.filter((s) => s.group === "policy");
  const manage = perms.has("policy.manage");
  const [current, ...earlier] = versions;
  const reading = manage && current?.file ? await getReading(driver, m, current.id) : null;

  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Maintenance policy" sub="Your company's own rules for keeping vehicles on the road" />
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Panel title="Current policy">
            {current ? (
              <div className="space-y-2 text-sm">
                <p className="text-base font-medium">{current.title} <Pill tone="ok">Current</Pill></p>
                <p className="text-zinc-600">{current.effective_from ? `Effective from ${day(current.effective_from)} · ` : ""}Uploaded {day(current.created_at)}</p>
                {current.notes && <p className="text-zinc-700">{current.notes}</p>}
                <p className="flex flex-wrap items-center gap-4">
                  {current.file?.url ? <a href={current.file.url} target="_blank" rel="noreferrer" className="font-medium text-sky-800 underline">Open {current.file.file_name}</a> : <span className="text-zinc-500">File not available.</span>}
                  {manage && <PolicyRemove slug={slug} id={current.id} />}
                </p>
              </div>
            ) : <p className="text-sm text-zinc-500">{manage ? "No policy uploaded yet. Add your company's policy on the right." : "Your company has not uploaded a maintenance policy yet."}</p>}
          </Panel>

          {manage && current?.file && (
            <Panel title="Read this policy" sub="The system reads the file and offers the rules it finds. You decide what to apply.">
              <PolicyReader slug={slug} policyId={current.id} reading={reading} />
            </Panel>
          )}

          <Panel title="Rules the system applies" sub="Each rule is off at 0. Set the numbers your own policy uses.">
            <SettingsForm slug={slug} group="policy" items={rules.map((r) => ({ key: r.key, label: r.label, hint: r.hint, unit: r.unit, value: r.value, editable: r.editable }))} />
            <p className="mt-3 text-xs text-zinc-500">Service intervals, such as an oil change every 3 months or 5,000 km, are set under Service rules.</p>
          </Panel>

          <Panel title="What the rules mean right now">
            <ul className="space-y-2 text-sm">
              <li>{impact.replaceYears > 0
                ? (impact.replaceDue.length ? <>Replacement after {impact.replaceYears} years: {impact.replaceDue.length} vehicle{impact.replaceDue.length === 1 ? "" : "s"} due ({impact.replaceDue.map((v, i) => <span key={v.vehicle_id}>{i > 0 && ", "}<a className="text-sky-800 underline" href={`/w/${slug}/vehicles/${v.vehicle_id}`}>{v.registration_no}</a></span>)}).</> : `Replacement after ${impact.replaceYears} years: no vehicle is due.`)
                : "Replacement age: not set."}</li>
              <li>{impact.freeAccidents > 0 ? `Accidents: the company covers a driver's first ${impact.freeAccidents}. ${impact.driverPaysLast12Months} in the last 12 months fall on the driver.` : "Accident cover: not set."}</li>
              <li>{impact.sharePct > 0 ? `Repairs: the driver bears ${impact.sharePct}% of repairs. Routine service, wear items such as brake pads and tyres, and accident repairs are not counted.` : "Driver's share of repairs: not set."}</li>
            </ul>
            {impact.shares && impact.shares.length > 0 && (
              <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="py-2">Driver</th><th>Repairs, 12 months</th><th>Cost</th><th>Driver&apos;s share</th></tr></thead>
                <tbody>{impact.shares.map((r) => (<tr key={r.driver} className="border-t border-zinc-100"><td className="py-2">{r.driver}</td><td>{r.jobs}</td><td className="font-mono">{r.cost.toLocaleString("en-US")}</td><td className="font-mono">{r.share.toLocaleString("en-US")}</td></tr>))}</tbody>
              </table></div>
            )}
          </Panel>

          {earlier.length > 0 && (
            <Panel title="Earlier versions" flush>
              <ul className="divide-y divide-zinc-100 text-sm">
                {earlier.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <span>{p.title}<span className="block text-xs text-zinc-500">{p.effective_from ? `Effective ${day(p.effective_from)} · ` : ""}Uploaded {day(p.created_at)}</span></span>
                    <span className="flex items-center gap-4">
                      {p.file?.url && <a href={p.file.url} target="_blank" rel="noreferrer" className="text-sky-800 underline">Open</a>}
                      {manage && <PolicyRemove slug={slug} id={p.id} />}
                    </span>
                  </li>))}
              </ul>
            </Panel>
          )}
        </div>

        {manage && (
          <Panel title={current ? "Upload a new version" : "Upload your policy"} sub="The newest upload becomes the current policy. Earlier ones are kept.">
            <PolicyUpload slug={slug} />
          </Panel>
        )}
      </div>
    </main>
  );
}
