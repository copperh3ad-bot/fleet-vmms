"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { saveServiceRule, saveSettings } from "@/lib/control/service";
import { SETTINGS } from "@/lib/control/settings";
import { runAction, str, typed, type FormState } from "../actions-util";

/** Only the keys of this group that the form actually sent (disabled boxes are not sent) are saved. */
export async function saveSettingsAction(slug: string, group: string, _prev: FormState, form: FormData): Promise<FormState> {
  const keys = SETTINGS.filter((s) => s.group === group).map((s) => s.key).filter((k) => form.has(k));
  const state = await runAction(slug, async (m) => {
    const n = await saveSettings(getDriver(), m, Object.fromEntries(keys.map((k) => [k, str(form, k)])));
    return n === 0 ? "Nothing changed." : "Saved.";
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}

export async function saveServiceRuleAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await saveServiceRule(getDriver(), m, {
      key: str(form, "key"), label: str(form, "label"), interval_months: str(form, "interval_months"), interval_km: str(form, "interval_km"),
      is_preventive: form.get("is_preventive") === "on", active: form.get("active") === "on", applies_to_classes: form.getAll("applies_to_classes").map(String),
    });
    return str(form, "key") ? "Rule saved." : "Rule added.";
  });
  if (state.ok) { refresh(); redirect(`/w/${slug}/settings`); }
  return { ...state, values: typed(form) };
}
