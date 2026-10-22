"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { createJobCard, editJobCard, transitionJobCard, markNotificationsRead } from "@/lib/jobcards/service";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { addJobCardAttachment, removeJobCardAttachment } from "@/lib/jobcards/attachments";
import { UserError } from "@/lib/master/service";
import { runAction, str, typed, type FormState } from "../actions-util";

/** The form posts line fields as parallel lists (line_kind, line_description, ...). Fully blank rows are dropped. */
function cardFromForm(f: FormData) {
  const get = (k: string) => f.getAll(k).map(String);
  const [kind, description, qty, unit] = [get("line_kind"), get("line_description"), get("line_qty"), get("line_unit_cost")];
  const lines = description
    .map((d, i) => ({ kind: kind[i], description: d, qty: qty[i], unit_cost: unit[i] }))
    .filter((l) => l.description.trim() !== "" || (l.unit_cost ?? "").trim() !== "");
  const raw: Record<string, unknown> = { lines };
  for (const k of ["vehicle_id", "requested_by", "category", "reason_code_id", "cause_text", "description", "priority", "needed_by", "odometer_km"]) raw[k] = str(f, k);
  return raw;
}

/** id is "" for a new card. intent is "draft" or "submit". */
export async function saveJobCardAction(slug: string, id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const submit = str(form, "intent") === "submit";
  let target = id;
  const state = await runAction(slug, async (m) => {
    if (id) await editJobCard(getDriver(), m, id, cardFromForm(form), submit);
    else target = (await createJobCard(getDriver(), m, cardFromForm(form), submit)).id;
    return submit ? "Submitted for approval." : "Draft saved.";
  });
  if (state.ok && target) { refresh(); redirect(`/w/${slug}/job-cards/${target}`); }
  return { ...state, values: typed(form) };
}

export async function transitionAction(slug: string, id: string, to: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await transitionJobCard(getDriver(), m, id, to, {
      comment: str(form, "comment") || undefined, reasonCodeId: str(form, "reason_code_id") || undefined, vendorId: str(form, "vendor_id") || undefined,
    });
    return { approved: "Approved.", rejected: "Rejected.", returned_for_edit: "Sent back for edit.", submitted: "Submitted for approval.", cancelled: "Cancelled.", vendor_assigned: "Vendor assigned." }[to] ?? "Done.";
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

export async function markReadAction(slug: string): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await markNotificationsRead(getDriver(), m); return "All read."; });
  if (state.ok) refresh();
  return state;
}
