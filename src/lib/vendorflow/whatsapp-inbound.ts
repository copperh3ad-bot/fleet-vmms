// A workshop's WhatsApp reply to a request Fleet OTG sent (ADR-042). The same job as an emailed reply (ADR-033, src/lib/vendorflow/inbound.ts) and the same database steps:
// the message and its photos and PDFs are filed on the job card, flagged "needs entering", and the people who handle it are told. Nothing is read out of the message by
// this code; staff (or the AI reader, ADR-034, as a draft) enter the figures. A short text such as "ready" or "need 2 more days" is filed the same way, so it shows on the
// job card for staff to see; it changes no figure and approves nothing.
//
// Which request a reply answers: the person used WhatsApp's "reply" on our message, and Meta then tells us that message's id. Sending the request stored a hash of it (with
// the prefix "wa:") where an emailed reply's code goes, so it is found the same way. A message that is not a reply to ours is not filed anywhere: nobody could say which
// job it belongs to, and the same number may work for several companies.
import type { Driver } from "@/lib/db/types";
import { withLinkContext, withOrgPlatform } from "@/lib/db/tenant";
import { MAX_FILE_BYTES, safeName, sniff } from "@/lib/jobcards/attachments";
import type { InboundMessage } from "@/lib/whatsapp";
import { MAX_FILES_PER_REPLY, replyCodeHash, resolveReplyByHash } from "./inbound";

export const waReplyHash = (messageId: string) => replyCodeHash(`wa:${messageId}`);

export type WhatsAppDeps = {
  fetchMedia: (mediaId: string, maxBytes: number) => Promise<{ bytes: Uint8Array; mime: string | null }>;
  store: (path: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  newId: () => string;
};

export type WhatsAppOutcome =
  | { status: "ignored" }                                   // closed, unknown, too many replies, or already filed: nothing was saved
  | { status: "no_context" }                                // not a reply to one of our messages
  | { status: "filed"; emailId: string; jobNo: string; saved: number; skipped: number };

export async function processInboundWhatsApp(driver: Driver, deps: WhatsAppDeps, msg: InboundMessage): Promise<WhatsAppOutcome> {
  if (!msg.contextId) return { status: "no_context" };
  const target = await resolveReplyByHash(driver, waReplyHash(msg.contextId));
  if (!target) return { status: "ignored" };
  const open = await withLinkContext(driver, target.schema, async (q) =>
    (await q.query<{ job_no: string }>("select job_no from inbound_target($1, $2, $3)", [target.jobId, target.vendorId, target.kind])).rows[0] ?? null, "inbound_mail");
  if (!open) return { status: "ignored" };                                      // the job has moved on: nothing is filed on a closed request

  const messageId = `wa:${msg.id}`;
  const seen = await withLinkContext(driver, target.schema, async (q) => (await q.query<{ s: boolean }>("select workshop_email_seen($1) as s", [messageId])).rows[0].s, "inbound_mail");
  if (seen) return { status: "ignored" };                                      // Meta delivers a webhook more than once when it is slow to hear back

  // Files first, so the one database step below either has everything or nothing to point at. Only photos and PDFs within the size limit are kept.
  const wanted = msg.media.slice(0, MAX_FILES_PER_REPLY);
  const kept: { path: string; name: string; mime: string }[] = [];
  let skipped = msg.media.length - wanted.length;
  for (const f of wanted) {
    try {
      const got = await deps.fetchMedia(f.id, MAX_FILE_BYTES);
      const name = safeName(f.filename ?? (got.mime?.startsWith("image/") ? "photo.jpg" : "file"));
      const mime = got.bytes.length > 0 && got.bytes.length <= MAX_FILE_BYTES ? sniff(name, got.bytes) : null;
      if (!mime) { skipped++; continue; }
      const path = `${target.schema}/job_card/${target.jobId}/${deps.newId()}-${name}`;
      await deps.store(path, got.bytes, mime);
      kept.push({ path, name, mime });
    } catch { skipped++; }
  }

  const note = skipped > 0 ? `\n\n[${skipped} attachment${skipped > 1 ? "s were" : " was"} not saved: larger than 4 MB, not a photo or PDF, or too many.]` : "";
  const filed = await withLinkContext(driver, target.schema, async (q) => {
    const id = (await q.query<{ id: string }>("select file_workshop_email($1, $2, $3, $4, $5, $6, $7) as id",
      [target.jobId, target.vendorId, target.kind, msg.from, "WhatsApp", (msg.text.trim() || (kept.length ? "" : "(no message)")) + note, messageId])).rows[0].id;
    let saved = 0;
    for (const k of kept) {
      try { await q.query("savepoint f"); await q.query("select add_workshop_email_file($1, $2, $3, $4)", [id, k.path, k.name, k.mime]); await q.query("release savepoint f"); saved++; }
      catch { await q.query("rollback to savepoint f"); skipped++; }
    }
    return { id, saved };
  }, "inbound_mail");

  await withOrgPlatform(driver, target.schema, (q) => q.query("update public.quotation_links set replies_used = replies_used + 1 where id = $1", [target.linkId]));
  return { status: "filed", emailId: filed.id, jobNo: open.job_no, saved: filed.saved, skipped };
}
