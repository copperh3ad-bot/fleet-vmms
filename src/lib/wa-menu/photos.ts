// Photos a person sends in a questionnaire (ADR-079 phase B): ordinary images only, up to three, each at most 5 MB, kept where the job card's other files go. Anything else is
// refused kindly and never stored.
import type { InboundMessage } from "@/lib/whatsapp";

export const MAX_PHOTOS = 3;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export type StoredPhoto = { path: string; name: string; mime: string };
export type PhotoDeps = {
  fetchMedia: (id: string, maxBytes: number) => Promise<{ bytes: Uint8Array; mime: string | null }>;
  store: (path: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  newId: () => string;
};

/** Stores what fits, returns the new photos and how many files were not used. */
export async function takePhotos(deps: PhotoDeps, schema: string, media: InboundMessage["media"], have: number): Promise<{ stored: StoredPhoto[]; skipped: number }> {
  const stored: StoredPhoto[] = [];
  let skipped = 0;
  for (const med of media) {
    if (have + stored.length >= MAX_PHOTOS) { skipped++; continue; }
    try {
      const got = await deps.fetchMedia(med.id, MAX_PHOTO_BYTES);
      const mime = (got.mime ?? med.mime ?? "").toLowerCase();
      if (!IMAGE_MIME.has(mime) || got.bytes.length > MAX_PHOTO_BYTES) { skipped++; continue; }
      const name = `photo-${have + stored.length + 1}.${EXT[mime]}`;
      const path = `${schema}/intake/${deps.newId()}/${name}`;
      await deps.store(path, got.bytes, mime);
      stored.push({ path, name, mime });
    } catch { skipped++; }
  }
  return { stored, skipped };
}
