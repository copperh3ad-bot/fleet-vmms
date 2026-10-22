"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { addVehicle, changeCustody, endCustody, updateVehicleStatus, previewVehicleImport, commitVehicleImport, type ImportPreview } from "@/lib/master/service";
import { runAction, str, typed, type FormState } from "../actions-util";

const DOC_TYPES = ["registration", "fitness", "token_tax", "route_permit"] as const;

/** Turns the Add a vehicle form into the shape onboard_vehicle expects. Validation itself lives in the schema. */
function vehicleFromForm(f: FormData) {
  const baselineKeys = [...f.keys()].map((k) => k.match(/^baseline_(.+)_date$/)?.[1]).filter((k): k is string => !!k && str(f, `baseline_${k}_date`) !== "");
  const docTypes = DOC_TYPES.filter((t) => str(f, `doc_${t}_expires`) !== "");
  const raw: Record<string, unknown> = {};
  for (const k of ["registration_no", "make", "model", "year", "vehicle_class", "fuel_type", "vin", "engine_no", "colour", "base_location", "odometer_km", "employee_id", "holding_since", "budget_amount", "budget_from", "budget_to"]) raw[k] = str(f, k);
  raw.baselines = baselineKeys.map((k) => ({ service_type_key: k, last_done_on: str(f, `baseline_${k}_date`), last_odometer_km: str(f, `baseline_${k}_km`) }));
  raw.documents = docTypes.map((t) => ({ doc_type: t, reference: str(f, `doc_${t}_ref`), expires_on: str(f, `doc_${t}_expires`) }));
  if (str(f, "insurance_insurer") !== "") {
    raw.insurance = { insurer: str(f, "insurance_insurer"), policy_no: str(f, "insurance_policy_no"), valid_from: str(f, "insurance_valid_from"), valid_to: str(f, "insurance_valid_to"), premium: str(f, "insurance_premium") };
  }
  return { raw, baselineKeys, docTypes };
}

/** Schema error paths ("insurance.valid_to", "baselines.0.last_done_on") back to the form's input names. */
function renameFields(fields: Record<string, string> | undefined, baselineKeys: string[], docTypes: readonly string[]) {
  if (!fields) return fields;
  const out: Record<string, string> = {};
  for (const [path, msg] of Object.entries(fields)) {
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^insurance\.(\w+)$/))) out[`insurance_${m[1]}`] = msg;
    else if ((m = path.match(/^baselines\.(\d+)\.last_done_on$/))) out[`baseline_${baselineKeys[+m[1]]}_date`] = msg;
    else if ((m = path.match(/^baselines\.(\d+)\.last_odometer_km$/))) out[`baseline_${baselineKeys[+m[1]]}_km`] = msg;
    else if ((m = path.match(/^documents\.(\d+)\.expires_on$/))) out[`doc_${docTypes[+m[1]]}_expires`] = msg;
    else out[path] = msg;
  }
  return out;
}

export async function createVehicleAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  const { raw, baselineKeys, docTypes } = vehicleFromForm(form);
  let id: string | undefined;
  const state = await runAction(slug, async (m) => { id = (await addVehicle(getDriver(), m, raw)).id; });
  if (id) redirect(`/w/${encodeURIComponent(slug)}/vehicles/${id}`);
  return { ...state, fields: renameFields(state.fields, baselineKeys, docTypes), values: typed(form) };
}

export async function changeCustodyAction(slug: string, vehicleId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await changeCustody(getDriver(), m, { vehicle_id: vehicleId, employee_id: str(form, "employee_id"), from: str(form, "from") });
    return "Custody changed. The previous holder stays in the history.";
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}

export async function endCustodyAction(slug: string, vehicleId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await endCustody(getDriver(), m, vehicleId, str(form, "on") || undefined);
    return "Vehicle returned. No current holder.";
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}

export async function setStatusAction(slug: string, vehicleId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await updateVehicleStatus(getDriver(), m, vehicleId, str(form, "status")); return "Status updated."; });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}

export type ImportState = FormState & { preview?: ImportPreview; text?: string; imported?: number };

async function readCsv(form: FormData): Promise<string> {
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 1_000_000) throw new Error("big");
    return file.text();
  }
  return str(form, "text");
}

/** Step 1: dry run. Step 2 ("commit" button) re-checks the same text and saves, all or nothing. */
export async function importVehiclesAction(slug: string, _prev: ImportState, form: FormData): Promise<ImportState> {
  const commit = str(form, "intent") === "commit";
  let text: string;
  // Import saves exactly the text that was checked, not whatever the file box holds now.
  try { text = commit ? str(form, "checked_text") : await readCsv(form); } catch { return { error: "The file is larger than 1 MB. Split it into smaller files." }; }
  let preview: ImportPreview | undefined, imported: number | undefined;
  const state = await runAction(slug, async (m) => {
    if (commit) { imported = (await commitVehicleImport(getDriver(), m, text)).imported; return `Imported ${imported} vehicle${imported === 1 ? "" : "s"}.`; }
    preview = await previewVehicleImport(getDriver(), m, text);
    return "";
  });
  return { ...state, ok: commit ? state.ok : undefined, preview, text: imported ? undefined : text, imported };
}
