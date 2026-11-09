"use client";
import { useActionState } from "react";
import { Input, Notice, Submit } from "@/components/form";
import type { FormState } from "../../actions-util";
import { askQuotesAction, awardQuoteAction, declineQuoteAction, recordQuoteAction } from "../actions";

/** Choose the logistics providers to ask for a quote on this trip (ADR-078). The ones already asked are ticked and locked. */
export function AskProviders({ slug, id, providers, asked }: { slug: string; id: string; providers: { id: string; name: string; phone: string | null }[]; asked: string[] }) {
  const [state, action] = useActionState<FormState, FormData>(askQuotesAction.bind(null, slug, id), {});
  if (providers.length === 0) return <p className="text-sm text-zinc-600">No logistics providers yet. Add one under Vendors and set its type to Logistics provider.</p>;
  return (
    <form action={action} className="space-y-3">
      <fieldset className="space-y-1.5 text-sm">
        <legend className="mb-1 text-xs font-medium text-zinc-600">Ask these providers for a quote</legend>
        {providers.map((p) => (
          <label key={p.id} className="flex items-center gap-2">
            <input type="checkbox" name="vendor_id" value={p.id} defaultChecked={asked.includes(p.id)} disabled={asked.includes(p.id)} />
            <span>{p.name}</span>{!p.phone && <span className="text-xs text-amber-800">no phone number on record</span>}{asked.includes(p.id) && <span className="text-xs text-zinc-500">asked</span>}
          </label>
        ))}
      </fieldset>
      {providers.some((p) => !asked.includes(p.id))
        ? <div className="flex items-center gap-3"><Submit>Ask for quotes</Submit><Notice state={state} /></div>
        : <p className="text-xs text-zinc-500">Every provider has been asked.</p>}
    </form>
  );
}

export function QuoteForm({ slug, quoteId, current }: { slug: string; quoteId: string; current?: { amount: string | null; vehicle_text: string | null; driver_text: string | null; notes: string | null; valid_until: string | null } }) {
  const [state, action] = useActionState<FormState, FormData>(recordQuoteAction.bind(null, slug, quoteId), {});
  const s: FormState = !state.values && current
    ? { ...state, values: { amount: current.amount ?? "", vehicle_text: current.vehicle_text ?? "", driver_text: current.driver_text ?? "", notes: current.notes ?? "", valid_until: current.valid_until ?? "" } }
    : state;
  const p = `q-${quoteId}-`;
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
      <Input id={p + "amount"} name="amount" label="Quoted amount" state={s} inputMode="decimal" required />
      <Input id={p + "valid"} name="valid_until" label="Valid until" type="date" state={s} />
      <Input id={p + "vehicle"} name="vehicle_text" label="Their vehicle" state={s} hint="Registration or type, if they say" />
      <Input id={p + "driver"} name="driver_text" label="Their driver" state={s} />
      <div className="sm:col-span-2"><Input id={p + "notes"} name="notes" label="Notes" state={s} /></div>
      <div className="flex items-center gap-3 sm:col-span-2"><Submit>{current?.amount ? "Correct the quote" : "Save the quote"}</Submit><Notice state={state} /></div>
    </form>
  );
}

export function DeclineButton({ slug, quoteId }: { slug: string; quoteId: string }) {
  const [state, action] = useActionState<FormState>(declineQuoteAction.bind(null, slug, quoteId) as (p: FormState) => Promise<FormState>, {});
  return (
    <form action={action} className="inline">
      <button type="submit" className="text-sm text-zinc-700 underline">Provider declined</button>
      {state.error && <span role="alert" className="ml-2 text-xs text-red-700">{state.error}</span>}
    </form>
  );
}

export function AwardForm({ slug, id, quoteId, vendor }: { slug: string; id: string; quoteId: string; vendor: string }) {
  const [state, action] = useActionState<FormState, FormData>(awardQuoteAction.bind(null, slug, id, quoteId), {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="w-64 max-w-full"><Input id={`award-${quoteId}`} name="note" label="Note (optional)" state={state} /></div>
      <Submit>{`Award to ${vendor}`}</Submit><Notice state={state} />
    </form>
  );
}
