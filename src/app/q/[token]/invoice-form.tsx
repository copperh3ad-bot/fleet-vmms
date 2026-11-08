"use client";
import { useActionState, useState } from "react";
import { keepForm } from "@/components/keep-form";
import type { QuoteFormState } from "./actions";
import type { FormSubmit } from "./form";
import type { Draft } from "@/lib/ai/document";
import { invoiceRows, type ApprovedRow } from "@/lib/ai/rows";

function Go({ pending }: { pending: boolean }) {
  return <button type="submit" disabled={pending} className="h-14 w-full rounded-xl bg-brand text-lg font-semibold text-white disabled:opacity-60">{pending ? "Sending" : "Send invoice"}</button>;
}

const field = "h-12 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base text-zinc-900";
const KINDS: [string, string][] = [["part", "Part"], ["labour", "Labour"], ["service", "Service"], ["other", "Other"]];

/**
 * The invoice, started from the lines of the approved estimate so the workshop bills against them. Extra lines are allowed and are shown to the fleet
 * office as not in the estimate. `draft` and `aiActionId` are only passed on the signed-in staff page, when the AI has read the workshop's file (ADR-034).
 */
export function InvoiceForm({ submit, currency, approved, doneText = "Thank you. Your invoice was sent to the fleet office.", draft = null, aiActionId = "" }: { submit: FormSubmit; currency: string; approved: ApprovedRow[]; doneText?: string; draft?: Draft | null; aiActionId?: string }) {
  const [state, action, pending] = useActionState<QuoteFormState, FormData>(submit, {});
  const start = invoiceRows(approved, draft);
  const [extra, setExtra] = useState(start.extra.length);
  const rows = start.linked.length + extra;
  if (state.done) return <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-5 text-lg text-green-900">{doneText}</p>;
  return (
    <form onSubmit={keepForm(action)} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="count" value={rows} />
      {aiActionId && <input type="hidden" name="ai_action" value={aiActionId} />}
      <div className="grid grid-cols-2 gap-3">
        <div><label htmlFor="invoice_no" className="mb-1 block text-sm text-zinc-600">Your invoice number</label><input id="invoice_no" name="invoice_no" className={field} autoComplete="off" maxLength={60} defaultValue={draft?.document_number ?? ""} /></div>
        <div><label htmlFor="invoice_date" className="mb-1 block text-sm text-zinc-600">Invoice date</label><input id="invoice_date" name="invoice_date" type="date" className={field} defaultValue={draft?.document_date ?? ""} /></div>
      </div>
      <fieldset className="space-y-4">
        <legend className="mb-1 font-medium">What was done and what it cost</legend>
        {Array.from({ length: rows }, (_, i) => {
          const r = i < start.linked.length ? start.linked[i] : start.extra[i - start.linked.length] ?? null;
          const linked = i < start.linked.length;
          return (
            <div key={i} className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3">
              <label className="block text-sm text-zinc-600" htmlFor={`description_${i}`}>{linked ? `Line ${i + 1}, from the approved estimate` : `Extra line ${i + 1 - start.linked.length}, not in the estimate`}</label>
              {linked && r?.qlid && <input type="hidden" name={`qlid_${i}`} value={r.qlid} />}
              <input id={`description_${i}`} name={`description_${i}`} className={field} defaultValue={r?.description ?? ""} placeholder="e.g. Front brake pads" autoComplete="off" />
              <div className="grid grid-cols-3 gap-2">
                <select name={`kind_${i}`} aria-label={`Line ${i + 1} type`} className={field} defaultValue={r?.kind ?? "service"}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <input name={`qty_${i}`} aria-label={`Line ${i + 1} quantity`} inputMode="decimal" placeholder="Qty" defaultValue={r?.qty ?? ""} className={field} autoComplete="off" />
                <input name={`unit_cost_${i}`} aria-label={`Line ${i + 1} cost each in ${currency}`} inputMode="decimal" placeholder={`Each (${currency})`} defaultValue={r?.unit_cost ?? ""} className={field} autoComplete="off" />
              </div>
            </div>
          );
        })}
        {rows < 50 && <button type="button" onClick={() => setExtra((n) => n + 1)} className="h-11 w-full rounded-xl border border-zinc-300 bg-white text-base font-medium">Add an extra line</button>}
      </fieldset>
      <div><label htmlFor="tax_amount" className="mb-1 block text-sm text-zinc-600">Tax on the invoice ({currency}), if any</label><input id="tax_amount" name="tax_amount" inputMode="decimal" className={field} autoComplete="off" defaultValue={draft?.tax_amount ?? ""} /></div>
      {state.error && <p role="alert" className="text-red-700">{state.error}</p>}
      <p className="text-sm text-zinc-500">This link works once. Sending the invoice tells the fleet office the work is done. Check the lines before you send.</p>
      <Go pending={pending} />
    </form>
  );
}
