// Photos and documents. The bytes go to Supabase Storage under <tenant schema>/<entity type>/<id>/..., the record
// goes in the tenant's attachments table. Storage is reached through BlobStore so tests need no network.
// saveAttachment / listAttachments / deleteAttachment are the shared core; the job card wrappers below add the
// job card rules (who may add, and only while the card is editable). Compliance uses the core directly.
import { randomUUID } from "node:crypto";
import type { Driver, Queryable } from "@/lib/db/types";
import { authorized, authorizedAny, ForbiddenError, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";

export interface BlobStore {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(path: string): Promise<void>;
  signedUrl(path: string, seconds: number): Promise<string | null>;
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_CARD = 12;

/** Kinds we accept, decided by what the bytes are, not by what the browser claims. */
const SIGNATURES: { mime: string; ext: string[]; match: (b: Uint8Array) => boolean }[] = [
  { mime: "image/jpeg", ext: ["jpg", "jpeg"], match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: ["png"], match: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/webp", ext: ["webp"], match: (b) => b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45 },
  { mime: "image/heic", ext: ["heic", "heif"], match: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
  { mime: "application/pdf", ext: ["pdf"], match: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
];

export function sniff(name: string, bytes: Uint8Array): string | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return SIGNATURES.find((s) => s.ext.includes(ext) && s.match(bytes))?.mime ?? null;
}

/** Keeps letters, digits, dot, dash and underscore. The path never contains anything a person typed unfiltered. */
export function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const clean = base.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(-80);
  return clean || "file";
}

export type AttachmentRow = { id: string; file_name: string; mime_type: string | null; created_at: string; uploaded_by: string | null; url: string | null };
export type EntityType = "job_card" | "accident" | "challan" | "compliance_doc" | "insurance_policy" | "quotation" | "invoice";

/** The caller has already checked the permission and that the person may touch this entity. */
export async function saveAttachment(q: Queryable, store: BlobStore, m: Membership, entityType: EntityType, entityId: string, file: { name: string; bytes: Uint8Array }): Promise<void> {
  if (file.bytes.length === 0) throw new UserError("That file is empty.");
  if (file.bytes.length > MAX_FILE_BYTES) throw new UserError("That file is larger than 10 MB.");
  const mime = sniff(file.name, file.bytes);
  if (!mime) throw new UserError("Only photos (JPG, PNG, WebP, HEIC) and PDF files are accepted.");
  const count = (await q.query<{ c: number }>("select count(*)::int c from attachments where entity_type = $1 and entity_id = $2", [entityType, entityId])).rows[0].c;
  if (count >= MAX_FILES_PER_CARD) throw new UserError(`This record can hold ${MAX_FILES_PER_CARD} files.`);

  const name = safeName(file.name);
  const path = `${m.schema}/${entityType}/${entityId}/${randomUUID()}-${name}`;
  try { await store.put(path, file.bytes, mime); }
  catch { throw new UserError("The file could not be uploaded. Try again."); }
  try {
    await q.query(
      "insert into attachments(entity_type, entity_id, storage_path, file_name, mime_type, uploaded_by) values ($1, $2, $3, $4, $5, $6)",
      [entityType, entityId, path, name, mime, m.userId]);
  } catch (e) {
    await store.remove(path).catch(() => undefined);   // no orphan file if the record could not be saved
    throw e;
  }
}

/** Lists with 5-minute links. Never signs a path outside this workspace's folder, whatever the row says. */
export async function listAttachments(q: Queryable, store: BlobStore, m: Membership, entityType: EntityType, entityId: string): Promise<AttachmentRow[]> {
  const rows = (await q.query<Omit<AttachmentRow, "url"> & { storage_path: string }>(
    `select id, file_name, mime_type, created_at::text, uploaded_by::text, storage_path
       from attachments where entity_type = $1 and entity_id = $2 order by created_at, id`, [entityType, entityId])).rows;
  return Promise.all(rows.map(async ({ storage_path, ...r }) => ({
    ...r, url: storage_path.startsWith(`${m.schema}/`) ? await store.signedUrl(storage_path, 300) : null,
  })));
}

/** Removes the record, then the file. The caller has already checked the permission. Returns the entity it belonged to. */
export async function deleteAttachment(q: Queryable, store: BlobStore, m: Membership, attachmentId: string): Promise<{ entityType: string; entityId: string } | null> {
  const a = (await q.query<{ storage_path: string; entity_type: string; entity_id: string }>(
    "delete from attachments where id = $1 returning storage_path, entity_type, entity_id", [attachmentId])).rows[0];
  if (!a) return null;
  if (a.storage_path.startsWith(`${m.schema}/`)) await store.remove(a.storage_path).catch(() => undefined);
  return { entityType: a.entity_type, entityId: a.entity_id };
}

// ---------- Job cards ----------

/** Only the requester (or whoever opened it) may add files, and only while the card can still be edited. */
export function addJobCardAttachment(driver: Driver, store: BlobStore, m: Membership, jobCardId: string, file: { name: string; bytes: Uint8Array }): Promise<void> {
  return authorized(driver, m, "jobcard.create", async (q) => {
    const jc = (await q.query<{ status: string; mine: boolean }>(
      "select status, job_card_is_mine(id, $2) as mine from job_cards where id = $1", [jobCardId, m.userId])).rows[0];
    if (!jc) throw new UserError("Job card not found.");
    if (!jc.mine) throw new ForbiddenError("jobcard.create for this job card");
    if (!["draft", "returned_for_edit"].includes(jc.status)) throw new UserError("Files can only be added while the job card is a draft or sent back.");
    await saveAttachment(q, store, m, "job_card", jobCardId, file);
  });
}

export function listJobCardAttachments(driver: Driver, store: BlobStore, m: Membership, jobCardId: string): Promise<AttachmentRow[]> {
  return authorizedAny(driver, m, ["jobcard.read_all", "jobcard.read_own"], async (q, held) => {
    // the same visibility rule as the card itself
    const visible = (await q.query(
      `select 1 from job_cards jc join employees re on re.id = jc.requested_by left join employees cu on cu.id = jc.custodian_id
        where jc.id = $1 ${held.has("jobcard.read_all") ? "" : "and (re.user_id = $2 or cu.user_id = $2)"}`,
      held.has("jobcard.read_all") ? [jobCardId] : [jobCardId, m.userId])).rows.length > 0;
    return visible ? listAttachments(q, store, m, "job_card", jobCardId) : [];
  });
}

export function removeJobCardAttachment(driver: Driver, store: BlobStore, m: Membership, attachmentId: string): Promise<void> {
  return authorized(driver, m, "jobcard.create", async (q) => {
    const a = (await q.query<{ status: string; mine: boolean }>(
      `select jc.status, job_card_is_mine(jc.id, $2) as mine
         from attachments a join job_cards jc on jc.id = a.entity_id where a.id = $1 and a.entity_type = 'job_card'`, [attachmentId, m.userId])).rows[0];
    if (!a) throw new UserError("File not found.");
    if (!a.mine) throw new ForbiddenError("jobcard.create for this job card");
    if (!["draft", "returned_for_edit"].includes(a.status)) throw new UserError("Files can only be removed while the job card is a draft or sent back.");
    await deleteAttachment(q, store, m, attachmentId);
  });
}
