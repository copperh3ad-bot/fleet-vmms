// Resend's side of receiving a workshop's reply (ADR-033). The webhook only says "an email arrived"; the message and its files are fetched here with
// the API key. Written to the endpoints in Resend's receiving documentation: GET /emails/receiving/{id} and GET /emails/receiving/{id}/attachments.
// Nothing here logs an address, a subject, a body or a link.
import type { InboundDeps, ReceivedEmail, ReceivedFile } from "@/lib/vendorflow/inbound";

const API = "https://api.resend.com";

async function api(path: string): Promise<Record<string, unknown>> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("receiving is not set up");
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!res.ok) throw new Error(`resend ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export async function fetchReceivedEmail(id: string): Promise<ReceivedEmail> {
  const j = await api(`/emails/receiving/${encodeURIComponent(id)}`);
  return { id, from: str(j.from) ?? "", subject: str(j.subject), text: str(j.text), html: str(j.html), messageId: str(j.message_id) };
}

export async function fetchReceivedFiles(id: string): Promise<ReceivedFile[]> {
  const j = await api(`/emails/receiving/${encodeURIComponent(id)}/attachments`);
  const data = Array.isArray(j.data) ? j.data : [];
  return data.flatMap((a: Record<string, unknown>) => {
    const url = str(a.download_url), name = str(a.filename);
    return url && name && /^https:\/\//.test(url) ? [{ filename: name, size: typeof a.size === "number" ? a.size : null, downloadUrl: url }] : [];
  });
}

/** Downloads one file, stopping as soon as it is larger than the limit instead of reading it all. */
export async function downloadReceivedFile(url: string, maxBytes: number): Promise<Uint8Array> {
  if (!/^https:\/\//.test(url)) throw new Error("not an https address");
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("too large");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { await reader.cancel(); throw new Error("too large"); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

export const realInboundDeps = (store: InboundDeps["store"]): InboundDeps => ({
  fetchEmail: fetchReceivedEmail, fetchFiles: fetchReceivedFiles, download: downloadReceivedFile, store, newId: () => crypto.randomUUID(),
});
