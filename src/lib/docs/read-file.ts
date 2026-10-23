// Turns an uploaded file into text, one page at a time (a host call is short; a long file is many calls).
//   PDF with its own text      -> the text, as is
//   PDF that is a scan         -> the page picture, read by OCR
//   photo (JPEG, PNG, WebP)    -> read by OCR   (HEIC cannot be read here; the screen says so)
// No outside service is used. The file never leaves our servers.
import { deflateSync } from "node:zlib";
import { UserError } from "@/lib/master/service";
import { readPicture } from "./ocr";

export type FileInfo = { kind: "pdf-text" | "pdf-scan" | "image"; pages: number; mime: string };
export const MAX_PAGES = 30;

const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isWebp = (b: Uint8Array) => b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45;
const isHeic = (b: Uint8Array) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;

async function pdfLib() { return import("unpdf"); }

/** What the file is and how many pages it has. A PDF counts as text when its pages carry real words. */
export async function inspectFile(bytes: Uint8Array): Promise<FileInfo> {
  if (isPdf(bytes)) {
    const { getDocumentProxy, extractText } = await pdfLib();
    let pdf;
    try { pdf = await getDocumentProxy(new Uint8Array(bytes)); } catch { throw new UserError("This PDF could not be opened. It may be damaged or password protected."); }
    if (pdf.numPages > MAX_PAGES) throw new UserError(`This file has ${pdf.numPages} pages. Reading is limited to ${MAX_PAGES}.`);
    const { text } = await extractText(pdf, { mergePages: false });
    const words = text.join(" ").split(/\s+/).filter((w) => /[A-Za-z]{3,}/.test(w)).length;
    return { kind: words >= 20 * pdf.numPages ? "pdf-text" : "pdf-scan", pages: pdf.numPages, mime: "application/pdf" };
  }
  if (isJpeg(bytes)) return { kind: "image", pages: 1, mime: "image/jpeg" };
  if (isPng(bytes)) return { kind: "image", pages: 1, mime: "image/png" };
  if (isWebp(bytes)) throw new UserError("A WebP photo cannot be read yet. Upload it as a JPEG, a PNG or a PDF.");
  if (isHeic(bytes)) throw new UserError("An iPhone HEIC photo cannot be read yet. Upload it as a JPEG, a PNG or a PDF.");
  throw new UserError("Only PDF, JPEG and PNG files can be read.");
}

/** Text of one page, counting from 1. */
export async function readPage(bytes: Uint8Array, info: FileInfo, page: number): Promise<{ text: string; confidence: number | null }> {
  if (page < 1 || page > info.pages) throw new UserError("That page does not exist.");
  if (info.kind === "image") return readPicture(bytes);
  const { getDocumentProxy, extractText, extractImages } = await pdfLib();
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  if (info.kind === "pdf-text") {
    const { text } = await extractText(pdf, { mergePages: false });
    return { text: text[page - 1] ?? "", confidence: null };
  }
  const images = await extractImages(pdf, page);
  if (images.length === 0) return { text: "", confidence: 0 };
  // A scanned page is one big picture. Read the largest one if there are several (logos and stamps are small).
  const biggest = images.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  return readPicture(png(biggest.data, biggest.width, biggest.height, biggest.channels as 1 | 3 | 4));
}

// ---------- a small PNG writer, so a raw page picture can go to the reader ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, "ascii"); Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function png(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number, channels: 1 | 3 | 4): Uint8Array {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);                     // each row starts with filter type 0 (none)
  for (let y = 0; y < height; y++) Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw, { level: 1 })), chunk("IEND", new Uint8Array())]);
}
