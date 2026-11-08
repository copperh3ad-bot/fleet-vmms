"use client";
import { useActionState } from "react";
import { keepForm } from "@/components/keep-form";
import { Field, Input, Notice, inputCls } from "@/components/form";
import { Panel } from "@/components/ui";
import { LinesEditor } from "@/components/lines-editor";
import type { FormState } from "../../../actions-util";
import { submitQuotationAction } from "../../actions";
import { FileInput } from "@/components/file-input";

function Send({ pending }: { pending: boolean }) {
  return <button type="submit" disabled={pending} className="inline-flex h-11 items-center rounded-md bg-brand px-6 text-sm font-medium text-white disabled:opacity-60">{pending ? "Sending" : "Send quotation"}</button>;
}

export function QuotationForm({ slug, jobId }: { slug: string; jobId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(submitQuotationAction.bind(null, slug, jobId), {});
  return (
    <form onSubmit={keepForm(action)} noValidate>
      <Panel title="Your quotation" sub="Draft, not sent">
        <LinesEditor title="Quotation" errors={state.fields} />
        <div className="mt-5 grid gap-4 border-t border-zinc-100 pt-5 sm:grid-cols-3">
          <Input name="days_needed" label="Days needed" state={state} inputMode="numeric" />
          <Input name="valid_until" label="Quote valid until" type="date" state={state} />
          <Input name="warranty_months" label="Warranty on work (months)" state={state} inputMode="numeric" />
        </div>
        <div className="mt-4">
          <Field label="Notes" name="details" state={state}>
            <textarea id="details" name="details" rows={2} defaultValue={state.values?.details ?? ""} className={`${inputCls} h-auto py-2`} />
          </Field>
        </div>
        <div className="mt-4">
          <label htmlFor="files" className="mb-1 block text-xs font-medium text-zinc-600">Attach your printed quotation (PDF or photo)</label>
          <FileInput className="block w-full rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm" />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3"><Send pending={pending} /><Notice state={state} /></div>
      </Panel>
    </form>
  );
}
