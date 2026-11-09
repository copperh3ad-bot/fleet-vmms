"use client";
import { useActionState } from "react";
import { Input, Notice, Select, Submit } from "@/components/form";
import type { FormState } from "../../actions-util";
import { requestCargoAction } from "../actions";

const HANDLING: [string, string][] = [["Fragile", "Fragile"], ["Keep cold", "Keep cold"], ["Hazardous", "Hazardous"], ["Needs loading help", "Needs loading help"]];

/** Everything the fleet office needs to act on a cargo request; the same questions the WhatsApp menu asks. */
export function CargoRequestForm({ slug }: { slug: string }) {
  const [state, action] = useActionState<FormState, FormData>(requestCargoAction.bind(null, slug), {});
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
      <Input name="description" label="What needs to be moved?" state={state} required />
      <Input name="quantity_text" label="How much?" state={state} hint="For example: 12 cartons, about 300 kg" required />
      <fieldset className="contents">
        <legend className="sr-only">Pick-up</legend>
        <div className="sm:col-span-2"><Input name="pickup_place" label="Collect from (address or place)" state={state} required /></div>
        <Input name="pickup_contact" label="Contact person at the pick-up" state={state} required />
        <Input name="pickup_phone" label="Their mobile number" state={state} inputMode="tel" required />
        <Input name="pickup_at" label="Collect on" state={state} type="datetime-local" required />
      </fieldset>
      <fieldset className="contents">
        <legend className="sr-only">Delivery</legend>
        <div className="sm:col-span-2"><Input name="drop_place" label="Deliver to (address or place)" state={state} required /></div>
        <Input name="drop_contact" label="Contact person at the delivery" state={state} required />
        <Input name="drop_phone" label="Their mobile number" state={state} inputMode="tel" required />
        <Input name="deliver_by" label="Deliver by" state={state} type="datetime-local" required />
      </fieldset>
      <Select name="handling" label="Special handling (optional)" state={state} options={HANDLING} blank="None" />
      <Input name="department" label="Department or cost centre (optional)" state={state} />
      <div className="flex items-center gap-3 sm:col-span-2"><Submit>Send the request</Submit><Notice state={state} /></div>
    </form>
  );
}
