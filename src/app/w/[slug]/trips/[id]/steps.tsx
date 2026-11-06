"use client";
import { useActionState } from "react";
import { Input, Notice, Select, Submit } from "@/components/form";
import type { FormState } from "../../actions-util";
import { tripStepAction } from "../actions";

/** One next step of a trip: its own small form, so the page never offers a step the trip is not ready for. */
export function TripStep({ slug, id, to, label, fields, vehicles, drivers, defaultVehicle }: {
  slug: string; id: string; to: string; label: string; fields: ("note" | "assign" | "odometer")[];
  vehicles?: [string, string][]; drivers?: [string, string][]; defaultVehicle?: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(tripStepAction.bind(null, slug, id, to), {});
  const s: FormState = state.values ? state : { ...state, values: { vehicle_id: defaultVehicle ?? "" } };
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
      {fields.includes("assign") && <>
        <Select name="vehicle_id" label="Vehicle" state={s} options={vehicles ?? []} required />
        <Select name="driver_id" label="Driver" state={s} options={drivers ?? []} required />
      </>}
      {fields.includes("odometer") && <Input name="odometer" label="Odometer (km)" state={s} inputMode="decimal" required />}
      {fields.includes("note") && <div className="sm:col-span-2"><Input name="note" label={to === "approved" ? "Note (optional)" : "Reason"} state={s} required={to !== "approved"} /></div>}
      <div className="flex items-center gap-3 sm:col-span-2"><Submit>{label}</Submit><Notice state={state} /></div>
    </form>
  );
}
