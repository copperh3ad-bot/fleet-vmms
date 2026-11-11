"use client";
import { useActionState, useState } from "react";
import { Input, Notice, Select, Submit } from "@/components/form";
import type { FormState } from "../../actions-util";
import { vehicleRequestStepAction } from "../actions";

/** A pool vehicle as the step form needs it: the words to show, and any warnings (D1: expired papers, an open repair). */
export type StepVehicle = { id: string; label: string; warnings: string[] };

/** One next step of a vehicle request: its own small form, so the page never offers a step the request is not ready for. */
export function VehicleRequestStep({ slug, id, to, label, fields, vehicles }: {
  slug: string; id: string; to: string; label: string; fields: ("note" | "vehicle" | "amount")[]; vehicles?: StepVehicle[];
}) {
  const [state, action] = useActionState<FormState, FormData>(vehicleRequestStepAction.bind(null, slug, id, to), {});
  const [chosen, setChosen] = useState("");
  const optional = to === "assigned" || to === "purchase_approved" || to === "budget_confirmed";
  const warnings = vehicles?.find((v) => v.id === chosen)?.warnings ?? [];
  return (
    <form action={action} onChange={(e) => { const t = e.target as unknown as HTMLSelectElement; if (t.name === "vehicle_id") setChosen(t.value); }} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
      {fields.includes("amount") && <Input name="amount" label="Budget for the purchase" state={state} required inputMode="decimal" />}
      {fields.includes("vehicle") && <Select name="vehicle_id" label="Vehicle to give" state={state} options={(vehicles ?? []).map((v): [string, string] => [v.id, v.warnings.length ? `${v.label} (warning)` : v.label])} blank="Choose" required />}
      {warnings.length > 0 && (
        <div className="sm:col-span-2">
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Warning: {warnings.join("; ")}. You may still give this vehicle, but write why.</p>
          <div className="mt-3"><Input name="warn_reason" label="Why give it anyway" state={state} required /></div>
        </div>
      )}
      {fields.includes("note") && <div className="sm:col-span-2"><Input name="note" label={optional ? "Note (optional)" : "Reason"} state={state} required={!optional} /></div>}
      <div className="flex items-center gap-3 sm:col-span-2"><Submit>{label}</Submit><Notice state={state} /></div>
    </form>
  );
}
