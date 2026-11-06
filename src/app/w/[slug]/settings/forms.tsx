"use client";
import { useActionState } from "react";
import { Field, Notice, Submit, inputCls } from "@/components/form";
import { VEHICLE_CLASSES } from "@/lib/master/schemas";
import type { FormState } from "../actions-util";
import { saveServiceRuleAction, saveSettingsAction } from "./actions";

type Item = { key: string; label: string; hint: string; unit?: string; value: string; editable: boolean };

export function SettingsForm({ slug, group, items }: { slug: string; group: string; items: Item[] }) {
  const [state, action] = useActionState<FormState, FormData>(saveSettingsAction.bind(null, slug, group), {});
  const anyEditable = items.some((i) => i.editable);
  return (
    <form action={action} className="space-y-3" noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((i) => (
          <Field key={i.key} label={`${i.label}${i.unit ? ` (${i.unit})` : ""}`} name={i.key} state={state} hint={i.hint}>
            <input id={i.key} name={i.key} defaultValue={state.values?.[i.key] ?? i.value} disabled={!i.editable} className={inputCls} inputMode="decimal" aria-invalid={!!state.fields?.[i.key]} />
          </Field>
        ))}
      </div>
      {anyEditable ? <div className="flex flex-wrap items-center gap-3"><Submit>Save</Submit><Notice state={state} /></div>
        : <p className="text-sm text-zinc-500">You can see these but not change them.</p>}
    </form>
  );
}

type Rule = { key: string; label: string; is_preventive: boolean; interval_months: number | null; interval_km: string | null; interval_hours: string | null; active: boolean; applies_to_classes: string[] | null };

export function ServiceRuleForm({ slug, rule }: { slug: string; rule?: Rule }) {
  const [state, action] = useActionState<FormState, FormData>(saveServiceRuleAction.bind(null, slug), {});
  const v = state.values;
  const classes = rule?.applies_to_classes ?? [];
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="key" value={rule?.key ?? ""} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Name" name="label" state={state} required>
          <input id="label" name="label" defaultValue={v?.label ?? rule?.label ?? ""} className={inputCls} aria-invalid={!!state.fields?.label} />
        </Field>
        <Field label="Every (months)" name="interval_months" state={state} hint="Leave empty for no time rule.">
          <input id="interval_months" name="interval_months" defaultValue={v?.interval_months ?? rule?.interval_months ?? ""} inputMode="numeric" className={inputCls} aria-invalid={!!state.fields?.interval_months} />
        </Field>
        <Field label="Every (km)" name="interval_km" state={state} hint="Leave empty for no distance rule.">
          <input id="interval_km" name="interval_km" defaultValue={v?.interval_km ?? (rule?.interval_km ? String(Number(rule.interval_km)) : "")} inputMode="decimal" className={inputCls} aria-invalid={!!state.fields?.interval_km} />
        </Field>
        <Field label="Every (engine hours)" name="interval_hours" state={state} hint="For vehicles with an hour meter. Empty for no hours rule.">
          <input id="interval_hours" name="interval_hours" defaultValue={v?.interval_hours ?? (rule?.interval_hours ? String(Number(rule.interval_hours)) : "")} inputMode="decimal" className={inputCls} aria-invalid={!!state.fields?.interval_hours} />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-zinc-600">Applies to (none ticked = every vehicle)</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {VEHICLE_CLASSES.map((c) => <label key={c} className="flex items-center gap-1 capitalize"><input type="checkbox" name="applies_to_classes" value={c} defaultChecked={classes.includes(c)} />{c}</label>)}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="is_preventive" defaultChecked={rule?.is_preventive ?? true} /> Routine service (shows as due)</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={rule?.active ?? true} /> In use</label>
      </div>
      <div className="flex flex-wrap items-center gap-3"><Submit>{rule ? "Save rule" : "Add rule"}</Submit>{rule && <a href={`/w/${slug}/settings`} className="text-sm text-zinc-600 underline">Cancel</a>}<Notice state={state} /></div>
    </form>
  );
}
