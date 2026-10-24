"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Notice, inputCls } from "@/components/form";
import { btn } from "@/components/ui";
import type { ReviewContext } from "@/lib/jobcards/service";
import type { FormState } from "../../actions-util";
import { reviewDecisionAction } from "../actions";

function Go({ intent, tone, children }: { intent: string; tone: "primary" | "plain" | "danger"; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  const cls = tone === "primary" ? "bg-brand text-white w-full h-11 justify-center" : tone === "danger" ? "border border-red-300 bg-white text-red-800 h-10 flex-1 justify-center" : `${btn} flex-1 justify-center`;
  return <button type="submit" name="intent" value={intent} disabled={pending} className={`inline-flex items-center rounded-md px-4 text-sm font-medium disabled:opacity-60 ${cls}`}>{pending ? "Saving" : children}</button>;
}

type Decision = "approve" | "return" | "reject";
const OPTIONS: [Decision, string, string][] = [
  ["approve", "Approve and assign a workshop", "Work can start once the workshop quotes."],
  ["return", "Return for edit", "Sends it back with your note."],
  ["reject", "Reject", "Ends the job card. A note is required."],
];

export function DecisionForm({ slug, id, requester, reasons, currentReasonId, vendors, canAssign }: {
  slug: string; id: string; requester: string;
  reasons: { id: string; label: string }[]; currentReasonId: string; vendors: ReviewContext["vendors"]; canAssign: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(reviewDecisionAction.bind(null, slug, id), {});
  const [decision, setDecision] = useState<Decision>("approve");
  const [vendor, setVendor] = useState(state.values?.vendor_id ?? "");
  const chosen = vendors.find((v) => v.id === vendor);
  const days = (n: number | null) => (n === null ? "—" : `${n} days`);
  const pct = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${n}%`);

  return (
    <form action={action} className="space-y-4" noValidate>
      <div>
        <label htmlFor="reason_code_id" className="mb-1 block text-xs font-medium text-zinc-600">Reason. Change it if the driver chose wrong.</label>
        <select key={state.values?.reason_code_id ?? currentReasonId} id="reason_code_id" name="reason_code_id" defaultValue={state.values?.reason_code_id ?? currentReasonId} className={inputCls}>{reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
        <p className="mt-1 text-xs text-zinc-500">If you change it, the change is recorded with your name.</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-medium text-zinc-600">Decision</legend>
        {OPTIONS.filter(([k]) => k !== "approve" || canAssign).map(([k, title, sub]) => (
          <label key={k} className={`block cursor-pointer rounded-md border p-3 ${decision === k ? "border-brand bg-sky-100" : "border-zinc-200 bg-white"}`}>
            <span className="flex items-start gap-3"><input type="radio" name="decision_pick" checked={decision === k} onChange={() => setDecision(k)} className="mt-1 accent-[#0B6E8A]" />
              <span><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-zinc-500">{k === "return" ? `Sends it back to ${requester} with your note.` : sub}</span></span></span>
          </label>
        ))}
      </fieldset>

      {decision === "approve" && canAssign && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-zinc-600">Workshop</legend>
          {vendors.length === 0 && <p className="text-sm text-zinc-500">No active workshops. Add one under Vendors first.</p>}
          {vendors.map((v) => (
            <label key={v.id} className={`block cursor-pointer rounded-md border p-3 ${vendor === v.id ? "border-brand bg-sky-100" : "border-zinc-200 bg-white"}`}>
              <span className="flex items-start gap-3"><input type="radio" name="vendor_id" value={v.id} checked={vendor === v.id} onChange={() => setVendor(v.id)} className="mt-1 accent-[#0B6E8A]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{v.name}</span>
                  <span className="block font-mono text-xs text-zinc-500">{v.jobs === 0 ? "no finished work yet" : `${days(v.avg_days)} · quote ${pct(v.quote_vs_bill_pct)} · rework ${v.rework_pct ?? 0}%`}</span>
                  {v.warning && <span className="mt-1.5 block rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">{v.warning}</span>}
                </span></span>
            </label>
          ))}
          {state.fields?.vendor_id && <p role="alert" className="text-xs text-red-700">{state.fields.vendor_id}</p>}
        </fieldset>
      )}

      <div>
        <label htmlFor="comment" className="mb-1 block text-xs font-medium text-zinc-600">Note to the requester and workshop{decision !== "approve" && <span className="text-red-700"> *</span>}</label>
        <textarea id="comment" name="comment" rows={3} defaultValue={state.values?.comment ?? ""} className={`${inputCls} h-auto py-2`} />
      </div>

      <Notice state={state} />
      <div className="space-y-2">
        {decision === "approve" && canAssign && <Go intent="approve" tone="primary">{chosen ? `Approve and assign ${chosen.name}` : "Approve and assign"}</Go>}
        {decision === "approve" && !canAssign && <p className="text-sm text-zinc-500">Your role can approve but not choose a workshop. Ask a manager.</p>}
        {decision === "return" && <Go intent="return" tone="primary">Send back for edit</Go>}
        {decision === "reject" && <Go intent="reject" tone="danger">Reject</Go>}
        {decision === "approve" && canAssign && <div className="flex gap-2"><Go intent="return" tone="plain">Return for edit</Go><Go intent="reject" tone="danger">Reject</Go></div>}
      </div>
      <p className="text-xs text-zinc-500">You did not raise this card, so you can decide it. Every decision is logged.</p>
    </form>
  );
}
