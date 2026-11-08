import { requireMembership } from "@/lib/auth/session";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { isFrameworkSignal, logActivity } from "@/lib/activity/log";

export type FormState = { error?: string; fields?: Record<string, string>; ok?: string; values?: Record<string, string> };

/** The name of the action that called runAction, read from the call stack before anything is awaited (ADR-070). Null if it cannot be told. */
export function callerName(skip: string[] = ["runAction", "callerName", "run"]): string | null {
  for (const line of (new Error().stack ?? "").split("\n").slice(2)) {
    const name = line.match(/at (?:async )?([A-Za-z_$][\w$]*) \(/)?.[1];
    if (name && !skip.includes(name)) return name;
  }
  return null;
}

/**
 * Every server action starts here: the signed-in user must belong to this workspace (the slug from the browser is
 * not trusted), then the work runs, and known problems come back as a message instead of a crash.
 * redirect() must be called by the caller after this returns, because it works by throwing.
 *
 * It also writes the activity log (ADR-070): who ran which action, whether it worked, was refused for a reason the person was told, was refused for permission,
 * or failed, and how long it took. An unexpected failure is logged here with the person and then thrown on.
 */
export async function runAction(slug: string, fn: (m: Membership) => Promise<string | void>, opts: { allowLocked?: boolean } = {}): Promise<FormState> {
  const name = callerName() ?? "action";
  const t0 = Date.now();
  const m = await requireMembership(slug, opts);
  const base = { kind: "action" as const, name, actorId: m.userId, tenantId: m.tenantId, role: m.role };
  try {
    const out = { ok: (await fn(m)) || "Saved" };
    await logActivity({ ...base, outcome: "ok", durationMs: Date.now() - t0 });
    return out;
  } catch (e) {
    const durationMs = Date.now() - t0;
    if (e instanceof UserError) {
      await logActivity({ ...base, outcome: "invalid", durationMs, details: { message: e.message, fields: e.fields ? Object.keys(e.fields) : [] } });
      return { error: e.message, fields: e.fields };
    }
    if (e instanceof ForbiddenError) {
      await logActivity({ ...base, kind: "security", outcome: "denied", durationMs, details: { permission: e.permission, action: name } });
      return { error: "You do not have permission to do this." };
    }
    if (isFrameworkSignal(e)) throw e;                                        // a redirect or notFound thrown on purpose is not a failure
    await logActivity({ ...base, outcome: "error", durationMs, error: e });
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
