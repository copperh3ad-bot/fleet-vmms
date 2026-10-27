"use client";
import { useActionState } from "react";
import { Notice } from "@/components/form";
import { setAiDocumentsAction } from "../job-cards/actions";
import type { FormState } from "../actions-util";

/**
 * The administrator decides whether the AI may read the estimates and invoices workshops send (ADR-034). The documents are sent to the AI provider
 * (Anthropic) to be read, so it is off until an administrator switches it on, and switching it on is recorded with who and when.
 */
export function AiDocumentsPanel({ slug, on, trialReads }: { slug: string; on: boolean; trialReads: number | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setAiDocumentsAction.bind(null, slug, !on) as (p: FormState, f: FormData) => Promise<FormState>, {});
  return (
    <div className="space-y-3 text-sm">
      <p>{on
        ? "On. When a workshop replies by email with an estimate or invoice, staff can press one button and the AI reads the attached file and fills in the form. A person always checks the figures and saves, and the job card's history says it was read by AI."
        : "Off. When on, staff can press a button to have the AI read the file a workshop emailed and fill in the form for them to check."}</p>
      {trialReads !== null && <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">During your trial, {trialReads} readings are included. Paying for Pro removes this cap.</p>}
      <p className="text-zinc-600">To read a file, it is sent to Anthropic, our AI provider, which does not use it to train its models. Nothing else from your records is sent: only the file, the job card number, the currency and, for an invoice, the lines of the approved estimate.</p>
      <form action={action}>
        <button type="submit" disabled={pending} className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm disabled:opacity-60">{on ? "Switch off" : "Switch on"}</button>
      </form>
      <Notice state={state} />
    </div>
  );
}
