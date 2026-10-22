import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { Card } from "@/components/form";
import { getSettings, listServiceRules } from "@/lib/control/service";
import { ServiceRuleForm, SettingsForm } from "./forms";

export default function SettingsPage({ params, searchParams }: PageProps<"/w/[slug]/settings">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [settings, rules, perms] = await Promise.all([getSettings(driver, m), listServiceRules(driver, m), permissionsOf(driver, m)]);
  const manageRules = perms.has("service.manage");
  const edit = typeof sp.edit === "string" ? rules.find((r) => r.key === sp.edit) : undefined;
  const group = (g: string) => settings.filter((s) => s.group === g);
  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 p-4 text-zinc-900">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Card title="Service rules">
        <p className="mb-3 text-sm text-zinc-600">What counts as routine service and how often it is due. A rule can apply to some vehicle types only.</p>
        <div className="mb-4 overflow-x-auto rounded-md border border-zinc-200">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500"><tr><th className="p-2">Rule</th><th className="p-2">Every</th><th className="p-2">Applies to</th><th className="p-2">Status</th>{manageRules && <th className="p-2" />}</tr></thead>
            <tbody>{rules.map((r) => (
              <tr key={r.key} className={`border-b border-zinc-100 last:border-0 ${r.active ? "" : "text-zinc-500"}`}>
                <td className="p-2 font-medium">{r.label}</td>
                <td className="p-2">{[r.interval_months ? `${r.interval_months} months` : null, r.interval_km ? `${Number(r.interval_km).toLocaleString("en-US")} km` : null].filter(Boolean).join(" or ")}</td>
                <td className="p-2 capitalize">{r.applies_to_classes?.length ? r.applies_to_classes.join(", ") : "every vehicle"}</td>
                <td className="p-2">{r.active ? (r.is_preventive ? "In use" : "In use, not shown as due") : "Not in use"}</td>
                {manageRules && <td className="p-2"><a className="text-sky-800 underline" href={`/w/${slug}/settings?edit=${r.key}`}>Change</a></td>}
              </tr>))}</tbody>
          </table>
        </div>
        {manageRules ? <><h3 className="mb-2 text-sm font-semibold">{edit ? `Change “${edit.label}”` : "Add a rule"}</h3><ServiceRuleForm key={edit?.key ?? "new"} slug={slug} rule={edit} /></> : <p className="text-sm text-zinc-500">You can see the rules but not change them.</p>}
        <div className="mt-5 border-t border-zinc-100 pt-4"><h3 className="mb-2 text-sm font-semibold">When a service shows as due soon</h3><SettingsForm slug={slug} group="service" items={group("service")} /></div>
      </Card>

      <Card title="Alerts and flags"><SettingsForm slug={slug} group="alerts" items={group("alerts")} /></Card>
      <Card title="Reminders and odometer"><SettingsForm slug={slug} group="general" items={group("general")} /></Card>
    </main>
  );
}
