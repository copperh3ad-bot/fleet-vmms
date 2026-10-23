"use client";
import { useActionState } from "react";
import { Notice, Submit, inputCls } from "@/components/form";
import type { FormState } from "@/app/w/[slug]/actions-util";

export function SettingForm({ action, name, value, multiline }: { action: (p: FormState, f: FormData) => Promise<FormState>; name: string; value: string; multiline: boolean }) {
  const [state, run] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={run} className="space-y-3">
      {multiline
        ? <textarea name="value" rows={5} defaultValue={value} aria-label={name} className={`${inputCls} h-auto py-2 font-mono text-[13px]`} />
        : <input name="value" defaultValue={value} aria-label={name} className={inputCls} />}
      {state.fields?.[name] && <p role="alert" className="text-xs text-red-700">{state.fields[name]}</p>}
      <div className="flex flex-wrap items-center gap-3"><Submit pendingText="Saving">Save</Submit><Notice state={state} /></div>
    </form>
  );
}
