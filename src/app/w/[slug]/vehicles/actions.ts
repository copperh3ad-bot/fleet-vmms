"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { addVehicleFile, removeVehicleFile, type VehicleFileKind } from "@/lib/master/files";
import { resolveChoice } from "@/lib/master/vehicle-catalog";
import { canonicalNames, recordNames } from "@/lib/master/vehicle-names";
import { csvToObjects } from "@/lib/master/csv";
import { UserError, addVehicle, changeCustody, endCustody, setVehicleDepartment, updateVehicleStatus, previewVehicleImport, commitVehicleImport, type ImportPreview } from "@/lib/master/service";
import { recordEngineHours, setTracksHours } from "@/lib/hours/service";
import { handOverPurchasedVehicle } from "@/lib/vehicle-requests/service";
import { runAction, str, typed, type FormState } from "../actions-util";
import { MAX_SHEET_BYTES, xlsxToCsv } from "@/lib/master/vehicle-sheet";

const DOC_TYPES = ["registration", "fitness", "token_tax", "route_permit"] as const;

/** Turns the Add a vehicle form into the shape onboard_vehicle expects. Validation itself lives in the schema. */
function vehicleFromForm(f: FormData) {
  const baselineKeys = [...f.keys()].map((k) => k.match(/^baseline_(.+)_date$/)?.[1]).filter((k): k is string => !!k && str(f, `baseline_${k}_date`) !== "");
  const docTypes = DOC_TYPES.filter((t) => str(f, `doc_${t}_expires`) !== "");
  const raw: Record<string, unknown> = {};
  for (const k of ["registration_no", "make", "model", "year", "vehicle_class", "fuel_type", "vin", "engine_no", "colour", "base_location", "seats", "load_capacity_kg", "department", "odometer_km", "employee_id", "holding_since", "budget_amount", "budget_from", "budget_to"]) raw[k] = str(f, k);
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

/** The make and model come from a drop-down, or are typed when "Other" is chosen (ADR-052). This is the form as the rest of the action reads it: the name to save in `make` and `model`. */
function resolved(form: FormData): FormData {
  const out = new FormData();
  for (const [k, v] of form.entries()) if (k !== "make_other" && k !== "model_other") out.append(k, v);
  for (const k of ["make", "model"] as const) out.set(k, resolveChoice(str(form, k), str(form, `${k}_other`)));
  return out;
}

export async function createVehicleAction(slug: string, _prev: FormState, original: FormData): Promise<FormState> {
  const form = resolved(original);
  // A name that matches the list, an approved name or a merged one is saved in its settled spelling (ADR-071); anything else is kept as typed.
  if (str(form, "make").trim()) { const c = await canonicalNames(getDriver(), str(form, "make").trim(), str(form, "model").trim()); form.set("make", c.make); form.set("model", c.model); }
  const { raw, baselineKeys, docTypes } = vehicleFromForm(form);
  const missing = Object.fromEntries(NEEDED.filter(([k]) => str(form, k).trim() === "").map(([k, msg]) => [k, msg]));
  if (Object.keys(missing).length) return { error: "Fill in the fields marked with a star.", fields: missing, values: typed(original) };
  let id: string | undefined;
  const notes: string[] = [];
  const state = await runAction(slug, async (m) => {
    const driver = getDriver();
    // E5 (ADR-091): a vehicle bought for an approved purchase is handed over in the same save, so the holder comes from the request, not from this form
    const purchase = str(form, "purchase_request");
    if (purchase) raw.employee_id = undefined;
    id = (await addVehicle(driver, m, raw, purchase ? { afterCreate: (q, vid, plate) => handOverPurchasedVehicle(q, m, purchase, vid, plate) } : {})).id;
    await recordNames(driver, m.tenantId, str(form, "make"), str(form, "model"));          // a name the list lacks goes to review; the vehicle is already saved (ADR-071)
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
  return { ...state, fields: renameFields(state.fields, baselineKeys, docTypes), values: typed(original) };
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

export async function setDepartmentAction(slug: string, vehicleId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await setVehicleDepartment(getDriver(), m, vehicleId, str(form, "department")); return "Department saved."; });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}

export async function setTracksHoursAction(slug: string, vehicleId: string, on: boolean): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await setTracksHours(getDriver(), m, vehicleId, on); return on ? "Hour tracking is on." : "Hour tracking is off."; });
  if (state.ok) refresh();
  return state;
}

export async function recordHoursAction(slug: string, vehicleId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await recordEngineHours(getDriver(), m, vehicleId, str(form, "hours")); return "Hour meter saved."; });
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
    // The filled-in vehicle sheet (.xlsx, ADR-038) is read straight from Excel; a CSV file is read as text.
    if (/\.xlsx$/i.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      if (file.size > MAX_SHEET_BYTES) throw new Error("big");
      return xlsxToCsv(new Uint8Array(await file.arrayBuffer()));
    }
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
  try { text = commit ? str(form, "checked_text") : await readCsv(form); } catch (e) { return { error: e instanceof Error && e.message !== "big" ? e.message : "The file is too large. Split it into smaller files." }; }
  let preview: ImportPreview | undefined, imported: number | undefined;
  const state = await runAction(slug, async (m) => {
    if (commit) {
      imported = (await commitVehicleImport(getDriver(), m, text)).imported;
      // names the list lacks go to review, once each; the vehicles are already saved (ADR-071)
      const pairs = new Map<string, [string, string]>();
      for (const r of csvToObjects(text).rows) { const mk = (r.values.make ?? "").trim(), md = (r.values.model ?? "").trim(); if (mk) pairs.set(mk.toLowerCase() + "|" + md.toLowerCase(), [mk, md]); }
      for (const [mk, md] of [...pairs.values()].slice(0, 200)) await recordNames(getDriver(), m.tenantId, mk, md);
      return `Imported ${imported} vehicle${imported === 1 ? "" : "s"}.`; }
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
