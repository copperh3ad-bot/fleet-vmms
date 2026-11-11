"use client";
import { useActionState, useState } from "react";
import { keepForm } from "@/components/keep-form";
import { Field, Input, Notice, Select, inputCls } from "@/components/form";
import { FileInput } from "@/components/file-input";
import { Panel, Pill, btn, btnPrimary, type Tone } from "@/components/ui";
import type { FormState } from "../../actions-util";
import { createVehicleAction } from "../actions";
import { MakeModelYear } from "./make-model-year";
import { OTHER, type CatalogExtras } from "@/lib/master/vehicle-catalog";

const CLASSES = ["car", "pickup", "van", "truck", "bus", "motorcycle", "forklift", "other"];
const FUELS = ["petrol", "diesel", "cng", "lpg", "hybrid", "electric"];
const fuelLabel = (c: string) => (c === "cng" || c === "lpg" ? c.toUpperCase() : c[0].toUpperCase() + c.slice(1));
const drop = "block w-full rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm";

type Employee = { id: string; full_name: string; employee_no: string | null; department: string | null };
type Check = { label: string; tone: Tone; word: string; note?: string };

function Buttons({ pending }: { pending: boolean }) {
  return (
    <div className="flex flex-wrap gap-3">
      <button type="submit" name="intent" value="another" disabled={pending} className={`${btn} disabled:opacity-60`}>Save and add another</button>
      <button type="submit" name="intent" value="save" disabled={pending} className={`${btnPrimary} disabled:opacity-60`}>{pending ? "Saving" : "Save vehicle"}</button>
    </div>
  );
}

/** What is filled in so far, as the "Ready to save?" panel shows it. Nothing here blocks saving except the starred fields. */
function checklist(v: Record<string, string>, serviceTypes: { key: string; label: string }[]): Check[] {
  const has = (k: string) => (v[k] ?? "").trim() !== "";
  const list = (xs: string[]) => xs.join(", ");
  // a make or model chosen as "Other" counts once the name is typed
  const named = (k: string) => has(k) && (v[k] !== OTHER || has(`${k}_other`));
  const missingIdentity = [["registration_no", "plate"], ["make", "make"], ["model", "model"], ["year", "year"], ["fuel_type", "fuel"]].filter(([k]) => !(k === "make" || k === "model" ? named(k) : has(k))).map(([, l]) => l);
  const dated = serviceTypes.filter((s) => has(`baseline_${s.key}_date`));
  const noKm = dated.filter((s) => !has(`baseline_${s.key}_km`)).map((s) => `${s.label.toLowerCase()} km`);
  const base: string[] = [...(has("odometer_km") ? [] : ["odometer"]), ...(dated.length ? noKm : ["no service history yet"])];
  const docs = [["insurance_valid_to", "Insurance date"], ["doc_fitness_expires", "Fitness date"], ["doc_token_tax_expires", "Token tax date"]].filter(([k]) => !has(k)).map(([, l]) => l);
  return [
    { label: "Identity", tone: missingIdentity.length ? "warn" : "ok", word: missingIdentity.length ? "Partly" : "Done", note: missingIdentity.length ? `missing ${list(missingIdentity)}` : undefined },
    { label: "Holder", tone: has("employee_id") ? "ok" : "warn", word: has("employee_id") ? "Done" : "Partly", note: has("employee_id") ? undefined : "no holder yet" },
    { label: "Servicing baseline", tone: base.length ? "warn" : "ok", word: base.length ? "Partly" : "Done", note: base.length ? `missing ${list(base)}`.replace("missing no service history yet", "no service history yet") : undefined },
    { label: "Documents", tone: docs.length ? "warn" : "ok", word: docs.length ? "Partly" : "Done", note: docs.length ? `${list(docs)} missing` : undefined },
  ];
}

export function AddVehicleForm({ slug, employees, departments = [], serviceTypes, year, currency = "PKR", extras }: { extras?: CatalogExtras; slug: string; employees: Employee[]; departments?: string[]; serviceTypes: { key: string; label: string }[]; year: number; currency?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createVehicleAction.bind(null, slug), {});
  const [snap, setSnap] = useState<Record<string, string>>({});
  const holder = employees.find((e) => e.id === snap.employee_id);
  const f = (name: string, label: string, props: Record<string, string | boolean> = {}, hint?: string) => <Input name={name} label={label} state={state} hint={hint} {...props} />;
  const three = "grid grid-cols-1 gap-3 sm:grid-cols-3";
  const checks = checklist(snap, serviceTypes);
  return (
    <form onSubmit={keepForm(action)} noValidate
      onInput={(e) => setSnap(Object.fromEntries([...new FormData(e.currentTarget)].filter((x): x is [string, string] => typeof x[1] === "string")))}>
      <Notice state={state} />
      <div className="mt-3 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <Panel title="Identity">
            <div className={three}>
              {f("registration_no", "Registration number *", { autoComplete: "off" })}
              <MakeModelYear state={state} thisYear={year} extras={extras} />
              <Select name="fuel_type" label="Fuel *" state={state} blank="Choose" options={FUELS.map((c) => [c, fuelLabel(c)])} />
              {f("vin", "Chassis number")}
              {f("engine_no", "Engine number")}
              {f("colour", "Colour")}
              <Select name="vehicle_class" label="Vehicle class" state={state} options={CLASSES.map((c) => [c, c[0].toUpperCase() + c.slice(1)])} />
            </div>
            <p className="mt-2 text-xs text-zinc-500">Case, spaces and hyphens in the plate do not matter: BKL-245 and bkl 245 are the same plate.</p>
          </Panel>

          <Panel title="Who has it">
            <div className={three}>
              <Select name="employee_id" label="Driver or custodian" state={state} blank="No one yet" options={employees.map((e) => [e.id, e.employee_no ? `${e.full_name} (${e.employee_no})` : e.full_name])} />
              <Field label="Holder's department" name="holder_department">
                <p className={`${inputCls} flex items-center bg-zinc-50 text-zinc-600`}>{holder ? holder.department ?? "Not set" : "From the person you choose"}</p>
              </Field>
              {f("base_location", "Base location")}
              {f("seats", "Seats", { inputMode: "numeric" })}
              {f("load_capacity_kg", "Load capacity (kg)", { inputMode: "decimal" })}
            </div>
            <div className={`${three} mt-3`}>
              <Input name="department" label="Operating department" state={state} list="departments" hint="Which department runs this vehicle, for example Logistics or Operations. Empty is the general fleet." />
              <datalist id="departments">{departments.map((d) => <option key={d} value={d} />)}</datalist>
            </div>
            <div className="mt-3">{f("holding_since", "Holding since", { type: "date" }, "Past holders stay on the record, and costs go to whoever held the vehicle at the time.")}</div>
          </Panel>

          <Panel title="Starting point for servicing">
            <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Without this, the system shows the vehicle as having no history and cannot say when the next service is due.</p>
            <div className="space-y-3">
              {f("odometer_km", "Odometer now (km) *", { inputMode: "decimal" })}
              {serviceTypes.map((s) => (
                <div key={s.key} className={three}>
                  {f(`baseline_${s.key}_date`, `Last ${s.label.toLowerCase()} date`, { type: "date" })}
                  {f(`baseline_${s.key}_km`, `Last ${s.label.toLowerCase()} (km)`, { inputMode: "decimal" })}
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Documents and budget">
            <div className={three}>
              {f("insurance_valid_to", "Insurance expires", { type: "date" })}
              {f("doc_fitness_expires", "Fitness expires", { type: "date" })}
              {f("doc_token_tax_expires", "Token tax paid until", { type: "date" })}
            </div>
            <div className="mt-3">{f("budget_amount", `Budget for ${year} (${currency})`, { inputMode: "decimal" }, "Covers the whole calendar year. Set other periods on the Budgets screen.")}</div>
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-medium text-zinc-700">More insurance and document details</summary>
              <div className={`${three} mt-3`}>
                {f("insurance_insurer", "Insurer")}{f("insurance_policy_no", "Policy number")}{f("insurance_valid_from", "Valid from", { type: "date" })}
                {f("insurance_premium", "Premium", { inputMode: "decimal" })}
              </div>
              <p className="mt-1 text-xs text-zinc-500">If you leave the insurer, policy number and start date empty, the insurer and policy number are recorded as “Not recorded yet” and the start as one year before the expiry. Correct them later on the vehicle.</p>
              <div className={`${three} mt-3`}>
                {f("doc_registration_expires", "Registration expires", { type: "date" })}{f("doc_registration_ref", "Registration reference")}<span />
                {f("doc_route_permit_expires", "Route permit expires", { type: "date" })}{f("doc_route_permit_ref", "Route permit reference")}<span />
              </div>
            </details>
          </Panel>
        </div>

        <div className="space-y-5 xl:sticky xl:top-5 xl:self-start">
          <Panel title="Photo and papers">
            <div className="space-y-3">
              <div><label htmlFor="photo" className="mb-1 block text-xs font-medium text-zinc-600">Add a photo of the vehicle</label><FileInput id="photo" name="photo" multiple={false} accept="image/*" className={drop} /></div>
              <div><label htmlFor="registration_scan" className="mb-1 block text-xs font-medium text-zinc-600">Add registration book scan</label><FileInput id="registration_scan" name="registration_scan" multiple={false} className={drop} /></div>
            </div>
          </Panel>
          <Panel title="Ready to save?">
            <ul className="space-y-2 text-sm">
              {checks.map((c) => (
                <li key={c.label} className="flex flex-wrap items-center gap-2"><Pill tone={c.tone}>{c.word}</Pill><span>{c.label}{c.note ? `, ${c.note}` : ""}</span></li>
              ))}
            </ul>
            <div className="mt-4"><Buttons pending={pending} /></div>
            <a href={`/w/${slug}/vehicles`} className="mt-3 inline-block text-sm text-zinc-600 underline">Cancel</a>
          </Panel>
        </div>
      </div>
    </form>
  );
}
