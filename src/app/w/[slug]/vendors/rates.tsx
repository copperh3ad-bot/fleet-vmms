"use client";
import { useActionState } from "react";
import { Input, Notice, Select, Submit } from "@/components/form";
import type { FormState } from "../actions-util";
import { addRateAction, removeRateAction } from "./actions";

const BASIS: [string, string][] = [["per_trip", "per trip"], ["per_km", "per km"], ["per_day", "per day"], ["per_hour", "per hour"]];

export function RateForm({ slug, vendorId }: { slug: string; vendorId: string }) {
  const [state, action] = useActionState<FormState, FormData>(addRateAction.bind(null, slug, vendorId), {});
  const p = `rate-${vendorId}-`;
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2"><Input id={p + "label"} name="label" label="What the rate is for" state={state} hint="For example: Lahore to Karachi, 10-tonne truck" required /></div>
      <Select id={p + "basis"} name="basis" label="Charged" state={state} options={BASIS} blank="Choose" required />
      <Input id={p + "amount"} name="amount" label="Rate" state={state} inputMode="decimal" required />
      <div className="sm:col-span-2"><Input id={p + "notes"} name="notes" label="Notes" state={state} /></div>
      <div className="flex items-center gap-3 sm:col-span-2"><Submit>Add rate</Submit><Notice state={state} /></div>
    </form>
  );
}

export function RemoveRate({ slug, rateId }: { slug: string; rateId: string }) {
  const [state, action] = useActionState<FormState>(removeRateAction.bind(null, slug, rateId) as (p: FormState) => Promise<FormState>, {});
  return (
    <form action={action} className="inline">
      <button type="submit" className="text-xs text-zinc-600 underline">Remove</button>
      {state.error && <span role="alert" className="ml-2 text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
