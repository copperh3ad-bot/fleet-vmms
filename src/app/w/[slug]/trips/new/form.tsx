"use client";
import { useActionState } from "react";
import { Input, Notice, Select, Submit } from "@/components/form";
import type { FormState } from "../../actions-util";
import { requestTripAction } from "../actions";

export function TripRequestForm({ slug, vehicles }: { slug: string; vehicles: [string, string][] }) {
  const [state, action] = useActionState<FormState, FormData>(requestTripAction.bind(null, slug), {});
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
      <Select name="kind" label="What kind of request?" state={state} options={[["trip", "A trip: a vehicle for a journey"], ["pick_drop", "Staff pick and drop (logistics pool car)"]]} blank="A trip: a vehicle for a journey" />
      <div className="sm:col-span-2"><Input name="purpose" label="What is the trip for?" state={state} required /></div>
      <Input name="from_place" label="From" state={state} required />
      <Input name="to_place" label="To" state={state} required />
      <Input name="start_at" label="Leaves / first pick-up" state={state} type="datetime-local" required />
      <Input name="end_at" label="Returns / last drop-off" state={state} type="datetime-local" required />
      <Input name="stops" label="Other pick-up or drop-off points (pick and drop only)" state={state} hint="In order, separated by commas." />
      <Input name="passengers" label="Passengers (optional)" state={state} inputMode="numeric" />
      <Select name="preferred_vehicle_id" label="Preferred vehicle (pool car for pick and drop; optional)" state={state} options={vehicles} blank="No preference" />
      <div className="flex items-center gap-3 sm:col-span-2"><Submit>Ask for this trip</Submit><Notice state={state} /></div>
    </form>
  );
}
