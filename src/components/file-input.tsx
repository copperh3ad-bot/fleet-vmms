"use client";
import { useRef, useState } from "react";

// Hosting refuses a request body over about 6 MB, and phone photos are often larger. Photos are shrunk here, before
// they are sent: longest side 2200 px, JPEG. PDFs and small photos are left alone. The server still enforces its own
// per-file limit (MAX_FILE_BYTES in lib/jobcards/attachments.ts); these numbers keep the whole request under the host's.
const MAX_EDGE = 2200;
const SHRINK_ABOVE = 1024 * 1024;
const MAX_EACH = 4 * 1024 * 1024;
const MAX_TOTAL = 5 * 1024 * 1024;

async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.size <= SHRINK_ABOVE) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
  } catch { return file; }   // a format the browser cannot read: send it as it is and let the checks below decide
}

/** A file picker named "files" that shrinks photos and refuses a selection the host would reject, with a plain message. */
export function FileInput({ className = "block w-full text-sm", id = "files" }: { className?: string; id?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  async function onChange() {
    const input = ref.current;
    if (!input?.files?.length) { setNote(null); return; }
    setNote("Preparing photos");
    const files = await Promise.all([...input.files].map(shrink));
    const big = files.find((f) => f.size > MAX_EACH);
    const total = files.reduce((s, f) => s + f.size, 0);
    if (big || total > MAX_TOTAL) {
      input.value = "";
      setNote(big ? `${big.name} is larger than 4 MB. Send it as a smaller photo or a shorter PDF.` : "Those files add up to more than 5 MB. Add them in two goes.");
      return;
    }
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    input.files = dt.files;
    setNote(null);
  }
  return (
    <>
      <input ref={ref} id={id} name="files" type="file" multiple accept="image/*,application/pdf" className={className} onChange={onChange} />
      {note && <p role="status" className="mt-1 text-xs text-amber-800">{note}</p>}
    </>
  );
}
