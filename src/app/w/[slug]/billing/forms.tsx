"use client";
import { useActionState } from "react";
import { Input, Notice, Select, Submit, Field, inputCls } from "@/components/form";
import { FileInput } from "@/components/file-input";
import type { FormState } from "../actions-util";
import { submitClaimAction, requestBillAction } from "./actions";

export function ClaimForm({ slug, defaultAmount, defaultCurrency, today }: { slug: string; defaultAmount: string; defaultCurrency: "USD" | "PKR"; today: string }) {
  const [state, action] = useActionState<FormState, FormData>(submitClaimAction.bind(null, slug), {});
  // after a send the boxes are cleared; after an error they keep what was typed
  const s: FormState = state.ok ? { ...state, values: {} } : state.values ? state : { ...state, values: { amount: defaultAmount, currency: defaultCurrency, paid_on: today, months: "1" } };
  return (
    <form action={action} noValidate className="space-y-4" key={state.ok ?? "form"}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Input name="amount" label="Amount you sent" state={s} required inputMode="decimal" />
        <Select name="currency" label="Currency" state={s} blank="Choose" required options={[["USD", "US dollars (USD)"], ["PKR", "Pakistani rupees (PKR)"]]} />
        <Input name="months" label="Months paid for" state={s} inputMode="numeric" hint="1 to 12. For 12, the amount is 11 months' price." />
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
