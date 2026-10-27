"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { QuoteFormState } from "./actions";

export type FormSubmit = (prev: QuoteFormState, form: FormData) => Promise<QuoteFormState>;

function Go() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="h-14 w-full rounded-xl bg-brand text-lg font-semibold text-white disabled:opacity-60">{pending ? "Sending" : "Send estimate"}</button>;
}

const field = "h-12 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base text-zinc-900";
const KINDS: [string, string][] = [["part", "Part"], ["labour", "Labour"], ["service", "Service"], ["other", "Other"]];

export function EstimateForm({ submit, currency, doneText = "Thank you. Your estimate was sent to the fleet office." }: { submit: FormSubmit; currency: string; doneText?: string }) {
  const [state, action] = useActionState<QuoteFormState, FormData>(submit, {});
  const [rows, setRows] = useState(1);
  if (state.done) return <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-5 text-lg text-green-900">{doneText}</p>;
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="count" value={rows} />
      <fieldset className="space-y-4">
        <legend className="mb-1 font-medium">What the job will cost</legend>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3">
            <label className="block text-sm text-zinc-600" htmlFor={`description_${i}`}>Line {i + 1}</label>
            <input id={`description_${i}`} name={`description_${i}`} className={field} placeholder="e.g. Front brake pads" autoComplete="off" />
            <div className="grid grid-cols-3 gap-2">
              <select name={`kind_${i}`} aria-label={`Line ${i + 1} type`} className={field} defaultValue="service">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input name={`qty_${i}`} aria-label={`Line ${i + 1} quantity`} inputMode="decimal" placeholder="Qty" className={field} autoComplete="off" />
              <input name={`unit_cost_${i}`} aria-label={`Line ${i + 1} cost each in ${currency}`} inputMode="decimal" placeholder={`Each (${currency})`} className={field} autoComplete="off" />
            </div>
          </div>
        ))}
        {rows < 50 && <button type="button" onClick={() => setRows((n) => n + 1)} className="h-11 w-full rounded-xl border border-zinc-300 bg-white text-base font-medium">Add another line</button>}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <div><label htmlFor="days_needed" className="mb-1 block text-sm text-zinc-600">Days needed</label><input id="days_needed" name="days_needed" inputMode="numeric" className={field} autoComplete="off" /></div>
        <div><label htmlFor="warranty_months" className="mb-1 block text-sm text-zinc-600">Warranty (months)</label><input id="warranty_months" name="warranty_months" inputMode="numeric" className={field} autoComplete="off" /></div>
        <div className="col-span-2"><label htmlFor="valid_until" className="mb-1 block text-sm text-zinc-600">Estimate valid until</label><input id="valid_until" name="valid_until" type="date" className={field} /></div>
      </div>
      <div><label htmlFor="details" className="mb-1 block text-sm text-zinc-600">Notes for the fleet office</label><textarea id="details" name="details" rows={3} maxLength={2000} className="w-full rounded-xl border border-zinc-300 bg-white p-3 text-base text-zinc-900" /></div>
      {state.error && <p role="alert" className="text-red-700">{state.error}</p>}
      <p className="text-sm text-zinc-500">This link works once. Check the lines before you send.</p>
      <Go />
    </form>
  );
}
