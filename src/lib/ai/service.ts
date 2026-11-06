// What staff can ask the AI to do, and the rules around it (ADR-034). The AI reads a workshop's emailed estimate or invoice and returns a DRAFT; a person
// checks it and saves it with the same form and the same database function as when the figures are typed in. So: it only runs when the organization's
// administrator has switched it on (the documents go to the AI provider, which is their decision), only for people who may already enter those figures,
// only on files that came with a workshop's reply to that job card, within daily limits, and every use is logged with its cost and what became of it.
import type { Driver } from "@/lib/db/types";
import { authorized, authorizedAny, type Membership } from "@/lib/auth/can";
import { withPlatform } from "@/lib/db/tenant";
import { UserError } from "@/lib/master/service";
import type { ReadableStore } from "@/lib/master/policy-reading";
import { allowShared } from "@/lib/rate-limit";
import { aiConfigured, readDocument, type ApprovedLine, type CreateMessage } from "./claude";
import { tenantPlan } from "@/lib/billing/plans";
import { sameAsDraft, type Draft } from "./document";

const PERMS = ["jobcard.assign_vendor", "quotation.approve", "invoice.verify"];
export const AI_READS_PER_PERSON_PER_HOUR = 20;   // the per-day limit for an organization comes from its plan (ADR-035)
const HOUR = 3600, DAY = 86_400;

/** Is the AI allowed to read this organization's documents? Off until its administrator says so. */
export async function aiDocumentsEnabled(driver: Driver, tenantId: string): Promise<boolean> {
  return withPlatform(driver, async (q) => (await q.query<{ on: boolean }>("select ai_documents_enabled as on from public.tenants where id = $1", [tenantId])).rows[0]?.on === true);
}

/** Everything the page needs to decide whether to offer the button: the server has it, the organization's plan includes it, and its administrator has switched it on. */
export async function aiOffered(driver: Driver, m: Membership): Promise<boolean> {
  return aiConfigured() && (await tenantPlan(driver, m.tenantId)).aiDocuments && (await aiDocumentsEnabled(driver, m.tenantId));
}

/** The organization's administrator switches the AI's reading of workshop documents on or off. Switching on records who and when. */
export async function setAiDocuments(driver: Driver, m: Membership, on: boolean): Promise<void> {
  await authorized(driver, m, "admin.users", async () => undefined);
  await withPlatform(driver, async (q) => {
    await q.query("update public.tenants set ai_documents_enabled = $2, ai_consent_by = case when $2 then $3::uuid else null end, ai_consent_at = case when $2 then now() else null end where id = $1", [m.tenantId, on, m.userId]);
  });
}

export type DraftView = { id: string; status: "ok" | "unreadable" | "refused" | "failed"; reason: string | null; draft: Draft | null; model: string; outcome: string; email_id: string | null; document_kind: "quotation" | "invoice" };

export function getAiAction(driver: Driver, m: Membership, jobId: string, id: string): Promise<DraftView | null> {
  return authorizedAny(driver, m, PERMS, async (q) =>
    (await q.query<DraftView>("select id, status, reason, draft, model, outcome, email_id, document_kind from ai_actions where id = $1 and job_card_id = $2 and exists (select 1 from job_cards j where j.id = ai_actions.job_card_id and dept_ok(j.vehicle_id))", [id, jobId])).rows[0] ?? null);
}

type Loaded = { jobNo: string; files: { path: string; name: string; mime: string }[]; approved: ApprovedLine[] };

/**
 * Reads the files that came with one workshop reply and stores the draft. Returns the id of the stored action; the page shows it. Nothing about the job
 * card changes. `create` is the model call, passed in so tests need no network.
 */
export async function readEmailDocument(driver: Driver, store: ReadableStore, m: Membership, input: { jobId: string; kind: "quotation" | "invoice"; emailId: string }, create?: CreateMessage): Promise<{ id: string; status: DraftView["status"] }> {
  if (!aiConfigured()) throw new UserError("Reading documents with AI is not switched on for this service yet.");
  const loaded = await authorizedAny(driver, m, PERMS, async (q): Promise<Loaded> => {
    const e = (await q.query<{ job_no: string }>(
      `select jc.job_no from workshop_emails we join job_cards jc on jc.id = we.job_card_id
        where we.id = $1 and we.job_card_id = $2 and we.kind = $3 and we.status = 'new' and dept_ok(jc.vehicle_id)`, [input.emailId, input.jobId, input.kind])).rows[0];
    if (!e) throw new UserError("That email is not waiting to be entered.");
    const files = (await q.query<{ storage_path: string; file_name: string; mime_type: string | null }>(
      "select storage_path, file_name, mime_type from attachments where entity_type = 'job_card' and entity_id = $1 and source_email_id = $2 order by created_at, id limit 6", [input.jobId, input.emailId])).rows;
    if (files.length === 0) throw new UserError("That email brought no file to read. Type the figures in from the message.");
    const approved = input.kind === "invoice"
      ? (await q.query<ApprovedLine>("select ql.id::text as id, ql.description, ql.qty::text, ql.unit_cost::text from quotation_lines ql join quotations qt on qt.id = ql.quotation_id where qt.job_card_id = $1 and qt.status = 'approved' order by ql.id", [input.jobId])).rows
      : [];
    return { jobNo: e.job_no, files: files.map((f) => ({ path: f.storage_path, name: f.file_name, mime: f.mime_type ?? "" })), approved };
  });
  // Reading with AI is a Pro feature (ADR-035). The plan is checked here, on the server, every time, so hiding a button is never the only guard.
  const plan = await tenantPlan(driver, m.tenantId);
  if (!plan.aiDocuments) throw new UserError("Reading documents with AI is part of the Pro plan. Type the figures in from the file, or ask your administrator about upgrading in Billing.");
  if (!(await aiDocumentsEnabled(driver, m.tenantId))) throw new UserError("Your administrator has not switched on reading workshop documents with AI. Type the figures in from the file.");
  if (plan.aiTrialReads !== null) {   // a trial on Pro tastes it: a few readings in all, until the first payment lifts the cap
    const used = await authorizedAny(driver, m, PERMS, async (q) => Number((await q.query<{ n: string }>("select count(*)::text n from ai_actions where status <> 'failed'")).rows[0].n));
    if (used >= plan.aiTrialReads) throw new UserError(`Your trial includes ${plan.aiTrialReads} readings with AI and they are used up. Pay for Pro in Billing to keep going, or type the figures in from the file.`);
  }
  const [orgOk, personOk] = await Promise.all([allowShared(driver, `ai-read-org:${m.tenantId}`, plan.aiPerDay, DAY), allowShared(driver, `ai-read-user:${m.userId}`, AI_READS_PER_PERSON_PER_HOUR, HOUR)]);
  if (!orgOk || !personOk) throw new UserError("The limit for reading documents with AI has been reached for now. Type the figures in from the file, or try again later.");

  const files = [];
  for (const f of loaded.files) {
    const bytes = await store.get(f.path);
    if (bytes) files.push({ name: f.name, mime: f.mime, bytes });
  }
  const r = await readDocument({ jobNo: loaded.jobNo, kind: input.kind, currency: m.currency || "PKR", approvedLines: loaded.approved, files }, create);
  const draft = r.status === "ok" ? r.draft : null;
  const reason = r.status === "ok" ? null : r.reason;
  const id = await authorizedAny(driver, m, PERMS, async (q) =>
    (await q.query<{ id: string }>(
      `insert into ai_actions(kind, job_card_id, email_id, document_kind, model, status, reason, draft, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, requested_by)
       values ('document_read', $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12) returning id`,
      [input.jobId, input.emailId, input.kind, r.model, r.status, reason, draft ? JSON.stringify(draft) : null, r.inputTokens, r.outputTokens, r.cacheWriteTokens, r.cacheReadTokens, m.userId])).rows[0].id);
  return { id, status: r.status };
}

/** The draft a person is about to confirm, if it belongs to this job card and has not been used yet. */
export function pendingDraft(driver: Driver, m: Membership, jobId: string, id: string): Promise<DraftView | null> {
  return getAiAction(driver, m, jobId, id).then((a) => (a && a.status === "ok" && a.outcome === "pending" ? a : null));
}

/** Records what the person did with the draft: saved it exactly as it was, or corrected it first. Counted to judge whether the model is good enough. */
export function resolveAiAction(driver: Driver, m: Membership, jobId: string, id: string, saved: { description: string; qty: string; unit_cost: string }[]): Promise<void> {
  return authorizedAny(driver, m, PERMS, async (q) => {
    const a = (await q.query<{ draft: Draft | null }>("select draft from ai_actions where id = $1 and job_card_id = $2 and outcome = 'pending'", [id, jobId])).rows[0];
    if (!a?.draft) return;
    await q.query("update ai_actions set outcome = $2, resolved_by = $3, resolved_at = now() where id = $1", [id, sameAsDraft(a.draft, saved) ? "saved_unchanged" : "saved_edited", m.userId]);
  });
}
