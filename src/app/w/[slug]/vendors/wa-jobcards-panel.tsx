"use client";
import { useActionState } from "react";
import { Notice } from "@/components/form";
import { setWaJobCardsAction } from "../job-cards/actions";
import type { FormState } from "../actions-util";

/**
 * The administrator decides whether employees may raise job cards by WhatsApp (ADR-061). What an employee sends, with any photos, is read by the AI provider
 * (Anthropic) to make a draft, so it is off until an administrator switches it on, and switching it on is recorded with who and when.
 */
export function WaJobCardsPanel({ slug, on }: { slug: string; on: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setWaJobCardsAction.bind(null, slug, !on) as (p: FormState, f: FormData) => Promise<FormState>, {});
  return (
    <div className="space-y-3 text-sm">
      <p>{on
        ? "On. An employee whose phone number is on their record can send one WhatsApp message about a vehicle problem, with up to 3 photos. The AI makes a draft, the employee replies YES to send it, and it goes in as a normal request for a manager to approve."
        : "Off. When on, employees can raise a job card by sending one WhatsApp message to the Fleet OTG number."}</p>
      <p className="text-zinc-600">The message and photos are sent to Anthropic, our AI provider, which does not use them to train its models. Nothing else from your records is sent. A job card is only ever created after the employee confirms it, and the manager still approves it in the app. The employee&apos;s number must be on their employee record.</p>
      <form action={action}>
        <button type="submit" disabled={pending} className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm disabled:opacity-60">{on ? "Switch off" : "Switch on"}</button>
      </form>
      <Notice state={state} />
    </div>
  );
}
