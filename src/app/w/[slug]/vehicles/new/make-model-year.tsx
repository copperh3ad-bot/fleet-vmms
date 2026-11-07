"use client";
import { useState } from "react";
import { Field, inputCls } from "@/components/form";
import { MAKES, OTHER, modelsOf, yearChoices } from "@/lib/master/vehicle-catalog";
import type { FormState } from "../../actions-util";

/**
 * Make, model and year as drop-downs (ADR-052). The make decides which models are offered. "Other" opens a text box, so a vehicle that is not on the list can still be
 * entered. The form sends the choice (`make`, `model`) and the typed name (`make_other`, `model_other`); the action turns them into the name that is saved.
 */
export function MakeModelYear({ state, thisYear }: { state: FormState; thisYear: number }) {
  const v = state.values ?? {};
  const [make, setMake] = useState(v.make ?? "");
  const [model, setModel] = useState(v.model ?? "");
  const models = modelsOf(make);
  const makeOther = make === OTHER, modelOther = model === OTHER || (make !== "" && models.length === 0);
  const pick = (name: string, value: string, set: (x: string) => void, options: string[], blank: string) => (
    <select id={name} name={name} value={value} onChange={(e) => set(e.target.value)} className={inputCls} aria-invalid={!!state.fields?.[name]}>
      <option value="">{blank}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
      <option value={OTHER}>Other (type it)</option>
    </select>
  );
  const typed = (name: string, label: string) => (
    <input name={name} aria-label={label} placeholder={label} defaultValue={v[name] ?? ""} autoComplete="off" maxLength={60} className={`${inputCls} mt-2`} aria-invalid={!!state.fields?.[name.replace("_other", "")]} />
  );
  return (
    <>
      <Field label="Make *" name="make" state={state} required>
        {pick("make", make, (x) => { setMake(x); setModel(""); }, MAKES, "Choose")}
        {makeOther && typed("make_other", "Type the make")}
      </Field>
      <Field label="Model *" name="model" state={state} required>
        {make === "" ? (
          <select id="model" name="model" disabled className={inputCls}><option>Choose the make first</option></select>
        ) : models.length === 0 ? (
          <><input type="hidden" name="model" value={OTHER} />{typed("model_other", "Type the model")}</>
        ) : (
          <>{pick("model", model, setModel, models, "Choose")}{modelOther && typed("model_other", "Type the model")}</>
        )}
      </Field>
      <Field label="Year *" name="year" state={state} required>
        <select id="year" name="year" defaultValue={v.year ?? ""} className={inputCls} aria-invalid={!!state.fields?.year}>
          <option value="">Choose</option>
          {yearChoices(thisYear).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </Field>
    </>
  );
}
