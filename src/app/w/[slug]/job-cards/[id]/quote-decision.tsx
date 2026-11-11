"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Notice, inputCls } from "@/components/form";
import type { FormState } from "../../actions-util";
import { decideQuotationAction } from "../actions";

function Go({ children, tone }: { children: React.ReactNode; tone: "primary" | "danger" }) {
  const { pending } = useFormStatus();
  const cls = tone === "danger" ? "border border-red-300 bg-white text-red-800" : "bg-sky-800 text-white";
  return <button type="submit" disabled={pending} className={`h-10 rounded-md px-5 font-medium disabled:opacity-60 ${cls}`}>{pending ? "Saving" : children}</button>;
}

function One({ slug, quotationId, decision, mustExplain }: { slug: string; quotationId: string; decision: "approve" | "reject"; mustExplain?: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(decideQuotationAction.bind(null, slug, quotationId, decision), {});
  return (
    <form action={action} className="space-y-2 rounded-md border border-zinc-100 p-3">
      <label htmlFor={`c-${decision}-${quotationId}`} className="block text-xs font-medium text-zinc-600">
        {decision === "approve" ? (mustExplain ? <>Why do you still approve it?<span className="text-red-700"> *</span></> : "Note (optional)") : <>Why is it rejected?<span className="text-red-700"> *</span></>}
      </label>
      <textarea id={`c-${decision}-${quotationId}`} name="comment" rows={2} defaultValue={state.values?.comment ?? ""} className={`${inputCls} h-auto py-2`} />
      <div className="flex flex-wrap items-center gap-3">
        <Go tone={decision === "approve" ? "primary" : "danger"}>{decision === "approve" ? "Approve and issue work order" : "Reject"}</Go>
        <Notice state={state} />
      </div>
    </form>
  );
}

export function QuoteDecision({ slug, quotationId, mustExplain }: { slug: string; quotationId: string; mustExplain?: boolean }) {
  return <div className="mt-3 space-y-3"><One slug={slug} quotationId={quotationId} decision="approve" mustExplain={mustExplain} /><One slug={slug} quotationId={quotationId} decision="reject" /></div>;
}
