"use client";
import { useState } from "react";
import { Field, inputCls } from "@/components/form";
import { OTHER, mergeCatalog, yearChoices, type CatalogExtras } from "@/lib/master/vehicle-catalog";
import type { FormState } from "../../actions-util";

/**
 * Make, model and year as drop-downs (ADR-052). The make decides which models are offered. "Other" opens a text box, so a vehicle that is not on the list can still be
 * entered. The form sends the choice (`make`, `model`) and the typed name (`make_other`, `model_other`); the action turns them into the name that is saved.
 */
export function MakeModelYear({ state, thisYear, extras }: { state: FormState; thisYear: number; extras?: CatalogExtras }) {
  const catalog = mergeCatalog(extras);
  const v = state.values ?? {};
  // What the form held when it was first shown (after an error, what was sent back). The two drop-downs below are NOT controlled by React: the browser keeps the pick, and
  // React only listens to it to decide which models to offer. A drop-down React controls was undone by the form's own re-render on every input (typing Su into Make left it on Choose).
  const [start] = useState({ make: v.make ?? "", model: v.model ?? "" });
  const [make, setMake] = useState(start.make);
  const [model, setModel] = useState(start.model);
  const models = catalog.modelsOf(make);
  const makeOther = make === OTHER, modelOther = model === OTHER || (make !== "" && models.length === 0);
  const pick = (name: string, initial: string, set: (x: string) => void, options: string[], blank: string) => (
    <select key={name === "model" ? `model-for-${make}` : name} id={name} name={name} defaultValue={initial} onChange={(e) => set(e.target.value)} className={inputCls} aria-invalid={!!state.fields?.[name]}>
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
        {pick("make", start.make, (x) => { setMake(x); setModel(""); }, catalog.makes, "Choose")}
        {makeOther && typed("make_other", "Type the make")}
        <p className="mt-1 text-xs text-zinc-500">Not on the list, such as a grey import, a rebuilt or locally modified vehicle? Choose Other and type it. It is saved now, and we add it for everyone once checked.</p>
      </Field>
      <Field label="Model *" name="model" state={state} required>
        {make === "" ? (
          <select id="model" name="model" disabled className={inputCls}><option>Choose the make first</option></select>
        ) : models.length === 0 ? (
          <><input type="hidden" name="model" value={OTHER} />{typed("model_other", "Type the model")}</>
        ) : (
          <>{pick("model", make === start.make ? start.model : "", setModel, models, "Choose")}{modelOther && typed("model_other", "Type the model")}</>
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
