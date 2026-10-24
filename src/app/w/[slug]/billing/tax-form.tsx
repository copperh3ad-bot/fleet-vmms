"use client";
import { useActionState } from "react";
import { Field, Input, Notice, Submit, inputCls } from "@/components/form";
import type { FormState } from "../actions-util";
import type { TaxProfile } from "@/lib/billing/tax-data";
import { saveTaxProfileAction } from "./actions";

/** The customer's own details for its tax invoice. What it withholds is not asked here: that is agreed with the operator. */
export function TaxProfileForm({ slug, profile, rules }: { slug: string; profile: TaxProfile | null; rules: { code: string; label: string; sales_tax_pct: string }[] }) {
  const [state, action] = useActionState<FormState, FormData>(saveTaxProfileAction.bind(null, slug), {});
  const v = (k: keyof TaxProfile) => state.values?.[k] ?? (profile?.[k] as string | null | undefined) ?? "";
  return (
    <form action={action} noValidate className="space-y-4">
      <Field label="Where you are registered for sales tax" name="tax_rule_code" state={state} hint="Choose the authority your company falls under. Leave empty if sales tax does not apply to you.">
        <select id="tax_rule_code" name="tax_rule_code" defaultValue={v("tax_rule_code")} className={inputCls} aria-invalid={!!state.fields?.tax_rule_code}>
          <option value="">Not applicable</option>
          {rules.map((r) => <option key={r.code} value={r.code}>{r.label} ({Number(r.sales_tax_pct)}%)</option>)}
        </select>
      </Field>
      <Input name="legal_name" label="Registered company name" state={{ ...state, values: { ...state.values, legal_name: v("legal_name") } }} autoComplete="organization" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input name="ntn" label="NTN" state={{ ...state, values: { ...state.values, ntn: v("ntn") } }} />
        <Input name="strn" label="Sales tax registration (STRN)" state={{ ...state, values: { ...state.values, strn: v("strn") } }} hint="If you have one." />
      </div>
      <Field label="Address on the invoice" name="address" state={state}>
        <textarea id="address" name="address" rows={2} defaultValue={v("address")} className={`${inputCls} h-auto py-2`} />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="withholding_agent" defaultChecked={state.values ? state.values.withholding_agent === "on" : !!profile?.withholding_agent} className="mt-1" />
        <span>My company withholds tax when it pays suppliers, and will send a withholding certificate. We then agree the percentages with you; the amount to send is shown above once that is set.</span>
      </label>
      <div className="flex flex-wrap items-center gap-3"><Submit pendingText="Saving">Save tax details</Submit><Notice state={state} /></div>
    </form>
  );
}
