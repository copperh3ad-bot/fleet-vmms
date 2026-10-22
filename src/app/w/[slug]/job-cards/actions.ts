"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { createJobCard, editJobCard, transitionJobCard, markNotificationsRead, getJobContext, approveAndAssign, type JobContext } from "@/lib/jobcards/service";
import { requireMembership } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/can";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { addJobCardAttachment, removeJobCardAttachment } from "@/lib/jobcards/attachments";
import { UserError } from "@/lib/master/service";
import { decideQuotation } from "@/lib/vendorflow/service";
import { runAction, str, typed, type FormState } from "../actions-util";

/** The form posts line fields as parallel lists (line_kind, line_description, ...). Fully blank rows are dropped. */
function cardFromForm(f: FormData) {
  const get = (k: string) => f.getAll(k).map(String);
  const [kind, description, qty, unit, tag] = [get("line_kind"), get("line_description"), get("line_qty"), get("line_unit_cost"), get("line_service")];
  const lines = description
    .map((d, i) => ({ kind: kind[i], description: d, qty: qty[i], unit_cost: unit[i], service_type_key: tag[i] }))
    .filter((l) => l.description.trim() !== "" || (l.unit_cost ?? "").trim() !== "");
  const raw: Record<string, unknown> = { lines };
  for (const k of ["vehicle_id", "requested_by", "category", "reason_code_id", "cause_text", "description", "priority", "needed_by", "odometer_km"]) raw[k] = str(f, k);
  return raw;
}

/** id is "" for a new card. intent is "draft" or "submit". Photos chosen on the form are attached to a new card. */
export async function saveJobCardAction(slug: string, id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const submit = str(form, "intent") === "submit";
  const files = id ? [] : form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const notes: string[] = [];
  let target = id;
  const state = await runAction(slug, async (m) => {
    const driver = getDriver();
    if (id) { await editJobCard(driver, m, id, cardFromForm(form), submit); return submit ? "Submitted for approval." : "Draft saved."; }
    if (files.length === 0) { target = (await createJobCard(driver, m, cardFromForm(form), submit)).id; return submit ? "Submitted for approval." : "Draft saved."; }
    // With photos the card is saved as a draft first (files can only be added to a draft), then submitted.
    target = (await createJobCard(driver, m, cardFromForm(form), false)).id;
    try {
      const store = await supabaseBlobStore();
      for (const f of files) await addJobCardAttachment(driver, store, m, target, { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    } catch (e) { if (e instanceof UserError) notes.push(`A photo was not attached: ${e.message}`); else throw e; }
    if (!submit) return "Draft saved.";
    try { await transitionJobCard(driver, m, target, "submitted"); return "Submitted for approval."; }
    catch (e) { if (e instanceof UserError) { notes.push(`Saved as a draft, not submitted: ${e.message}`); return "Draft saved."; } throw e; }
  });
  if (state.ok && target) { refresh(); redirect(`/w/${slug}/job-cards/${target}${notes.length ? `?note=${encodeURIComponent(notes.join(" "))}` : ""}`); }
  return { ...state, values: typed(form) };
}

export async function transitionAction(slug: string, id: string, to: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await transitionJobCard(getDriver(), m, id, to, {
      comment: str(form, "comment") || undefined, reasonCodeId: str(form, "reason_code_id") || undefined, vendorId: str(form, "vendor_id") || undefined,
    });
    return { approved: "Approved.", rejected: "Rejected.", returned_for_edit: "Sent back for edit.", submitted: "Submitted for approval.", cancelled: "Cancelled.", vendor_assigned: "Vendor assigned.", closed: "Closed." }[to] ?? "Done.";
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}

/** Several files can be chosen at once; each is checked and stored on its own, and the first problem is reported. */
export async function uploadAttachmentsAction(slug: string, id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const state = await runAction(slug, async (m) => {
    if (files.length === 0) throw new UserError("Choose a file first.");
    const store = await supabaseBlobStore();
    for (const f of files) await addJobCardAttachment(getDriver(), store, m, id, { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    return files.length === 1 ? "File added." : `${files.length} files added.`;
  });
  if (state.ok) refresh();
  return state;
}

export async function removeAttachmentAction(slug: string, attachmentId: string): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await removeJobCardAttachment(getDriver(), await supabaseBlobStore(), m, attachmentId);
    return "File removed.";
  });
  if (state.ok) refresh();
  return state;
}

export async function decideQuotationAction(slug: string, quotationId: string, decision: "approve" | "reject", _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await decideQuotation(getDriver(), m, quotationId, decision, str(form, "comment") || undefined);
    return decision === "approve" ? "Quotation approved. Work order issued." : "Quotation rejected. The vendor can send a new one.";
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}

export async function markReadAction(slug: string): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await markNotificationsRead(getDriver(), m); return "All read."; });
  if (state.ok) refresh();
  return state;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Called by the form when the vehicle changes. Read-only; checks the same visibility as raising the card. */
export async function jobContextAction(slug: string, vehicleId: string): Promise<JobContext | null> {
  if (!UUID.test(vehicleId)) return null;
  const m = await requireMembership(slug);
  try { return await getJobContext(getDriver(), m, vehicleId); }
  catch (e) { if (e instanceof ForbiddenError) return null; throw e; }
}

/**
 * The review screen's single decision form. intent is "approve" (approves and assigns the chosen workshop in one step),
 * "return" or "reject". Returning and rejecting need a note; the service and the database enforce that.
 */
export async function reviewDecisionAction(slug: string, id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const intent = str(form, "intent");
  const note = str(form, "comment");
  const state = await runAction(slug, async (m) => {
    if (intent === "approve") {
      await approveAndAssign(getDriver(), m, id, { vendorId: str(form, "vendor_id"), reasonCodeId: str(form, "reason_code_id") || undefined, comment: note || undefined });
      return "Approved. The workshop has been asked for a quotation.";
    }
    if (intent === "return") { await transitionJobCard(getDriver(), m, id, "returned_for_edit", { comment: note }); return "Sent back for edit."; }
    if (intent === "reject") { await transitionJobCard(getDriver(), m, id, "rejected", { comment: note }); return "Rejected."; }
    throw new UserError("Choose what to do.");
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}
