"use client";
import { useActionState } from "react";
import { Field, Input, Notice, Select, inputCls } from "@/components/form";
import type { FormState } from "@/app/w/[slug]/actions-util";
import { signUpAction } from "./actions";

const SIZES: [string, string][] = [["1-5", "1 to 5 vehicles"], ["6-20", "6 to 20 vehicles"], ["21-50", "21 to 50 vehicles"], ["51-200", "51 to 200 vehicles"], ["200+", "More than 200"]];

/** Pakistan only for now. Set to false to show the country picker again; the foreign-customer flows are still in the code. */
const PAKISTAN_ONLY = true;

/** `countries` is made on the server and passed in: the browser's own list of names can differ from the server's, which breaks hydration. */
export function SignupForm({ trialDays, countries }: { trialDays: number; countries: [string, string][] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(signUpAction, {});
  const err = state.fields?.terms;
  return (
    <form action={action} noValidate className="space-y-4">
      <Input name="org_name" label="Company name" state={state} required autoComplete="organization" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input name="contact_name" label="Your name" state={state} required autoComplete="name" />
        <Input name="phone" label="Phone (optional)" state={state} inputMode="tel" autoComplete="tel" />
      </div>
      <Input name="email" label="Work email" type="email" state={state} required autoComplete="email" hint="We send a confirmation link here. You sign in with this address." />
      <div className={PAKISTAN_ONLY ? "" : "grid gap-4 sm:grid-cols-2"}>
        {PAKISTAN_ONLY ? <input type="hidden" name="country" value="PK" /> : <Select name="country" label="Country" state={state} blank="Choose" required options={countries} />}
        <Select name="fleet_size" label="How many vehicles?" state={state} blank="Choose" options={SIZES} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Password" name="password" state={state} required hint="At least 10 characters.">
          <input id="password" name="password" type="password" autoComplete="new-password" className={inputCls} aria-invalid={!!state.fields?.password} />
        </Field>
        <Field label="Repeat the password" name="confirm" state={state} required>
          <input id="confirm" name="confirm" type="password" autoComplete="new-password" className={inputCls} aria-invalid={!!state.fields?.confirm} />
        </Field>
      </div>
      <div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="terms" defaultChecked={state.values?.terms === "on"} className="mt-1" aria-invalid={!!err} />
          <span>I agree to the <a href="/terms" target="_blank" className="underline">Terms</a> and the <a href="/privacy" target="_blank" className="underline">Privacy Policy</a>.</span>
        </label>
        {err && <p role="alert" className="mt-1 text-xs text-red-700">{err}</p>}
      </div>
      <Notice state={state} />
      <button type="submit" disabled={pending} className="h-12 w-full rounded-md bg-brand text-base font-semibold text-white disabled:opacity-60">{pending ? "Creating your account" : `Start my ${trialDays}-day free trial`}</button>
      <p className="text-center text-sm text-zinc-500">Already have an account? <a href="/login" className="underline">Sign in</a></p>
    </form>
  );
}
