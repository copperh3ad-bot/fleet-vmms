"use client";
import { useActionState, useState } from "react";
import { formatPrice } from "@/lib/billing/offer";
import { Input, Notice, Select, Submit, Field, inputCls } from "@/components/form";
import { FileInput } from "@/components/file-input";
import type { FormState } from "../actions-util";
import { submitClaimAction, requestBillAction, startProTrialAction, requestBasicAction, cancelBasicAction } from "./actions";

export type PlanPrice = { key: string; label: string; cents: number; currency: string };

/** Months of price charged: 12 paid at once get one month free (ADR-057). Same rule as the server's `billedMonths`. */
const chargedMonths = (months: number) => (months >= 12 ? months - Math.floor(months / 12) : months);
const amountFor = (p: PlanPrice | undefined, months: number, fallback: string) => (p ? String((p.cents * chargedMonths(months)) / 100) : fallback);

export function ClaimForm({ slug, defaultAmount, defaultCurrency, today, plans, defaultPlan }: { slug: string; defaultAmount: string; defaultCurrency: "USD" | "PKR"; today: string; plans: PlanPrice[]; defaultPlan: string }) {
  const [state, action] = useActionState<FormState, FormData>(submitClaimAction.bind(null, slug), {});
  // after a send the boxes are cleared; after an error they keep what was typed
  const s: FormState = state.ok ? { ...state, values: {} } : state.values ? state : { ...state, values: { currency: defaultCurrency, paid_on: today } };
  const [plan, setPlan] = useState(state.values?.plan ?? defaultPlan);
  const [period, setPeriod] = useState(state.values?.months === "12" ? "12" : "1");
  const [amount, setAmount] = useState(state.values?.amount ?? amountFor(plans.find((p) => p.key === defaultPlan), 1, defaultAmount));
  const chosen = plans.find((p) => p.key === plan);
  const recompute = (nextPlan: string, nextPeriod: string) => setAmount(amountFor(plans.find((p) => p.key === nextPlan), Number(nextPeriod), defaultAmount));
  const month = chosen ? formatPrice(chosen.cents, chosen.currency) : "";
  const year = chosen ? formatPrice(chosen.cents * chargedMonths(12), chosen.currency) : "";
  const choices: [string, string, string, string][] = [["1", "1 month", month, "Pay again next month"], ["12", "12 months", year, "One month free: you pay for 11"]];
  return (
    <form action={action} noValidate className="space-y-4" key={state.ok ?? "form"}>
      {plans.length > 0 && (
        <Field label="Paying for" name="plan" state={s} required>
          <select id="plan" name="plan" className={inputCls} value={plan} onChange={(e) => { setPlan(e.target.value); recompute(e.target.value, period); }}>
            {plans.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </Field>
      )}
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-zinc-700">How long are you paying for?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {choices.map(([v, t, price, note]) => (
            <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${period === v ? "border-brand bg-brand/5" : "border-zinc-300 bg-white"}`}>
              <input type="radio" name="period" value={v} checked={period === v} onChange={() => { setPeriod(v); recompute(plan, v); }} className="mt-1" />
              <span><span className="block font-medium text-zinc-900">{t}{price && <span className="ml-2 font-mono">{price}</span>}</span><span className="block text-zinc-600">{note}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <input type="hidden" name="months" value={period} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input name="amount" label="Amount you sent" state={s} required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} hint="Filled in from your choice. Change it only if you sent a different amount." />
        <Select name="currency" label="Currency" state={s} blank="Choose" required options={[["USD", "US dollars (USD)"], ["PKR", "Pakistani rupees (PKR)"]]} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input name="paid_on" label="Date of the transfer" type="date" state={s} required />
        <Input name="bank_reference" label="Bank's transaction reference" state={s} required hint="From your bank's receipt or SMS." />
      </div>
      <Field label="Receipt (photo or PDF)" name="proof" state={s} hint="Helps us confirm it faster. Up to 4 MB.">
        <FileInput id="proof" name="proof" multiple={false} className={`${inputCls} h-auto py-2 text-sm`} />
      </Field>
      <Input name="note" label="Note (optional)" state={s} />
      <div className="flex flex-wrap items-center gap-3"><Submit pendingText="Sending">I have paid</Submit><Notice state={state} /></div>
    </form>
  );
}

export function RequestBillForm({ slug }: { slug: string }) {
  const [state, action] = useActionState<FormState, FormData>(requestBillAction.bind(null, slug), {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Submit pendingText="Sending">Request bill</Submit><Notice state={state} />
    </form>
  );
}

/** One button for a plan change, with its own message. */
function PlanButton({ slug, action, children, tone = "primary" }: { slug: string; action: (slug: string, prev: FormState, form: FormData) => Promise<FormState>; children: string; tone?: "primary" | "plain" }) {
  const [state, run] = useActionState<FormState, FormData>(action.bind(null, slug), {});
  return (
    <form action={run} className="flex flex-wrap items-center gap-3">
      {tone === "primary" ? <Submit pendingText="Working">{children}</Submit> : <PlainSubmit>{children}</PlainSubmit>}<Notice state={state} />
    </form>
  );
}
function PlainSubmit({ children }: { children: string }) {
  return <button type="submit" className="h-10 rounded-md border border-zinc-300 bg-white px-5 font-medium text-zinc-800 hover:bg-zinc-50">{children}</button>;
}
export const TryProButton = ({ slug }: { slug: string }) => <PlanButton slug={slug} action={startProTrialAction}>Try Pro free for 3 days</PlanButton>;
export const MoveToBasicButton = ({ slug }: { slug: string }) => <PlanButton slug={slug} action={requestBasicAction} tone="plain">Move to Basic when my period ends</PlanButton>;
export const KeepProButton = ({ slug }: { slug: string }) => <PlanButton slug={slug} action={cancelBasicAction} tone="plain">Stay on Pro</PlanButton>;
