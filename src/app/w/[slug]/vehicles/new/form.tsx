"use client";
import { useActionState } from "react";
import { Card, Input, Notice, Select, Submit } from "@/components/form";
import type { FormState } from "../../actions-util";
import { createVehicleAction } from "../actions";

const CLASSES = ["car", "pickup", "van", "truck", "bus", "motorcycle", "forklift", "other"];
const FUELS = ["petrol", "diesel", "cng", "lpg", "hybrid", "electric"];
const DOCS: [string, string][] = [["registration", "Registration"], ["fitness", "Fitness"], ["token_tax", "Token tax"], ["route_permit", "Route permit"]];

export function AddVehicleForm({ slug, employees, serviceTypes }: {
  slug: string;
  employees: { id: string; full_name: string; employee_no: string | null }[];
  serviceTypes: { key: string; label: string }[];
}) {
  const [state, action] = useActionState<FormState, FormData>(createVehicleAction.bind(null, slug), {});
  const grid = "grid grid-cols-1 gap-3 sm:grid-cols-2";
  const f = (name: string, label: string, props: Record<string, string | boolean> = {}, hint?: string) => (
    <Input name={name} label={label} state={state} hint={hint} {...props} />
  );
  const select = (name: string, label: string, options: [string, string][], blank = "Choose") => (
    <Select name={name} label={label} state={state} options={options} blank={blank} />
  );
  return (
    <form action={action} className="space-y-4" noValidate>
      <Notice state={state} />
      <Card title="Vehicle">
        <div className={grid}>
          {f("registration_no", "Registration number", { required: true, autoComplete: "off" }, "Case, spaces and hyphens do not matter: BKL-245 and bkl 245 are the same plate.")}
          {f("make", "Make")}{f("model", "Model")}
          {f("year", "Year", { inputMode: "numeric" })}
          {select("vehicle_class", "Vehicle class", CLASSES.map((c) => [c, c[0].toUpperCase() + c.slice(1)]))}
          {select("fuel_type", "Fuel", FUELS.map((c) => [c, c.toUpperCase() === "CNG" || c === "lpg" ? c.toUpperCase() : c[0].toUpperCase() + c.slice(1)]))}
          {f("vin", "Chassis / VIN")}{f("engine_no", "Engine number")}
          {f("colour", "Colour")}{f("base_location", "Base location")}
        </div>
      </Card>
      <Card title="Odometer and custodian">
        <div className={grid}>
          {f("odometer_km", "Odometer now (km)", { inputMode: "decimal" })}
          <span />
          {select("employee_id", "Held by", employees.map((e) => [e.id, e.employee_no ? `${e.full_name} (${e.employee_no})` : e.full_name]), "No one yet")}
          {f("holding_since", "Holding since", { type: "date" })}
        </div>
      </Card>
      {serviceTypes.length > 0 && (
        <Card title="Last service done">
          <p className="mb-3 text-xs text-zinc-500">Starts the due-date clock. Leave empty if unknown; the vehicle shows “No service history”.</p>
          <div className="space-y-3">
            {serviceTypes.map((s) => (
              <div key={s.key} className={grid}>
                {f(`baseline_${s.key}_date`, `${s.label}: date`, { type: "date" })}
                {f(`baseline_${s.key}_km`, `${s.label}: odometer (km)`, { inputMode: "decimal" })}
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card title="Insurance (optional)">
        <div className={grid}>
          {f("insurance_insurer", "Insurer")}{f("insurance_policy_no", "Policy number")}
          {f("insurance_valid_from", "Valid from", { type: "date" })}{f("insurance_valid_to", "Valid to", { type: "date" })}
          {f("insurance_premium", "Premium", { inputMode: "decimal" })}
        </div>
      </Card>
      <Card title="Documents (optional)">
        <div className="space-y-3">
          {DOCS.map(([key, label]) => (
            <div key={key} className={grid}>
              {f(`doc_${key}_expires`, `${label}: expires`, { type: "date" })}
              {f(`doc_${key}_ref`, `${label}: reference`)}
            </div>
          ))}
        </div>
      </Card>
      <Card title="Budget (optional)">
        <div className={grid}>
          {f("budget_amount", "Maintenance budget", { inputMode: "decimal" })}<span />
          {f("budget_from", "From", { type: "date" })}{f("budget_to", "To", { type: "date" })}
        </div>
      </Card>
      <div className="flex gap-3">
        <Submit>Save vehicle</Submit>
        <a href={`/w/${slug}/vehicles`} className="flex h-10 items-center px-3 text-sm text-zinc-600 underline">Cancel</a>
      </div>
    </form>
  );
}
