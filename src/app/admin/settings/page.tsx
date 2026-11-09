import { Suspense } from "react";
import { requireOperator } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { loadPlatformSettings } from "@/lib/billing/settings";
import { groupedSettings } from "@/lib/billing/setting-groups";
import { PageHeader, Panel } from "@/components/ui";
import { saveSettingAction, checkStorageAction, askSettingsAssistantAction, applySettingChangesAction } from "../actions";
import { settingsAssistantOffered } from "@/lib/billing/settings-ai";
import { SettingsBoard } from "./board";
import { ToggleButton } from "../forms";

export default function SettingsPage() {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner /></Suspense>;
}

async function Inner() {
  await requireOperator();
  const values = await loadPlatformSettings(getDriver());
  const groups = groupedSettings().map((g) => ({
    id: g.id, title: g.title, sub: g.sub,
    defs: g.defs.map((d) => ({ key: d.key, label: d.label, hint: d.hint, multiline: !!d.multiline, oneOf: d.oneOf ?? null, numeric: !!d.numeric })),
  }));
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6 text-zinc-900">
      <PageHeader title="Settings" sub="Testing switches, limits, payments, invoices, contacts and legal details. Search, or open a section." />
      <SettingsBoard groups={groups} values={values} save={saveSettingAction} assist={settingsAssistantOffered() ? { ask: askSettingsAssistantAction, apply: applySettingChangesAction } : null} />
      <Panel title="File storage" sub="Saves, reads, links and deletes one tiny test file with the key this server really has, and says which step fails.">
        <ToggleButton action={checkStorageAction} label="Check file storage" />
      </Panel>
    </main>
  );
}
