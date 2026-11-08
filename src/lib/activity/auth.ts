// The activity log for the forms open to the world: sign-in, sign-up, password reset, joining, accepting an invitation, the contact form (ADR-070).
// Each public action is wrapped once, so every way out of it is covered: it worked, it was refused with a reason the person was shown, it was rate-limited, or it failed.
// The log records which account was typed (an email or sign-in name is how an attack on one account is seen) and never the password or any code.
import { isFrameworkSignal, logActivity, type ActivityOutcome } from "./log";

type Result = { error?: string; fields?: unknown; ok?: string; done?: boolean; notice?: string; go?: string; sentTo?: string };

/** How an action's answer reads: an error with field messages is a mistake in the form, any other error is a refusal. */
export function judge(r: unknown): { outcome: ActivityOutcome; why?: string } {
  const x = (r && typeof r === "object" ? r : {}) as Result;
  if (x.error) return { outcome: x.fields ? "invalid" : "denied", why: x.error };
  return { outcome: "ok" };
}

const isRedirect = (e: unknown) => typeof (e as { digest?: unknown })?.digest === "string" && /^NEXT_REDIRECT/.test((e as { digest: string }).digest);

/** Runs a public action and logs how it ended. `args` are the action's own arguments: the account typed is read from a FormData among them. */
export async function authEvent<T>(name: string, args: unknown[], work: () => Promise<T>): Promise<T> {
  const form = args.find((a): a is FormData => typeof FormData !== "undefined" && a instanceof FormData);
  const typedAccount = form ? String(form.get("email") ?? form.get("identifier") ?? "").trim().toLowerCase().slice(0, 120) : "";
  const subject = typedAccount || null;
  const t0 = Date.now();
  try {
    const r = await work();
    const j = judge(r);
    await logActivity({ kind: "auth", name, outcome: j.outcome, subject, durationMs: Date.now() - t0, details: j.why ? { why: j.why } : undefined });
    return r;
  } catch (e) {
    if (isRedirect(e)) { await logActivity({ kind: "auth", name, outcome: "ok", subject, durationMs: Date.now() - t0 }); throw e; }   // a redirect after success
    if (isFrameworkSignal(e)) throw e;
    await logActivity({ kind: "auth", name, outcome: "error", subject, durationMs: Date.now() - t0, error: e });
    throw e;
  }
}
