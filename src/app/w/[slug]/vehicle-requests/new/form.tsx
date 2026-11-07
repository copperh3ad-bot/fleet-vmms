"use client";
import { useActionState } from "react";
import { Input, Notice, Select, Submit } from "@/components/form";
import type { FormState } from "../../actions-util";
import { requestVehicleAction } from "../actions";

export function VehicleRequestForm({ slug, employees, today }: { slug: string; employees: [string, string][]; today: string }) {
  const [state, action] = useActionState<FormState, FormData>(requestVehicleAction.bind(null, slug), {});
  const s: FormState = state.values ? state : { ...state, values: { needed_from: today } };
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
      <Select name="for_employee" label="Employee who needs the vehicle" state={s} options={employees} blank="Choose" required />
      <Input name="needed_from" label="Needed from" state={s} type="date" required />
      <div className="sm:col-span-2"><Input name="reason" label="Why is a vehicle needed?" state={s} required /></div>
      <div className="sm:col-span-2"><Input name="vehicle_class" label="What kind of vehicle (optional)" state={s} hint="For example: a small car, a pickup." /></div>
      <div className="flex items-center gap-3 sm:col-span-2"><Submit>Ask for this vehicle</Submit><Notice state={state} /></div>
    </form>
  );
}
