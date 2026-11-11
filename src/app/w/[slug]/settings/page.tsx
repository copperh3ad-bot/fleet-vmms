import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { PageHeader, Panel, btn } from "@/components/ui";
import { getSettings, listServiceRules, rulesImpact } from "@/lib/control/service";
import { plural } from "@/lib/labels";
import { ServiceRuleForm } from "./forms";
import { RuleToggle, RulesFormProvider, SaveRulesButton, SettingFields, SwitchFields, type SettingItem } from "./rules-forms";

export default function ServiceRulesPage({ params, searchParams }: PageProps<"/w/[slug]/settings">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const CLASS_LABEL: Record<string, string> = { car: "cars", pickup: "pickups", van: "vans", truck: "trucks", bus: "buses", motorcycle: "motorcycles", forklift: "forklifts", other: "other vehicles" };
const appliesTo = (c: string[] | null) => {
  if (!c?.length) return "All vehicles";
  const names = c.map((x) => CLASS_LABEL[x] ?? x);
  const text = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return text[0].toUpperCase() + text.slice(1);
};

// The wording on the board for each number, and which panel it sits in.
const TIMING = [["pm_warning_days", "Warn this many days before due"], ["pm_warning_km", "Warn this many km before due"], ["pm_warning_hours", "Warn this many engine hours before due"], ["odometer_stale_days", "Odometer counts as stale after (days)"], ["odometer_max_km_per_day", "Reject readings above (km a day)"], ["odometer_due_day", "Odometer reading due on day of month"]] as const;
const FLAGS = [["flag_jobs_90d", "Many jobs: more than this many in 90 days"], ["flag_repeat_days", "Repeat repair: same reason within (days)"], ["flag_cost_multiple", "Cost: above this times the median for the same model"], ["doc_reminder_days", "Expiring documents warn (days)"]] as const;

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const m = await requireMembership(slug, { fullScope: true });
  const driver = getDriver();
  const [settings, rules, perms, impact] = await Promise.all([getSettings(driver, m), listServiceRules(driver, m), permissionsOf(driver, m), rulesImpact(driver, m)]);
  const manageRules = perms.has("service.manage");
  const adding = sp.add === "1";
  const edit = typeof sp.edit === "string" ? rules.find((r) => r.key === sp.edit) : undefined;
  const items = (list: readonly (readonly [string, string])[]): SettingItem[] =>
    list.flatMap(([key, label]) => { const s = settings.find((x) => x.key === key); return s ? [{ key, label, value: s.value, editable: s.editable }] : []; });
  // Company switches: the settings that decide what the company can do (QA-FULLFLOW F-03). Label and explanation come from the setting's own definition.
  const COMPANY = ["module_trips", "admin_decides_others", "allow_learner_licence", "odometer_whatsapp", "odometer_send_day", "dept_approval_limit", "payment_approval_limit", "invoice_over_quote_pct", "quote_over_estimate_pct"] as const;
  const cur = m.currency || "PKR";
  const company = (key: (typeof COMPANY)[number]): SettingItem[] => {
    const s = settings.find((x) => x.key === key);
    return s ? [{ key, label: key === "dept_approval_limit" || key === "payment_approval_limit" ? `${s.label} (${cur})` : (key === "invoice_over_quote_pct" || key === "quote_over_estimate_pct") ? `${s.label} (%)` : s.label, value: s.value || (key === "odometer_send_day" ? "1" : ""), editable: s.editable, hint: s.hint }] : [];
  };
  const canSave = settings.some((s) => s.editable && ([...TIMING, ...FLAGS].some(([k]) => k === s.key) || (COMPANY as readonly string[]).includes(s.key)));
  const to = (q: string) => `/w/${slug}/settings${q}`;

  return (
    <RulesFormProvider slug={slug}>
      <main className="space-y-5 p-6 text-zinc-900">
        <PageHeader title="Service rules" sub="What counts as due, and what gets flagged" actions={canSave ? <SaveRulesButton /> : undefined} />
        <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
          <div className="space-y-5">
            <Panel title="Preventive servicing" sub="Switches save at once. Numbers below save with “Save rules”." flush>
              <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Service</th><th>Every</th><th>Or every</th><th>Or hours</th><th>On</th><th>Applies to</th>{manageRules && <th />}</tr></thead>
                <tbody>{rules.map((r) => (
                  <tr key={r.key} className={`border-t border-zinc-100 ${r.active ? "" : "text-zinc-500"}`}>
                    <td className="px-5 py-3">{r.label}{!r.is_preventive && <span className="block text-xs text-zinc-500">Not shown as due</span>}</td>
                    <td className="py-3">{r.interval_months ? `${r.interval_months} months` : "—"}</td>
                    <td className="py-3 font-mono">{r.interval_km ? `${Number(r.interval_km).toLocaleString("en-US")} km` : "—"}</td>
                    <td className="py-3 font-mono">{r.interval_hours ? `${Number(r.interval_hours).toLocaleString("en-US")} h` : "—"}</td>
                    <td className="py-3"><RuleToggle slug={slug} ruleKey={r.key} active={r.active} disabled={!manageRules} label={r.label} /></td>
                    <td className="py-3">{r.active ? appliesTo(r.applies_to_classes) : "Not used yet"}</td>
                    {manageRules && <td className="py-3 pr-5 text-right"><a className="text-sky-800 underline" href={to(`?edit=${r.key}`)}>Change</a></td>}
                  </tr>))}</tbody>
              </table></div>
              {manageRules && <div className="border-t border-zinc-100 p-4"><a href={to("?add=1")} className={btn}>Add a service</a></div>}
            </Panel>

            {manageRules && (adding || edit) && (
              <Panel title={edit ? `Change “${edit.label}”` : "Add a service"}>
                <ServiceRuleForm key={edit?.key ?? "new"} slug={slug} rule={edit} />
              </Panel>
            )}

            <Panel title="Flags on repeat trouble">
              <SettingFields items={items(FLAGS)} />
            </Panel>
          </div>

          <div className="space-y-5">
            <Panel title="Timing"><SettingFields items={items(TIMING)} /></Panel>
            <Panel title="Company switches" sub="What your company can do, and who may approve what">
              <div className="space-y-4">
                <SwitchFields items={[...company("module_trips"), ...company("admin_decides_others"), ...company("allow_learner_licence"), ...company("odometer_whatsapp")]} />
                <SettingFields items={[...company("odometer_send_day"), ...company("dept_approval_limit"), ...company("payment_approval_limit"), ...company("invoice_over_quote_pct"), ...company("quote_over_estimate_pct")]} />
              </div>
            </Panel>
            <Panel title="What the manager sees">
              {impact ? (
                <p className="text-sm text-zinc-600">With these rules, {plural(impact.due, "vehicle")} {impact.due === 1 ? "is" : "are"} due or overdue for {impact.label.toLowerCase()} and {impact.noHistory} {impact.noHistory === 1 ? "has" : "have"} no service history. Change a rule and the lists update at once.</p>
              ) : <p className="text-sm text-zinc-500">No routine service is switched on, so nothing shows as due.</p>}
            </Panel>
          </div>
        </div>
      </main>
    </RulesFormProvider>
  );
}
