"use client";
import { useActionState } from "react";
import { Input, Notice, Select } from "@/components/form";
import type { FormState } from "@/app/w/[slug]/actions-util";
import { createOrganizationAction } from "./actions";

const SIZES: [string, string][] = [["1-5", "1 to 5 vehicles"], ["6-20", "6 to 20 vehicles"], ["21-50", "21 to 50 vehicles"], ["51-200", "51 to 200 vehicles"], ["200+", "More than 200"]];

export function CreateOrganizationForm({ contactName, trialDays }: { contactName: string; trialDays: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createOrganizationAction, { values: { contact_name: contactName } });
  return (
    <form action={action} noValidate className="space-y-4">
      <Input name="org_name" label="Company name" state={state} required autoComplete="organization" />
      <Input name="contact_name" label="Your name" state={state} required autoComplete="name" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input name="phone" label="Phone (optional)" state={state} inputMode="tel" />
        <Select name="fleet_size" label="How many vehicles?" state={state} blank="Choose" options={SIZES} />
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="terms" defaultChecked={state.values?.terms === "on"} className="mt-1" /><span>I agree to the <a href="/terms" target="_blank" className="underline">Terms</a> and the <a href="/privacy" target="_blank" className="underline">Privacy Policy</a>.</span></label>
      {state.fields?.terms && <p role="alert" className="text-xs text-red-700">{state.fields.terms}</p>}
      <Notice state={state} />
      <button type="submit" disabled={pending} className="h-12 w-full rounded-md bg-brand text-base font-semibold text-white disabled:opacity-60">{pending ? "Starting" : `Start my ${trialDays}-day free trial`}</button>
    </form>
  );
}
