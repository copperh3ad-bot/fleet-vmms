"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { UserError } from "@/lib/master/service";
import { addAccident, addChallan, addComplianceFile, addDocument, driverOnDate, linkAccidentJobCard, removeComplianceFile, setChallanStatus } from "@/lib/compliance/service";
import { createJobCard, listReasonCodes } from "@/lib/jobcards/service";
import { ForbiddenError } from "@/lib/auth/can";
import { requireMembership } from "@/lib/auth/session";
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
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const wantsJob = form.get("create_job_card") === "on";
  const notes: string[] = [];
  const state = await runAction(slug, async (m) => {
    const driver = getDriver();
    const id = await addAccident(driver, m, pick(form, ["vehicle_id", "employee_id", "occurred_at", "location", "description", "severity", "fault", "insurance_claim", "claim_ref", "job_card_id"]));
    // The accident is saved first; the extras below never undo it, they only say what did not work.
    if (wantsJob) {
      try {
        const reason = (await listReasonCodes(driver, m)).find((r) => r.code === "ACC_COLLISION");
        if (!reason) throw new UserError("The collision reason is missing.");
        const card = await createJobCard(driver, m, { vehicle_id: str(form, "vehicle_id"), category: "accident", reason_code_id: reason.id, cause_text: str(form, "description"), priority: "normal", lines: [] }, false);
        await linkAccidentJobCard(driver, m, id, card.id);
        notes.push(`Repair job card ${card.job_no} started as a draft.`);
      } catch (e) {
        if (e instanceof UserError || e instanceof ForbiddenError) notes.push("The repair job card was not created: " + (e instanceof UserError ? e.message : "you may not raise job cards."));
        else throw e;
      }
    }
    if (files.length) {
      try {
        const store = await supabaseBlobStore();
        for (const f of files) await addComplianceFile(driver, store, m, "accident", id, { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
        notes.push(files.length === 1 ? "File attached." : `${files.length} files attached.`);
      } catch (e) {
        if (e instanceof UserError) notes.push("A file was not attached: " + e.message); else throw e;
      }
    }
    return ["Accident saved.", ...notes].join(" ");
  });
  if (state.ok) { refresh(); return state; }
  return keep(state, form);
}

export async function driverHintAction(slug: string, vehicleId: string, at: string): Promise<string | null> {
  const m = await requireMembership(slug);
  return driverOnDate(getDriver(), m, vehicleId, at).catch(() => null);
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
