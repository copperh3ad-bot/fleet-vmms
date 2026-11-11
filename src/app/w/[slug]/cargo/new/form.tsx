"use client";
import { useActionState } from "react";
import { Input, Notice, Submit } from "@/components/form";
import type { FormState } from "../../actions-util";
import { requestCargoAction } from "../actions";

/** The company's Vehicle Request Form, box for box; the same questions the WhatsApp menu asks. The request date is the day it is sent. */
export function CargoRequestForm({ slug, places = [] }: { slug: string; places?: string[] }) {
  const [state, action] = useActionState<FormState, FormData>(requestCargoAction.bind(null, slug), {});
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
      <datalist id="places">{places.map((p) => <option key={p} value={p} />)}</datalist>
      <Input name="department" label="Requesting department" state={state} required />
      <Input name="pickup_at" label="Vehicle required: date and time" state={state} type="datetime-local" required />
      <div className="sm:col-span-2"><Input name="pickup_place" label="Pick-up location (from)" state={state} list="places" required /></div>
      <div className="sm:col-span-2"><Input name="drop_place" label="Destination (to)" state={state} list="places" required /></div>
      <Input name="vehicle_type" label="Vehicle type required" state={state} hint="For example: 10-tonne truck, pickup, van" required />
      <Input name="description" label="Inventory / material load details" state={state} required />
      <Input name="quantity_text" label="Quantity of load, with its unit" state={state} hint="For example: 18000 lbs (180 bags)" required />
      <Input name="weight_kg" label="Total weight in kilograms" state={state} inputMode="decimal" hint="Optional. With it, the fleet office is shown which vehicles can carry the load." />
      <Input name="poc_details" label="Person or persons to contact, with phone numbers" state={state} hint="For example: Ali 0300 1234567 / Sara 0321 7654321" required />
      <div className="sm:col-span-2"><Input name="instructions" label="Any special instructions or requirements (optional)" state={state} /></div>
      <div className="flex items-center gap-3 sm:col-span-2"><Submit>Send the request</Submit><Notice state={state} /></div>
    </form>
  );
}
