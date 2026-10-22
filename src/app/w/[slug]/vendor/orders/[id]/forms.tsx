"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Input, Notice, Submit, inputCls } from "@/components/form";
import { LinesEditor, type EditorLine } from "@/components/lines-editor";
import type { FormState } from "../../../actions-util";
import { completeWorkAction, startWorkAction, submitInvoiceAction } from "../../actions";
import { FileInput } from "@/components/file-input";

function Go({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="h-11 rounded-md bg-sky-800 px-5 font-medium text-white disabled:opacity-60">{pending ? "Saving" : children}</button>;
}

export function StartButton({ slug, woId }: { slug: string; woId: string }) {
  const [state, action] = useActionState<FormState>(startWorkAction.bind(null, slug, woId), {});
  return <form action={action} className="space-y-2"><Go>Start work</Go><Notice state={state} /></form>;
}

export function CompleteForm({ slug, woId }: { slug: string; woId: string }) {
  const [state, action] = useActionState<FormState, FormData>(completeWorkAction.bind(null, slug, woId), {});
  return (
    <form action={action} className="space-y-2">
      <label htmlFor="note" className="block text-xs font-medium text-zinc-600">Note for the fleet team (optional)</label>
      <textarea id="note" name="note" rows={2} defaultValue={state.values?.note ?? ""} className={`${inputCls} h-auto py-2`} />
      <div className="flex flex-wrap items-center gap-3"><Go>Mark work as done</Go><Notice state={state} /></div>
    </form>
  );
}

export function InvoiceForm({ slug, woId, prefill }: { slug: string; woId: string; prefill: EditorLine[] }) {
  const [state, action] = useActionState<FormState, FormData>(submitInvoiceAction.bind(null, slug, woId), {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <p className="text-xs text-zinc-600">Lines from the approved quotation are filled in. Change quantities to what you actually did. Anything you add that was not in the quotation will be flagged for the fleet team.</p>
      <LinesEditor title="Invoice" initial={prefill} errors={state.fields} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input name="invoice_no" label="Your invoice number" state={state} required />
        <Input name="invoice_date" label="Invoice date" type="date" state={state} />
        <Input name="tax_amount" label="Tax amount" state={state} inputMode="decimal" />
      </div>
      <div>
        <label htmlFor="files" className="mb-1 block text-xs font-medium text-zinc-600">Upload the invoice and completion photos (PDF or photos)</label>
        <FileInput className="block w-full rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm" />
      </div>
      <div className="flex flex-wrap items-center gap-3"><Submit>Send invoice</Submit><Notice state={state} /></div>
    </form>
  );
}
