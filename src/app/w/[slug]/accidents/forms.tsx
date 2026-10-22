"use client";
import { useActionState, useState } from "react";
import { Field, Input, Notice, Select, Submit, inputCls } from "@/components/form";
import { FileInput } from "@/components/file-input";
import type { FormState } from "../actions-util";
import { addAccidentAction, driverHintAction } from "../compliance/actions";

export function AccidentPanelForm({ slug, vehicles, initial, canRaiseJob }: { slug: string; vehicles: [string, string][]; initial: Record<string, string>; canRaiseJob: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(addAccidentAction.bind(null, slug), {});
  // after a save the boxes are cleared; after an error they keep what was typed
  const s: FormState = state.ok ? { ...state, values: {} } : state.values ? state : { ...state, values: initial };
  const [vehicle, setVehicle] = useState(initial.vehicle_id ?? "");
  const [when, setWhen] = useState("");
  const [claim, setClaim] = useState(false);
  const [hint, setHint] = useState<string | null | undefined>(undefined);
  // Looks up the driver when either the vehicle or the time changes (in the event handler, not an effect).
  function lookup(v: string, w: string) {
    if (!v || !w || Number.isNaN(Date.parse(w))) { setHint(undefined); return; }
    driverHintAction(slug, v, new Date(w).toISOString()).then(setHint, () => setHint(null));
  }
  return (
    <form action={action} className="space-y-3" noValidate key={state.ok ?? "form"}>
      <Field label="Vehicle" name="vehicle_id" state={s} required>
        <select id="vehicle_id" name="vehicle_id" value={vehicle} onChange={(e) => { setVehicle(e.target.value); lookup(e.target.value, when); }} className={inputCls} aria-invalid={!!s.fields?.vehicle_id}>
          <option value="">Choose a vehicle</option>{vehicles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      {hint !== undefined && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {hint ? <>Driver on that date: {hint} (from custody record)</> : <>No driver on record for that date. The accident will be saved without one.</>}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date and time" name="occurred_at" state={s} required>
          <input id="occurred_at" name="occurred_at" type="datetime-local" value={when} onChange={(e) => { setWhen(e.target.value); lookup(vehicle, e.target.value); }} className={inputCls} aria-invalid={!!s.fields?.occurred_at} />
        </Field>
        <Select name="severity" label="Severity" state={s} blank="Choose" required options={[["minor", "Minor"], ["moderate", "Moderate"], ["major", "Major"], ["total_loss", "Total loss"]]} />
      </div>
      <Input name="location" label="Location" state={s} />
      <Field label="What happened" name="description" state={s} required hint="At least 10 characters.">
        <textarea id="description" name="description" rows={3} defaultValue={s.values?.description ?? ""} aria-invalid={!!s.fields?.description} className={`${inputCls} h-auto py-2`} />
      </Field>
      <Select name="fault" label="Who was at fault" state={s} blank="Not known yet" options={[["third_party", "Third party"], ["our_driver", "Our driver"], ["shared", "Shared"], ["unknown", "Unknown"]]} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="insurance_claim" checked={claim} onChange={(e) => setClaim(e.target.checked)} /> Raise an insurance claim</label>
      {claim && <Input name="claim_ref" label="Claim reference (if you have one)" state={s} />}
      {canRaiseJob && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="create_job_card" /> Create a repair job card from this</label>}
      <input type="hidden" name="job_card_id" value={initial.job_card_id ?? ""} />
      <div>
        <label htmlFor="files" className="mb-1 block text-xs font-medium text-zinc-600">Photos, police report, other party details</label>
        <FileInput className="block w-full rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm" />
      </div>
      <div className="flex flex-wrap items-center gap-3"><Submit>Save accident</Submit><Notice state={state} /></div>
    </form>
  );
}
