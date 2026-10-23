// A company's own vehicle maintenance policy: a PDF or scan, kept as dated versions. The newest is the current policy.
// Stored as attachments of kind "maintenance_policy" under the company's own folder, like every other file.
// policy.manage adds or removes; policy.read (everyone in the company except workshops) reads.
import type { Driver } from "@/lib/db/types";
import { authorized, type Membership } from "@/lib/auth/can";
import { deleteAttachment, listAttachments, saveAttachment, type AttachmentRow, type BlobStore } from "@/lib/jobcards/attachments";
import { UserError } from "@/lib/master/service";

export type PolicyVersion = {
  id: string; title: string; effective_from: string | null; notes: string | null; created_at: string; file: AttachmentRow | null; current: boolean;
};

export type NewPolicy = { title: string; effective_from?: string; notes?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parsePolicy(input: NewPolicy): { title: string; effective_from: string | null; notes: string | null } {
  const fields: Record<string, string> = {};
  const title = (input.title ?? "").trim();
  if (title.length < 2 || title.length > 120) fields.title = "Give the policy a name of 2 to 120 characters.";
  const from = (input.effective_from ?? "").trim();
  if (from && (!DATE.test(from) || Number.isNaN(Date.parse(`${from}T00:00:00Z`)))) fields.effective_from = "Use a date like 2026-01-31.";
  const notes = (input.notes ?? "").trim();
  if (notes.length > 1000) fields.notes = "Keep the note under 1000 characters.";
  if (Object.keys(fields).length) throw new UserError("Check the highlighted fields.", fields);
  return { title, effective_from: from || null, notes: notes || null };
}

export async function addPolicy(driver: Driver, store: BlobStore, m: Membership, input: NewPolicy, file: { name: string; bytes: Uint8Array }): Promise<string> {
  const p = parsePolicy(input);
  return authorized(driver, m, "policy.manage", async (q) => {
    // The record and its file are saved in one transaction: if the file is refused, no empty policy is left behind.
    const id = (await q.query<{ id: string }>(
      "insert into maintenance_policies(title, effective_from, notes, created_by) values ($1, $2, $3, $4) returning id", [p.title, p.effective_from, p.notes, m.userId])).rows[0].id;
    await saveAttachment(q, store, m, "maintenance_policy", id, file);
    return id;
  });
}

export function listPolicies(driver: Driver, store: BlobStore, m: Membership): Promise<PolicyVersion[]> {
  return authorized(driver, m, "policy.read", async (q) => {
    const rows = (await q.query<Omit<PolicyVersion, "file" | "current">>(
      "select id, title, effective_from::text, notes, created_at::text from maintenance_policies order by created_at desc, id")).rows;
    return Promise.all(rows.map(async (r, i) => ({ ...r, current: i === 0, file: (await listAttachments(q, store, m, "maintenance_policy", r.id))[0] ?? null })));
  });
}

export function removePolicy(driver: Driver, store: BlobStore, m: Membership, policyId: string): Promise<void> {
  return authorized(driver, m, "policy.manage", async (q) => {
    if ((await q.query("select 1 from maintenance_policies where id = $1", [policyId])).rows.length === 0) throw new UserError("Policy not found.");
    const files = await q.query<{ id: string }>("select id from attachments where entity_type = 'maintenance_policy' and entity_id = $1", [policyId]);
    for (const f of files.rows) await deleteAttachment(q, store, m, f.id);
    await q.query("delete from maintenance_policies where id = $1", [policyId]);
  });
}
