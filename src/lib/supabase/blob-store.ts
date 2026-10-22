// Supabase Storage for files only (CLAUDE.md rule 2). Runs as the signed-in user, so the bucket policies apply.
import { supabaseServer } from "./server";
import type { BlobStore } from "@/lib/jobcards/attachments";

const BUCKET = "attachments";

export async function supabaseBlobStore(): Promise<BlobStore> {
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
    async signedUrl(path, seconds) {
      const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, seconds);
      return data?.signedUrl ?? null;
    },
  };
}
