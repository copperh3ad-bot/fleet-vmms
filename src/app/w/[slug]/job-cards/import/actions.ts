"use server";
// Upload of filled offline job card forms (ADR-022). Each file becomes one draft job card through createJobCard, which
// checks jobcard.create and the vehicle scope; a file that is refused changes nothing and says why, cell by cell.
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { requireMembership } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/can";
import { MAX_FORM_BYTES } from "@/lib/jobcards/offline-form";
import { importFilledForm, loadFormContext, type ImportResult } from "@/lib/jobcards/offline-service";

export type ImportState = { error?: string; results?: ImportResult[] };
const MAX_FILES = 10;

export async function importFormsAction(slug: string, _prev: ImportState, form: FormData): Promise<ImportState> {
  const m = await requireMembership(slug);
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: "Choose at least one filled form." };
  if (files.length > MAX_FILES) return { error: `Upload at most ${MAX_FILES} forms at a time.` };
  const driver = getDriver();
  const ctx = await loadFormContext(driver, m).catch((e) => { if (e instanceof ForbiddenError) return null; throw e; });
  if (!ctx) return { error: "You do not have permission to raise job cards." };
  const results: ImportResult[] = [];
  for (const f of files) {
    // The size is checked before the bytes are read into memory.
    if (f.size > MAX_FORM_BYTES) { results.push({ file: f.name, ok: false, problems: [{ field: "file", message: "The file is too large. A filled form is well under 1 MB." }] }); continue; }
    if (!/\.xlsx$/i.test(f.name)) { results.push({ file: f.name, ok: false, problems: [{ field: "file", message: "Upload the Excel form (.xlsx)." }] }); continue; }
    try { results.push(await importFilledForm(driver, m, ctx, { name: f.name.slice(0, 120), bytes: new Uint8Array(await f.arrayBuffer()) })); }
    catch (e) { if (e instanceof ForbiddenError) results.push({ file: f.name, ok: false, problems: [{ field: "file", message: "You do not have permission to raise a job card for that vehicle." }] }); else throw e; }
  }
  if (results.some((r) => r.ok)) refresh();
  return { results };
}
