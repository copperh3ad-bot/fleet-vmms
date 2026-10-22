"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { addVehicleFile, removeVehicleFile, type VehicleFileKind } from "@/lib/master/files";
import { UserError, addVehicle, changeCustody, endCustody, updateVehicleStatus, previewVehicleImport, commitVehicleImport, type ImportPreview } from "@/lib/master/service";
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
  // The board asks only for the insurance expiry. A policy needs an insurer and a start, so when they are not given the
  // insurer is recorded as "Not recorded yet" and the start as one year before the expiry; both can be corrected later.
  const to = str(f, "insurance_valid_to");
  if (to !== "" || str(f, "insurance_insurer") !== "") {
    const yearBefore = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${Number(to.slice(0, 4)) - 1}${to.slice(4)}` : "";
    raw.insurance = {
      insurer: str(f, "insurance_insurer") || "Not recorded yet", policy_no: str(f, "insurance_policy_no"),
      valid_from: str(f, "insurance_valid_from") || yearBefore, valid_to: to, premium: str(f, "insurance_premium"),
    };
  }
  // A budget amount without dates covers the current calendar year.
  if (str(f, "budget_amount") !== "" && (str(f, "budget_from") === "" || str(f, "budget_to") === "")) {
    const y = new Date().getFullYear();
    raw.budget_from = str(f, "budget_from") || `${y}-01-01`; raw.budget_to = str(f, "budget_to") || `${y}-12-31`;
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

/** What the "Add a vehicle" board marks as needed. The service itself only needs the plate, so imports stay light. */
const NEEDED: [string, string][] = [["make", "Enter the make"], ["model", "Enter the model"], ["year", "Enter the year"], ["fuel_type", "Choose the fuel"], ["odometer_km", "Enter the odometer reading"]];

export async function createVehicleAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  const { raw, baselineKeys, docTypes } = vehicleFromForm(form);
  const missing = Object.fromEntries(NEEDED.filter(([k]) => str(form, k).trim() === "").map(([k, msg]) => [k, msg]));
  if (Object.keys(missing).length) return { error: "Fill in the fields marked with a star.", fields: missing, values: typed(form) };
  let id: string | undefined;
  const notes: string[] = [];
  const state = await runAction(slug, async (m) => {
    const driver = getDriver();
    id = (await addVehicle(driver, m, raw)).id;
    // The vehicle is saved first; a file that cannot be stored never undoes it.
    for (const [field, kind, label] of [["photo", "photo", "Photo"], ["registration_scan", "registration", "Registration scan"]] as const) {
      const file = form.get(field);
      if (!(file instanceof File) || file.size === 0) continue;
      try { await addVehicleFile(driver, await supabaseBlobStore(), m, id, kind, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }); }
      catch (e) { if (e instanceof UserError) notes.push(`${label} not attached: ${e.message}`); else throw e; }
    }
  });
  if (id) {
    const another = str(form, "intent") === "another";
    const note = notes.length ? `&note=${encodeURIComponent(notes.join(" "))}` : "";
    redirect(another ? `/w/${encodeURIComponent(slug)}/vehicles/new?added=${encodeURIComponent(str(form, "registration_no").trim().toUpperCase())}${note}` : `/w/${encodeURIComponent(slug)}/vehicles/${id}`);
  }
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

export async function uploadVehicleFileAction(slug: string, vehicleId: string, kind: VehicleFileKind, _prev: FormState, form: FormData): Promise<FormState> {
  const file = form.get("file");
  const state = await runAction(slug, async (m) => {
    if (!(file instanceof File) || file.size === 0) throw new UserError("Choose a file first.");
    await addVehicleFile(getDriver(), await supabaseBlobStore(), m, vehicleId, kind, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return "File added.";
  });
  if (state.ok) refresh();
  return state;
}

export async function removeVehicleFileAction(slug: string, attachmentId: string): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await removeVehicleFile(getDriver(), await supabaseBlobStore(), m, attachmentId); return "File removed."; });
  if (state.ok) refresh();
  return state;
}
