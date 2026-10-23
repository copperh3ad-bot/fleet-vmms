// Reading text out of a picture, on our own server: nothing is sent to anyone else. Tesseract (open source) with the English
// model, kept in the repository's dependencies. One worker is kept per server process, because starting it is the slow part.
import { existsSync } from "node:fs";
import path from "node:path";
import { createWorker, type Worker } from "tesseract.js";
import { UserError } from "@/lib/master/service";

let worker: Promise<Worker> | null = null;

const MODEL = "node_modules/@tesseract.js-data/eng/4.0.0_best_int";

/** Where the English model sits. The host may run the code from a different folder than a laptop does, so look in a few places. */
function dataDir(): string {
  const roots = [process.env.OCR_DATA_DIR, process.cwd(), path.resolve(process.cwd(), ".."), "/var/task"].filter((x): x is string => !!x);
  for (const r of roots) {
    for (const dir of [r, path.join(r, MODEL)]) if (existsSync(path.join(dir, "eng.traineddata.gz"))) return dir;
    if (existsSync(path.join(r, MODEL, "eng.traineddata.gz"))) return path.join(r, MODEL);
  }
  throw new Error(`reader model not found (looked in ${roots.join(", ")})`);
}

function start(): Promise<Worker> {
  // cacheMethod "none": the host's disk is read-only apart from /tmp, and the model is already on disk next to the code.
  return createWorker("eng", 1, { langPath: dataDir(), gzip: true, cacheMethod: "none" });
}

/** Text of one picture (PNG, JPEG, BMP). Returns the text and how sure the reader was, 0 to 100. */
export async function readPicture(image: Uint8Array): Promise<{ text: string; confidence: number }> {
  try {
    worker ??= start();
    let w: Worker;
    try { w = await worker; } catch (e) { worker = null; throw e; }
    const { data } = await w.recognize(Buffer.from(image));
    return { text: data.text, confidence: Math.round(data.confidence) };
  } catch (e) {
    console.error("picture reader failed:", e instanceof Error ? e.message : e);       // the cause goes to the server log, not to the screen
    throw new UserError("This server could not read the scanned pages. Upload a PDF that contains text, or set the rules by hand.");
  }
}

export async function stopReader(): Promise<void> {
  const w = worker; worker = null;
  if (w) await (await w).terminate().catch(() => undefined);
}
