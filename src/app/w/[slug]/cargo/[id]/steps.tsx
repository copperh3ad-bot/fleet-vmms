"use client";
import { useActionState } from "react";
import { Input, Notice, Submit } from "@/components/form";
import type { FormState } from "../../actions-util";
import { cargoStepAction, makeTripAction, setCargoWeightAction } from "../actions";

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

export function MakeTrip({ slug, id, vehicleId = null, label = "Make a trip from this", intro }: { slug: string; id: string; vehicleId?: string | null; label?: string; intro?: string }) {
  const [state, action] = useActionState<FormState>(makeTripAction.bind(null, slug, id, vehicleId) as (p: FormState) => Promise<FormState>, {});
  return (
    <form action={action} className="space-y-2">
      {intro !== undefined && intro !== "" && <p className="text-sm text-zinc-600">{intro}</p>}
      <Submit>{label}</Submit><Notice state={state} />
    </form>
  );
}

/** Logistics enters the weight of the load, in kilograms, so the system can suggest a vehicle (ADR-092). */
export function WeightForm({ slug, id, current }: { slug: string; id: string; current: string | null }) {
  const [state, action] = useActionState<FormState, FormData>(setCargoWeightAction.bind(null, slug, id), {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3" noValidate>
      <div className="w-56 max-w-full"><Input name="weight_kg" label="Weight of the load (kg)" state={state} defaultValue={current ?? ""} inputMode="decimal" required /></div>
      <Submit>Save weight</Submit><Notice state={state} />
    </form>
  );
}
