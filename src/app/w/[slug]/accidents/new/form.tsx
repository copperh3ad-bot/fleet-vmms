"use client";
import { useActionState } from "react";
import { Card, Field, Input, Notice, Select, Submit, inputCls } from "@/components/form";
import type { FormState } from "../../actions-util";
import { addAccidentAction } from "../../compliance/actions";

export function AccidentForm({ slug, vehicles, people, initial }: { slug: string; vehicles: [string, string][]; people: [string, string][]; initial: Record<string, string> }) {
  const [state, action] = useActionState<FormState, FormData>(addAccidentAction.bind(null, slug), {});
  const s: FormState = state.values ? state : { ...state, values: initial };
  return (
    <form action={action} className="space-y-4" noValidate>
      <Card title="What happened">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select name="vehicle_id" label="Vehicle" state={s} blank="Choose a vehicle" required options={vehicles} />
          <Input name="occurred_at" label="When" type="datetime-local" state={s} required />
          <Select name="employee_id" label="Driver" state={s} blank="Whoever held the vehicle then" options={people} />
          <Input name="location" label="Where" state={s} />
          <Select name="severity" label="Severity" state={s} blank="Choose" required options={[["minor", "Minor"], ["moderate", "Moderate"], ["major", "Major"], ["total_loss", "Total loss"]]} />
          <Select name="fault" label="Who was at fault" state={s} blank="Not known yet" options={[["our_driver", "Our driver"], ["third_party", "The other party"], ["shared", "Shared"], ["unknown", "Unknown"]]} />
        </div>
        <div className="mt-3">
          <Field label="Description" name="description" state={s} required hint="At least 10 characters.">
            <textarea id="description" name="description" rows={3} defaultValue={s.values?.description ?? ""} aria-invalid={!!s.fields?.description} className={`${inputCls} h-auto py-2`} />
          </Field>
        </div>
      </Card>
      <Card title="Insurance claim">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="insurance_claim" defaultChecked={s.values?.insurance_claim === "on"} /> A claim has been made</label>
        <div className="mt-3 max-w-sm"><Input name="claim_ref" label="Claim reference" state={s} /></div>
        <input type="hidden" name="job_card_id" value={s.values?.job_card_id ?? ""} />
      </Card>
      <div className="flex flex-wrap items-center gap-3"><Submit>Save accident</Submit><Notice state={state} /></div>
      <p className="text-xs text-zinc-500">Photos and the police or insurer report can be attached on the next page.</p>
    </form>
  );
}
