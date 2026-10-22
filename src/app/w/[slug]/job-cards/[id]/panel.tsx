"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Notice, Select, inputCls } from "@/components/form";
import type { FormState } from "../../actions-util";
import { transitionAction } from "../actions";

/** One decision. The comment box is shown when the step needs a reason; extra pickers come in as children. */
function Step({ slug, id, to, label, comment, commentLabel, tone = "primary", children }: {
  slug: string; id: string; to: string; label: string; comment?: "required" | "optional"; commentLabel?: string; tone?: "primary" | "plain" | "danger";
  children?: (state: FormState) => React.ReactNode;
}) {
  const [state, action] = useActionState<FormState, FormData>(transitionAction.bind(null, slug, id, to), {});
  const btn = tone === "danger" ? "border border-red-300 bg-white text-red-800" : tone === "plain" ? "border border-zinc-300 bg-white text-zinc-900" : "bg-sky-800 text-white";
  return (
    <form action={action} className="space-y-2 rounded-md border border-zinc-100 p-3">
      {children?.(state)}
      {comment && (
        <div>
          <label htmlFor={`comment-${to}`} className="mb-1 block text-xs font-medium text-zinc-600">{commentLabel ?? "Comment"}{comment === "required" && <span className="text-red-700"> *</span>}</label>
          <textarea id={`comment-${to}`} name="comment" rows={2} defaultValue={state.values?.comment ?? ""} className={`${inputCls} h-auto py-2`} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitStep className={btn}>{label}</SubmitStep>
        <Notice state={state} />
      </div>
    </form>
  );
}

function SubmitStep({ children, className }: { children: React.ReactNode; className: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className={`h-10 rounded-md px-5 font-medium disabled:opacity-60 ${className}`}>{pending ? "Saving" : children}</button>;
}

export function ApprovalPanel({ slug, id, reasons, currentReason }: { slug: string; id: string; reasons: { id: string; label: string }[]; currentReason: string }) {
  return (
    <div className="space-y-3">
      <Step slug={slug} id={id} to="approved" label="Approve" comment="optional" commentLabel="Note (optional)">
        {(s) => <Select name="reason_code_id" label="Reason (change it if the requester picked the wrong one)" state={{ ...s, values: { reason_code_id: s.values?.reason_code_id ?? currentReason } }} blank="Keep as requested" options={reasons.map((r) => [r.id, r.label])} />}
      </Step>
      <Step slug={slug} id={id} to="returned_for_edit" label="Send back for edit" tone="plain" comment="required" commentLabel="What should change?" />
      <Step slug={slug} id={id} to="rejected" label="Reject" tone="danger" comment="required" commentLabel="Why is it rejected?" />
    </div>
  );
}

export function DraftPanel({ slug, id }: { slug: string; id: string }) {
  return (
    <div className="space-y-3">
      <Step slug={slug} id={id} to="submitted" label="Submit for approval" />
      <Step slug={slug} id={id} to="cancelled" label="Cancel this job card" tone="danger" />
    </div>
  );
}

export function VendorPanel({ slug, id, vendors }: { slug: string; id: string; vendors: { id: string; name: string }[] }) {
  return (
    <Step slug={slug} id={id} to="vendor_assigned" label="Assign vendor">
      {(s) => <Select name="vendor_id" label="Workshop" state={s} blank="Choose a vendor" required options={vendors.map((v) => [v.id, v.name])} />}
    </Step>
  );
}
