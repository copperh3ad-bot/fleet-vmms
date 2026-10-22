"use client";
import { createContext, useActionState, useContext, useTransition, type ReactNode } from "react";
import { Field, Notice, inputCls } from "@/components/form";
import { btnPrimary } from "@/components/ui";
import type { FormState } from "../actions-util";
import { saveRulesSettingsAction, toggleServiceRuleAction } from "./actions";

// "Save rules" sits in the page header while the numbers are in two panels, so one form (id "rules-form") is kept
// here and every field and the button attach to it by id. The context carries the result and any typed values back.
const Ctx = createContext<{ state: FormState; pending: boolean }>({ state: {}, pending: false });

export function RulesFormProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveRulesSettingsAction.bind(null, slug), {});
  return (
    <Ctx.Provider value={{ state, pending }}>
      <form id="rules-form" action={action} noValidate />
      {children}
    </Ctx.Provider>
  );
}

export type SettingItem = { key: string; label: string; value: string; editable: boolean; unit?: string };

export function SettingFields({ items }: { items: SettingItem[] }) {
  const { state } = useContext(Ctx);
  return (
    <div className="space-y-4">
      {items.map((i) => (
        <Field key={i.key} label={i.label} name={i.key} state={state}>
          <input id={i.key} name={i.key} form="rules-form" defaultValue={state.values?.[i.key] ?? i.value} disabled={!i.editable} inputMode="decimal" className={inputCls} aria-invalid={!!state.fields?.[i.key]} />
        </Field>
      ))}
    </div>
  );
}

export function SaveRulesButton() {
  const { state, pending } = useContext(Ctx);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Notice state={state} />
      <button type="submit" form="rules-form" disabled={pending} className={`${btnPrimary} disabled:opacity-60`}>{pending ? "Saving" : "Save rules"}</button>
    </div>
  );
}

/** An on/off switch that saves at once. */
export function RuleToggle({ slug, ruleKey, active, disabled, label }: { slug: string; ruleKey: string; active: boolean; disabled?: boolean; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" role="switch" aria-checked={active} aria-label={`${label}: ${active ? "on" : "off"}`} disabled={disabled || pending}
      onClick={() => start(async () => { await toggleServiceRuleAction(slug, ruleKey, !active); })}
      className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-60 ${active ? "bg-green-600" : "bg-zinc-300"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${active ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}
