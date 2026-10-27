"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { sendInvoiceAction, type QuoteFormState } from "./actions";

function Go() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="h-14 w-full rounded-xl bg-brand text-lg font-semibold text-white disabled:opacity-60">{pending ? "Sending" : "Send invoice"}</button>;
}

const field = "h-12 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base text-zinc-900";
const KINDS: [string, string][] = [["part", "Part"], ["labour", "Labour"], ["service", "Service"], ["other", "Other"]];
type Approved = { id: string; kind: string; description: string; qty: string; unit_cost: string };

/** The invoice, started from the lines of the approved estimate so the workshop bills against them. Extra lines are allowed and are shown to the fleet office as not in the estimate. */
export function InvoiceForm({ token, currency, approved }: { token: string; currency: string; approved: Approved[] }) {
  const [state, action] = useActionState<QuoteFormState, FormData>(sendInvoiceAction.bind(null, token), {});
  const [extra, setExtra] = useState(0);
  const rows = approved.length + extra;
  if (state.done) return <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-5 text-lg text-green-900">Thank you. Your invoice was sent to the fleet office.</p>;
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="count" value={rows} />
      <div className="grid grid-cols-2 gap-3">
        <div><label htmlFor="invoice_no" className="mb-1 block text-sm text-zinc-600">Your invoice number</label><input id="invoice_no" name="invoice_no" className={field} autoComplete="off" maxLength={60} /></div>
        <div><label htmlFor="invoice_date" className="mb-1 block text-sm text-zinc-600">Invoice date</label><input id="invoice_date" name="invoice_date" type="date" className={field} /></div>
      </div>
      <fieldset className="space-y-4">
        <legend className="mb-1 font-medium">What was done and what it cost</legend>
        {Array.from({ length: rows }, (_, i) => {
          const a = approved[i];
          return (
            <div key={i} className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3">
              <label className="block text-sm text-zinc-600" htmlFor={`description_${i}`}>{a ? `Line ${i + 1}, from the approved estimate` : `Extra line ${i + 1 - approved.length}, not in the estimate`}</label>
              {a && <input type="hidden" name={`qlid_${i}`} value={a.id} />}
              <input id={`description_${i}`} name={`description_${i}`} className={field} defaultValue={a?.description ?? ""} placeholder="e.g. Front brake pads" autoComplete="off" />
              <div className="grid grid-cols-3 gap-2">
                <select name={`kind_${i}`} aria-label={`Line ${i + 1} type`} className={field} defaultValue={a?.kind ?? "service"}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <input name={`qty_${i}`} aria-label={`Line ${i + 1} quantity`} inputMode="decimal" placeholder="Qty" defaultValue={a ? String(Number(a.qty)) : ""} className={field} autoComplete="off" />
                <input name={`unit_cost_${i}`} aria-label={`Line ${i + 1} cost each in ${currency}`} inputMode="decimal" placeholder={`Each (${currency})`} defaultValue={a ? String(Number(a.unit_cost)) : ""} className={field} autoComplete="off" />
              </div>
            </div>
          );
        })}
        {rows < 50 && <button type="button" onClick={() => setExtra((n) => n + 1)} className="h-11 w-full rounded-xl border border-zinc-300 bg-white text-base font-medium">Add an extra line</button>}
      </fieldset>
      <div><label htmlFor="tax_amount" className="mb-1 block text-sm text-zinc-600">Tax on the invoice ({currency}), if any</label><input id="tax_amount" name="tax_amount" inputMode="decimal" className={field} autoComplete="off" /></div>
      {state.error && <p role="alert" className="text-red-700">{state.error}</p>}
      <p className="text-sm text-zinc-500">This link works once. Sending the invoice tells the fleet office the work is done. Check the lines before you send.</p>
      <Go />
    </form>
  );
}
