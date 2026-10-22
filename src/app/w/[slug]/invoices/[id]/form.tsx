"use client";
import { useActionState } from "react";
import { Field, Notice, Submit, inputCls } from "@/components/form";
import type { FormState } from "../../actions-util";
import { verifyInvoiceAction } from "../actions";

export function DecisionForm({ slug, id, approved, invoiced }: { slug: string; id: string; approved: string; invoiced: string }) {
  const [state, action] = useActionState<FormState, FormData>(verifyInvoiceAction.bind(null, slug, id), {});
  const chosen = state.values?.decision ?? "pay_approved";
  return (
    <form action={action} className="space-y-3">
      <fieldset className="space-y-2 text-sm">
        <legend className="sr-only">Decision</legend>
        {[["pay_approved", `Pay the approved amount (${approved})`], ["pay_full", `Pay the full invoice (${invoiced}). Needs a note.`], ["return", "Return to the vendor. Needs a note."]].map(([v, l]) => (
          <label key={v} className="flex items-start gap-2"><input type="radio" name="decision" value={v} defaultChecked={chosen === v} className="mt-1" /><span>{l}</span></label>
        ))}
      </fieldset>
      <Field label="Note" name="note" state={state}>
        <textarea id="note" name="note" rows={2} defaultValue={state.values?.note ?? ""} className={`${inputCls} h-auto py-2`} />
      </Field>
      <div className="flex flex-wrap items-center gap-3"><Submit>Record decision</Submit><Notice state={state} /></div>
    </form>
  );
}
