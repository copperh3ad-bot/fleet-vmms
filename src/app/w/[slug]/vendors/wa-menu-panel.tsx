"use client";
import { useActionState } from "react";
import { Notice } from "@/components/form";
import { setWaMenuAction } from "./actions";
import type { FormState } from "../actions-util";

/** The administrator decides whether employees may use the Fleet OTG WhatsApp menu (ADR-079). It is off until switched on, and switching it on is recorded with who and when. */
export function WaMenuPanel({ slug, on }: { slug: string; on: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setWaMenuAction.bind(null, slug, !on) as (p: FormState, f: FormData) => Promise<FormState>, {});
  return (
    <div className="space-y-3 text-sm">
      <p>{on
        ? "On. An employee whose phone number is on their record can say Hi to the Fleet OTG WhatsApp number and choose what to do. Each choice asks a few questions, then a summary, and nothing is sent until the employee replies YES. Requests reach the fleet office exactly as if they were made in the app."
        : "Off. When on, employees can say Hi on WhatsApp to reserve a trip or send an odometer reading by answering a few questions."}</p>
      <p className="text-zinc-600">It only works for an employee who has a login and a phone number on their record, and only for what their role allows. A phone number shared by two employees is never guessed.</p>
      <form action={action}>
        <button type="submit" disabled={pending} className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm disabled:opacity-60">{on ? "Switch off" : "Switch on"}</button>
      </form>
      <Notice state={state} />
    </div>
  );
}
