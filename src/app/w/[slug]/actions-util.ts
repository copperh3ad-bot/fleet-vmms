import { requireMembership } from "@/lib/auth/session";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";

export type FormState = { error?: string; fields?: Record<string, string>; ok?: string; values?: Record<string, string> };

/**
 * Every server action starts here: the signed-in user must belong to this workspace (the slug from the browser is
 * not trusted), then the work runs, and known problems come back as a message instead of a crash.
 * redirect() must be called by the caller after this returns, because it works by throwing.
 */
export async function runAction(slug: string, fn: (m: Membership) => Promise<string | void>, opts: { allowLocked?: boolean } = {}): Promise<FormState> {
  const m = await requireMembership(slug, opts);
  try {
    return { ok: (await fn(m)) || "Saved" };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, fields: e.fields };
    if (e instanceof ForbiddenError) return { error: "You do not have permission to do this." };
    throw e;
  }
}

/** Reads the lists posted by LinesEditor. Rows with no description and no cost are dropped. */
export function linesFromForm(form: FormData) {
  const get = (k: string) => form.getAll(k).map(String);
  const [kind, description, qty, unit, ref] = [get("line_kind"), get("line_description"), get("line_qty"), get("line_unit_cost"), get("line_ref")];
  return description
    .map((d, i) => ({ kind: kind[i], description: d, qty: qty[i], unit_cost: unit[i], quotation_line_id: ref[i] || undefined }))
    .filter((l) => l.description.trim() !== "" || (l.unit_cost ?? "").trim() !== "");
}

export const str =(form: FormData, k: string) => String(form.get(k) ?? "");

/** The text fields as typed, sent back on an error because React clears the form after every submit. */
export const typed = (form: FormData): Record<string, string> =>
  Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string" && !e[0].startsWith("$")));
