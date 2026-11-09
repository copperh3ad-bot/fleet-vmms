"use client";
import { useActionState } from "react";
import { keepForm } from "@/components/keep-form";
import type { QuoteFormState } from "./actions";

const field = "h-12 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base text-zinc-900";

/** The provider's quote for one trip: a single amount, with the vehicle and driver if known, a date it holds until, and a note. */
export function TripQuoteForm({ submit, currency }: { submit: (prev: QuoteFormState, form: FormData) => Promise<QuoteFormState>; currency: string }) {
  const [state, action, pending] = useActionState<QuoteFormState, FormData>(submit, {});
  if (state.done) return <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-5 text-lg text-green-900">Thank you. Your quote was sent to the fleet office.</p>;
  return (
    <form onSubmit={keepForm(action)} className="flex flex-col gap-5" noValidate>
      <div>
        <label htmlFor="amount" className="mb-1 block text-sm text-zinc-600">Your price for the whole trip ({currency})</label>
        <input id="amount" name="amount" inputMode="decimal" className={field} autoComplete="off" placeholder="e.g. 70,000" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label htmlFor="vehicle_text" className="mb-1 block text-sm text-zinc-600">Vehicle you will send</label><input id="vehicle_text" name="vehicle_text" className={field} autoComplete="off" placeholder="Type or plate" /></div>
        <div><label htmlFor="driver_text" className="mb-1 block text-sm text-zinc-600">Driver</label><input id="driver_text" name="driver_text" className={field} autoComplete="off" /></div>
        <div className="col-span-2"><label htmlFor="valid_until" className="mb-1 block text-sm text-zinc-600">Quote valid until</label><input id="valid_until" name="valid_until" type="date" className={field} /></div>
      </div>
      <div><label htmlFor="notes" className="mb-1 block text-sm text-zinc-600">Notes for the fleet office</label><textarea id="notes" name="notes" rows={3} maxLength={1000} className="w-full rounded-xl border border-zinc-300 bg-white p-3 text-base text-zinc-900" placeholder="For example: fuel and tolls included" /></div>
      {state.error && <p role="alert" className="text-red-700">{state.error}</p>}
      <p className="text-sm text-zinc-500">This link works once. Check the price before you send.</p>
      <button type="submit" disabled={pending} className="h-14 w-full rounded-xl bg-brand text-lg font-semibold text-white disabled:opacity-60">{pending ? "Sending" : "Send quote"}</button>
    </form>
  );
}

/** The provider's invoice for one trip: number, date, the amount billed (it starts at the agreed price) and a note. */
export function TripInvoiceForm({ submit, currency, agreed }: { submit: (prev: QuoteFormState, form: FormData) => Promise<QuoteFormState>; currency: string; agreed: string }) {
  const [state, action, pending] = useActionState<QuoteFormState, FormData>(submit, {});
  if (state.done) return <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-5 text-lg text-green-900">Thank you. Your invoice was sent to the fleet office.</p>;
  return (
    <form onSubmit={keepForm(action)} className="flex flex-col gap-5" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <div><label htmlFor="invoice_no" className="mb-1 block text-sm text-zinc-600">Invoice number</label><input id="invoice_no" name="invoice_no" className={field} autoComplete="off" /></div>
        <div><label htmlFor="invoice_date" className="mb-1 block text-sm text-zinc-600">Invoice date</label><input id="invoice_date" name="invoice_date" type="date" className={field} /></div>
      </div>
      <div>
        <label htmlFor="amount" className="mb-1 block text-sm text-zinc-600">Amount billed ({currency})</label>
        <input id="amount" name="amount" inputMode="decimal" className={field} autoComplete="off" defaultValue={Number(agreed).toFixed(2)} />
        <p className="mt-1 text-xs text-zinc-500">If this is not the agreed price, say why in the notes.</p>
      </div>
      <div><label htmlFor="notes" className="mb-1 block text-sm text-zinc-600">Notes for the fleet office</label><textarea id="notes" name="notes" rows={3} maxLength={1000} className="w-full rounded-xl border border-zinc-300 bg-white p-3 text-base text-zinc-900" /></div>
      {state.error && <p role="alert" className="text-red-700">{state.error}</p>}
      <p className="text-sm text-zinc-500">This link works once. Check the figures before you send.</p>
      <button type="submit" disabled={pending} className="h-14 w-full rounded-xl bg-brand text-lg font-semibold text-white disabled:opacity-60">{pending ? "Sending" : "Send invoice"}</button>
    </form>
  );
}
