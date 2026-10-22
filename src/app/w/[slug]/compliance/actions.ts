"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { UserError } from "@/lib/master/service";
import { addAccident, addChallan, addComplianceFile, addDocument, removeComplianceFile, setChallanStatus } from "@/lib/compliance/service";
import { runAction, str, typed, type FormState } from "../actions-util";

const keep = (state: FormState, form: FormData): FormState => ({ ...state, values: typed(form) });
const pick = (form: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, str(form, k)]));

export async function addDocumentAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  let to = "";
  const state = await runAction(slug, async (m) => {
    const r = await addDocument(getDriver(), m, pick(form, ["vehicle_id", "doc_type", "reference", "issued_by", "valid_from", "expires_on", "amount"]));
    to = `/w/${slug}/compliance/${r.entity_type}/${r.id}`;
    return "Document saved.";
  });
  if (state.ok && to) { refresh(); redirect(to); }
  return keep(state, form);
}

export async function addAccidentAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  let to = "";
  const state = await runAction(slug, async (m) => {
    const id = await addAccident(getDriver(), m, pick(form, ["vehicle_id", "employee_id", "occurred_at", "location", "description", "severity", "fault", "insurance_claim", "claim_ref", "job_card_id"]));
    to = `/w/${slug}/accidents/${id}`;
    return "Accident recorded.";
  });
  if (state.ok && to) { refresh(); redirect(to); }
  return keep(state, form);
}

export async function addChallanAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await addChallan(getDriver(), m, pick(form, ["vehicle_id", "employee_id", "issued_on", "reference", "violation", "amount"]));
    return "Challan added.";
  });
  if (state.ok) { refresh(); return state; }
  return keep(state, form);
}

export async function challanStatusAction(slug: string, id: string, status: "open" | "paid" | "disputed"): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await setChallanStatus(getDriver(), m, id, status); return "Updated."; });
  if (state.ok) refresh();
  return state;
}

export async function uploadFilesAction(slug: string, entityType: string, entityId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const state = await runAction(slug, async (m) => {
    if (files.length === 0) throw new UserError("Choose a file first.");
    const store = await supabaseBlobStore();
    for (const f of files) await addComplianceFile(getDriver(), store, m, entityType, entityId, { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    return files.length === 1 ? "File added." : `${files.length} files added.`;
  });
  if (state.ok) refresh();
  return state;
}

export async function removeFileAction(slug: string, attachmentId: string): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await removeComplianceFile(getDriver(), await supabaseBlobStore(), m, attachmentId); return "File removed."; });
  if (state.ok) refresh();
  return state;
}
