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
import { createWorkshopLink, decideQuotation, setWorkshopEmailStatus, type WorkshopLinkKind } from "@/lib/vendorflow/service";
import { enterForWorkshop } from "@/lib/vendorflow/entry";
import { readEmailDocument, setAiDocuments } from "@/lib/ai/service";
import { estimateFromForm, invoiceFromForm } from "@/lib/vendorflow/form";
import { emailConfigured, sendMail } from "@/lib/email/send";
import { buildWorkshopMail } from "@/lib/email/workshop";
import { replyAddress } from "@/lib/vendorflow/inbound";
import { SITE_URL } from "@/lib/site";
import { origin } from "@/lib/origin";
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

export type QuoteLinkState = FormState & { send?: { text: string; digits: string; e164: string; display: string; vendor: string; expires_at: string } };

const askText = (kind: WorkshopLinkKind, jobNo: string, url: string) =>
  `Fleet OTG: please send your ${kind === "quotation" ? "estimate" : "invoice"} for job card ${jobNo} using this link (works once, valid 7 days): ${url}`;

/** A fresh single-use link for the assigned workshop, for the estimate or the invoice. It goes to the workshop's own phone number only and is not shown on screen (ADR-030, ADR-033). */
export async function createWorkshopLinkAction(slug: string, jobId: string, kind: WorkshopLinkKind, _prev: QuoteLinkState): Promise<QuoteLinkState> {
  const base = await origin();
  let send: QuoteLinkState["send"];
  const state = await runAction(slug, async (m) => {
    const l = await createWorkshopLink(getDriver(), m, jobId, kind);
    if (!l.phone.e164) throw new UserError(`${l.vendor_name} has no mobile number a message can reach. Add it under Vendors, or send the link by email.`);
    send = { text: askText(kind, l.job_no, `${base}/q/${l.token}`), digits: l.phone.digits, e164: l.phone.e164, display: l.phone.display, vendor: l.vendor_name, expires_at: l.expires_at };
    return "Link ready.";
  });
  if (state.ok) refresh();
  return { ...state, send };
}

/**
 * The same link, sent by email to the workshop's own address on the Vendors page (ADR-033). The email goes out from here, so the link is never
 * shown to the person pressing the button; it reaches only the address the organization entered for that workshop.
 */
export async function emailWorkshopLinkAction(slug: string, jobId: string, kind: WorkshopLinkKind, _prev: QuoteLinkState): Promise<QuoteLinkState> {
  const base = await origin();
  const state = await runAction(slug, async (m) => {
    if (!emailConfigured()) throw new UserError("Email is not set up on this server yet. Send the link by phone instead.");
    const l = await createWorkshopLink(getDriver(), m, jobId, kind, { withReply: true });
    if (!l.vendor_email) throw new UserError(`${l.vendor_name} has no email address. Add it under Vendors, or send the link by phone.`);
    try {
      await sendMail(buildWorkshopMail({ to: l.vendor_email, kind, vendorName: l.vendor_name, orgName: m.tenantName || "A Fleet OTG customer", jobNo: l.job_no, url: `${base}/q/${l.token}`, siteUrl: SITE_URL, replyTo: l.replyCode ? replyAddress(l.replyCode) : undefined }));
    } catch {
      throw new UserError("The email could not be sent. Try again, or send the link by phone.");
    }
    return `Email sent to ${l.vendor_name}.`;
  });
  if (state.ok) refresh();
  return state;
}

/**
 * Staff type in the figures from a workshop's emailed reply (ADR-033). The form is the one the workshop's own link shows, and it ends in the same
 * database step, so the job card moves exactly as it would have; the history names the person who typed it in.
 */
export async function enterForWorkshopAction(slug: string, jobId: string, kind: WorkshopLinkKind, emailId: string, _prev: { error?: string; done?: boolean }, form: FormData): Promise<{ error?: string; done?: boolean }> {
  const state = await runAction(slug, async (m) => {
    const ai = String(form.get("ai_action") ?? "");
    await enterForWorkshop(getDriver(), m, jobId, kind, kind === "quotation" ? estimateFromForm(form) : invoiceFromForm(form), emailId || undefined, /^[0-9a-f-]{36}$/.test(ai) ? ai : undefined);
    return "Saved.";
  });
  if (state.ok) { refresh(); return { done: true }; }
  return { error: state.error ?? "Could not save. Check the lines." };
}

/** Says a workshop's emailed reply needs nothing more (or has been dealt with). */
export async function workshopEmailStatusAction(slug: string, emailId: string, status: "entered" | "dismissed", _prev: FormState): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await setWorkshopEmailStatus(getDriver(), m, emailId, status); return "Done."; });
  if (state.ok) refresh();
  return state;
}

/**
 * Asks the AI to read the file(s) a workshop emailed, and shows what it made (ADR-034). Nothing on the job card changes: the result is a draft that
 * fills the form on the next page for a person to check and save. Even a failed or refused reading is shown, so staff know to type it in.
 */
export async function readWithAiAction(slug: string, jobId: string, kind: WorkshopLinkKind, emailId: string, _prev: FormState): Promise<FormState> {
  let id = "";
  const state = await runAction(slug, async (m) => {
    id = (await readEmailDocument(getDriver(), await supabaseBlobStore(), m, { jobId, kind, emailId })).id;
    return "Read.";
  });
  if (state.ok && id) redirect(`/w/${slug}/job-cards/${jobId}/enter/${kind}?email=${emailId}&draft=${id}`);
  return state;
}

/** The organization's administrator allows, or stops, reading workshop documents with AI. Allowing it records who and when. */
export async function setAiDocumentsAction(slug: string, on: boolean, _prev: FormState): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await setAiDocuments(getDriver(), m, on); return on ? "Reading workshop documents with AI is on." : "Reading workshop documents with AI is off."; });
  if (state.ok) refresh();
  return state;
}
