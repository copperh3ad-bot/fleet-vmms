import { Suspense } from "react";
import { requireOperator } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { loadPlatformSettings, PLATFORM_SETTINGS } from "@/lib/billing/settings";
import { PageHeader, Panel } from "@/components/ui";
import { saveSettingAction } from "../actions";
import { SettingForm } from "./form";

export default function SettingsPage() {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner /></Suspense>;
}

async function Inner() {
  await requireOperator();
  const values = await loadPlatformSettings(getDriver());
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6 text-zinc-900">
      <PageHeader title="Settings" sub="What customers see when they pay, and on their invoices" />
      {PLATFORM_SETTINGS.map((d) => (
        <Panel key={d.key} title={d.label} sub={d.hint}>
          <SettingForm action={saveSettingAction.bind(null, d.key)} name={d.key} value={values[d.key] ?? ""} multiline={!!d.multiline} />
        </Panel>
      ))}
    </main>
  );
}
