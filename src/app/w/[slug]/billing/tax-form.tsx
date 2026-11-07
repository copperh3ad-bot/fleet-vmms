"use client";
import { useActionState } from "react";
import { Field, Input, Notice, Submit, inputCls } from "@/components/form";
import type { FormState } from "../actions-util";
import type { TaxProfile } from "@/lib/billing/tax-data";
import { saveTaxProfileAction } from "./actions";

/** The customer's own details for its invoice (ADR-053): the registered company name, the NTN and the address. The NTN is needed before an invoice can be issued. */
export function TaxProfileForm({ slug, profile }: { slug: string; profile: TaxProfile | null }) {
  const [state, action] = useActionState<FormState, FormData>(saveTaxProfileAction.bind(null, slug), {});
  const v = (k: keyof TaxProfile) => state.values?.[k] ?? (profile?.[k] as string | null | undefined) ?? "";
  return (
    <form action={action} noValidate className="space-y-4">
      <Input name="legal_name" label="Registered company name *" state={{ ...state, values: { ...state.values, legal_name: v("legal_name") } }} autoComplete="organization" />
      <Input name="ntn" label="NTN *" state={{ ...state, values: { ...state.values, ntn: v("ntn") } }} hint="Needed to issue your invoice." />
      <Field label="Address on the invoice" name="address" state={state}>
        <textarea id="address" name="address" rows={2} defaultValue={v("address")} className={`${inputCls} h-auto py-2`} />
      </Field>
      <div className="flex flex-wrap items-center gap-3"><Submit pendingText="Saving">Save details</Submit><Notice state={state} /></div>
    </form>
  );
}
