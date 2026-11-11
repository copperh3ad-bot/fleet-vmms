"use client";
import { useActionState } from "react";
import { Input, Notice, Submit } from "@/components/form";
import type { FormState } from "../../actions-util";
import { addDealerQuoteAction, removeDealerQuoteAction } from "../actions";

/** Record a dealer's quotation for the vehicle to be bought (E4). */
export function DealerQuoteForm({ slug, id }: { slug: string; id: string }) {
  const [state, action] = useActionState<FormState, FormData>(addDealerQuoteAction.bind(null, slug, id), {});
  return (
    <form action={action} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3" noValidate>
      <Input name="dealer" label="Dealer" state={state} required />
      <Input name="vehicle" label="Vehicle quoted" state={state} required hint="Make, model and variant." />
      <Input name="amount" label="Price" state={state} required inputMode="decimal" />
      <Input name="valid_until" label="Valid until" state={state} type="date" />
      <div className="sm:col-span-2"><Input name="note" label="Note" state={state} /></div>
      <div className="flex items-center gap-3 sm:col-span-3"><Submit>Add quotation</Submit><Notice state={state} /></div>
    </form>
  );
}

export function RemoveDealerQuote({ slug, quoteId, label }: { slug: string; quoteId: string; label: string }) {
  const [state, action] = useActionState<FormState, FormData>(removeDealerQuoteAction.bind(null, slug, quoteId), {});
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <button type="submit" className="text-xs text-red-800 underline" aria-label={`Remove the quotation from ${label}`}>Remove</button>
      <Notice state={state} />
    </form>
  );
}
