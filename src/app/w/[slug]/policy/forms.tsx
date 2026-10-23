"use client";
import { useActionState } from "react";
import { Field, Input, Notice, Submit, inputCls } from "@/components/form";
import { FileInput } from "@/components/file-input";
import type { FormState } from "../actions-util";
import { removePolicyAction, uploadPolicyAction } from "./actions";

export function PolicyUpload({ slug }: { slug: string }) {
  const [state, action] = useActionState<FormState, FormData>(uploadPolicyAction.bind(null, slug), {});
  return (
    <form action={action} className="space-y-3" noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input name="title" label="Name" state={state} required hint="For example: Fleet maintenance policy 2026" />
        <Input name="effective_from" label="Effective from" state={state} type="date" />
      </div>
      <Field label="Note" name="notes" state={state} hint="Optional. What changed in this version.">
        <textarea id="notes" name="notes" rows={2} defaultValue={state.values?.notes ?? ""} className={`${inputCls} h-auto py-2`} />
      </Field>
      <div>
        <label htmlFor="policy-file" className="mb-1 block text-xs font-medium text-zinc-600">Policy file (PDF or photo, up to 4 MB) <span className="text-red-700">*</span></label>
        <FileInput id="policy-file" name="file" multiple={false} accept="application/pdf,image/*" className="block w-full rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-3 text-sm" />
      </div>
      <div className="flex flex-wrap items-center gap-3"><Submit pendingText="Uploading">Upload policy</Submit><Notice state={state} /></div>
    </form>
  );
}

export function PolicyRemove({ slug, id }: { slug: string; id: string }) {
  const [state, run] = useActionState<FormState>(removePolicyAction.bind(null, slug, id), {});
  return (
    <form action={run} className="inline">
      <button type="submit" className="text-xs text-zinc-600 underline">Remove</button>
      {state.error && <span role="alert" className="ml-2 text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
