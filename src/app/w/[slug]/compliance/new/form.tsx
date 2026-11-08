"use client";
import { useActionState, useState } from "react";
import { Card, Input, Notice, Select, Submit } from "@/components/form";
import { keepForm } from "@/components/keep-form";
import type { FormState } from "../../actions-util";
import { addDocumentAction } from "../actions";

export function DocumentForm({ slug, vehicles, types, initial, bare }: { bare?: boolean; slug: string; vehicles: [string, string][]; types: [string, string][]; initial: Record<string, string> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addDocumentAction.bind(null, slug), {});
  const s: FormState = state.values ? state : { ...state, values: initial };
  const [type, setType] = useState(initial.doc_type ?? "");
  const insurance = type === "insurance";
  return (
    <form onSubmit={keepForm(action)} className="space-y-4" noValidate>
      <Wrap bare={bare}>
        <div className={`grid grid-cols-1 gap-3 ${bare ? "" : "sm:grid-cols-2"}`}>
          <Select name="vehicle_id" label="Vehicle" state={s} blank="Choose a vehicle" required options={vehicles} />
          <div>
            <label htmlFor="doc_type" className="mb-1 block text-xs font-medium text-zinc-600">Document <span className="text-red-700">*</span></label>
            <select id="doc_type" name="doc_type" value={type} onChange={(e) => setType(e.target.value)} className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-zinc-900" aria-invalid={!!state.fields?.doc_type}>
              <option value="">Choose the document</option>{types.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {state.fields?.doc_type && <p role="alert" className="mt-1 text-xs text-red-700">{state.fields.doc_type}</p>}
          </div>
          <Input name="reference" label={insurance ? "Policy number" : "Reference / certificate number"} state={s} required={insurance} />
          <Input name="issued_by" label={insurance ? "Insurer" : "Issued by"} state={s} required={insurance} />
          <Input name="valid_from" label="Valid from" type="date" state={s} required={insurance} />
          <Input name="expires_on" label="Expires on" type="date" state={s} required />
          <Input name="amount" label={insurance ? "Premium" : "Cost"} state={s} inputMode="decimal" />
        </div>
        <p className="mt-3 text-xs text-zinc-500">Renewing? Add the new document with its new expiry. The old one stays in the history and reminders move to the new one. You can attach the scan on the next page.</p>
      </Wrap>
      <div className="flex flex-wrap items-center gap-3"><Submit pending={pending}>Save document</Submit><Notice state={state} /></div>
    </form>
  );
}

function Wrap({ bare, children }: { bare?: boolean; children: React.ReactNode }) {
  return bare ? <>{children}</> : <Card>{children}</Card>;
}
