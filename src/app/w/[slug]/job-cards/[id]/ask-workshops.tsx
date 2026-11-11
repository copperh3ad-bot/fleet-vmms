"use client";
import { useActionState } from "react";
import { Notice, Select, Submit } from "@/components/form";
import type { FormState } from "../../actions-util";
import { inviteWorkshopAction, uninviteWorkshopAction } from "../actions";

/** Ask one more workshop for an estimate on the same job card (C1). The page only shows this while fewer than three are asked. */
export function AskAnotherWorkshop({ slug, jobId, options }: { slug: string; jobId: string; options: [string, string][] }) {
  const [state, action] = useActionState<FormState, FormData>(inviteWorkshopAction.bind(null, slug, jobId), {});
  if (options.length === 0) return <p className="text-xs text-zinc-500">No other active workshop to ask. Add one under Vendors.</p>;
  return (
    <form action={action} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_auto]" noValidate>
      <Select name="vendor_id" label="Ask another workshop for an estimate" state={state} options={options} blank="Choose a workshop" />
      <Submit>Ask this workshop</Submit>
      <div className="sm:col-span-2"><Notice state={state} /></div>
    </form>
  );
}

/** Take back a request to an extra workshop that has not answered. */
export function WithdrawWorkshop({ slug, jobId, vendorId, name }: { slug: string; jobId: string; vendorId: string; name: string }) {
  const [state, action] = useActionState<FormState, FormData>(uninviteWorkshopAction.bind(null, slug, jobId, vendorId), {});
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <button type="submit" className="text-xs text-red-800 underline" aria-label={`Withdraw the request to ${name}`}>Withdraw</button>
      <Notice state={state} />
    </form>
  );
}
