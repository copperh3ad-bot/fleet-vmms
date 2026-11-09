"use client";
import { useActionState } from "react";
import { Input, Notice, Submit } from "@/components/form";
import type { FormState } from "../../actions-util";
import { cargoStepAction, makeTripAction } from "../actions";

/** One next step of a cargo request, as its own small form, so the page never offers a step the request is not ready for. */
export function CargoStep({ slug, id, to, label, needsNote }: { slug: string; id: string; to: string; label: string; needsNote?: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(cargoStepAction.bind(null, slug, id, to), {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3" noValidate>
      {needsNote !== undefined && <div className="w-72 max-w-full"><Input id={`cargo-${to}-note`} name="note" label={needsNote ? "Reason" : "Note (optional)"} state={state} required={needsNote} /></div>}
      <Submit>{label}</Submit><Notice state={state} />
    </form>
  );
}

export function MakeTrip({ slug, id }: { slug: string; id: string }) {
  const [state, action] = useActionState<FormState>(makeTripAction.bind(null, slug, id) as (p: FormState) => Promise<FormState>, {});
  return (
    <form action={action} className="space-y-2">
      <p className="text-sm text-zinc-600">Opens a trip request filled in from this one. A manager then approves it and assigns a vehicle and driver, or, on Pro, sends it to logistics providers for quotes.</p>
      <Submit>Make a trip from this</Submit><Notice state={state} />
    </form>
  );
}
