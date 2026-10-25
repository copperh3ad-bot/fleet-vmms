"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Notice, inputCls } from "@/components/form";
import type { FormState } from "../../actions-util";
import { verifyInvoiceAction } from "../actions";

function Confirm() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="inline-flex h-10 items-center rounded-md bg-brand px-5 text-sm font-medium text-white disabled:opacity-60">{pending ? "Saving" : "Confirm decision"}</button>;
}

type Pick = "pay_approved" | "pay_full" | "return";

export function DecisionForm({ slug, id, approved, invoiced, currency }: { slug: string; id: string; approved: string; invoiced: string; currency: string }) {
  const [state, action] = useActionState<FormState, FormData>(verifyInvoiceAction.bind(null, slug, id), {});
  const [pick, setPick] = useState<Pick>((state.values?.decision as Pick) ?? "pay_approved");
  const options: [Pick, string, string][] = [
    ["pay_approved", "Verify at the approved amount", `${currency} ${approved}. The workshop is told any extra line is not paid.`],
    ["pay_full", "Verify the full amount", `${currency} ${invoiced}. Needs a reason.`],
    ["return", "Send back to the workshop", "They must explain or reissue."],
  ];
  return (
    <form action={action} className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="sr-only">Decision</legend>
        {options.map(([v, title, sub]) => (
          <label key={v} className="flex cursor-pointer items-start gap-3 text-sm">
            <input type="radio" name="decision" value={v} checked={pick === v} onChange={() => setPick(v)} className="mt-1 accent-[#c2410c]" />
            <span><span className="block font-medium">{title}</span><span className="block text-xs text-zinc-500">{sub}</span></span>
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor="note" className="mb-1 block text-xs font-medium text-zinc-600">Note to the workshop and the record{pick !== "pay_approved" && <span className="text-red-700"> *</span>}</label>
        <textarea id="note" name="note" rows={3} defaultValue={state.values?.note ?? ""} className={`${inputCls} h-auto py-2`} />
        {state.fields?.note && <p role="alert" className="mt-1 text-xs text-red-700">{state.fields.note}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3"><Confirm /><Notice state={state} /></div>
    </form>
  );
}
