"use client";
import { useActionState } from "react";
import { Input, Notice, Submit } from "@/components/form";
import type { FormState } from "../actions-util";
import { removeLicenceAction, saveLicenceAction } from "./actions";
import type { Licence } from "@/lib/compliance/licences";

/** The driving licence of one employee: number, class, dates and an emergency contact. */
export function LicenceForm({ slug, employeeId, licence }: { slug: string; employeeId: string; licence?: Licence }) {
  const [state, action] = useActionState<FormState, FormData>(saveLicenceAction.bind(null, slug, employeeId), {});
  const s: FormState = !state.values
    ? { ...state, values: {
        licence_no: licence?.licence_no ?? "", licence_class: licence?.licence_class ?? "", issued_on: licence?.issued_on ?? "", expires_on: licence?.expires_on ?? "",
        emergency_contact_name: licence?.emergency_contact_name ?? "", emergency_contact_phone: licence?.emergency_contact_phone ?? "",
      } }
    : state;
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
      <Input name="licence_no" label="Licence number" state={s} required />
      <Input name="licence_class" label="Class or type" state={s} />
      <Input name="issued_on" label="Issued on" state={s} type="date" />
      <Input name="expires_on" label="Expires on" state={s} type="date" required />
      <Input name="emergency_contact_name" label="Emergency contact" state={s} />
      <Input name="emergency_contact_phone" label="Emergency phone" state={s} inputMode="tel" />
      <div className="flex items-center gap-3 sm:col-span-2"><Submit>Save licence</Submit><Notice state={state} />
        {licence && <button type="button" className="text-sm text-red-700 underline" onClick={() => { if (confirm("Remove this licence record?")) void removeLicenceAction(slug, employeeId); }}>Remove</button>}</div>
    </form>
  );
}
