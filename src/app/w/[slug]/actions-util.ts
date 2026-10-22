import { requireMembership } from "@/lib/auth/session";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";

export type FormState = { error?: string; fields?: Record<string, string>; ok?: string; values?: Record<string, string> };

/**
 * Every server action starts here: the signed-in user must belong to this workspace (the slug from the browser is
 * not trusted), then the work runs, and known problems come back as a message instead of a crash.
 * redirect() must be called by the caller after this returns, because it works by throwing.
 */
export async function runAction(slug: string, fn: (m: Membership) => Promise<string | void>): Promise<FormState> {
  const m = await requireMembership(slug);
  try {
    return { ok: (await fn(m)) || "Saved" };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, fields: e.fields };
    if (e instanceof ForbiddenError) return { error: "You do not have permission to do this." };
    throw e;
  }
}

export const str = (form: FormData, k: string) => String(form.get(k) ?? "");

/** The text fields as typed, sent back on an error because React clears the form after every submit. */
export const typed = (form: FormData): Record<string, string> =>
  Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string" && !e[0].startsWith("$")));
