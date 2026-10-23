// Supabase Storage for files only (CLAUDE.md rule 2). Runs as the signed-in user, so the bucket policies apply.
import { supabaseServer } from "./server";
import type { ReadableStore } from "@/lib/master/policy-reading";

const BUCKET = "attachments";

export async function supabaseBlobStore(): Promise<ReadableStore> {
  const sb = await supabaseServer();
  return {
    async put(path, bytes, contentType) {
      const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false });
      if (error) throw new Error(`storage upload failed: ${error.message}`);
    },
    async remove(path) {
      const { error } = await sb.storage.from(BUCKET).remove([path]);
      if (error) throw new Error(`storage remove failed: ${error.message}`);
    },
    async get(path) {
      const { data, error } = await sb.storage.from(BUCKET).download(path);
      return error || !data ? null : new Uint8Array(await data.arrayBuffer());
    },
    async signedUrl(path, seconds) {
      const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, seconds);
      return data?.signedUrl ?? null;
    },
  };
}
