"use client";
import { useActionState } from "react";
import { Input, Notice, Select, Submit } from "@/components/form";
import type { FormState } from "../../actions-util";
import { vehicleRequestStepAction } from "../actions";

/** One next step of a vehicle request: its own small form, so the page never offers a step the request is not ready for. */
export function VehicleRequestStep({ slug, id, to, label, fields, vehicles }: {
  slug: string; id: string; to: string; label: string; fields: ("note" | "vehicle")[]; vehicles?: [string, string][];
}) {
  const [state, action] = useActionState<FormState, FormData>(vehicleRequestStepAction.bind(null, slug, id, to), {});
  const optional = to === "assigned" || to === "purchase_approved";
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
      {fields.includes("vehicle") && <Select name="vehicle_id" label="Vehicle to give" state={state} options={vehicles ?? []} blank="Choose" required />}
      {fields.includes("note") && <div className="sm:col-span-2"><Input name="note" label={optional ? "Note (optional)" : "Reason"} state={state} required={!optional} /></div>}
      <div className="flex items-center gap-3 sm:col-span-2"><Submit>{label}</Submit><Notice state={state} /></div>
    </form>
  );
}
