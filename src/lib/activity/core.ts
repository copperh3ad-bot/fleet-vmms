// The plain core of the activity log (ADR-070): one append-only row for everything the software does that someone may later need to explain. Written from the places every
// request already passes through (actions, sign-in, webhooks, background jobs, unhandled errors), so a new feature is covered without remembering to log it.
//
// It never records a password, a token, a code, a message body or a file, and it never throws: if the log cannot be written the work carries on and one short line
// goes to the host's log. Free text from outside (an error message, a detail) is scrubbed and cut short first.
import { createHash } from "node:crypto";
import type { Driver } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";

export type ActivityKind = "action" | "page" | "auth" | "security" | "webhook" | "job" | "error" | "billing" | "system";
export type ActivityOutcome = "ok" | "denied" | "invalid" | "error" | "info";

export type ActivityEntry = {
  kind: ActivityKind; name: string; outcome: ActivityOutcome;
  actorId?: string | null; subject?: string | null; tenantId?: string | null; role?: string | null;
  path?: string | null; method?: string | null; status?: number | null; durationMs?: number | null;
  error?: unknown; errorDigest?: string | null;
  details?: Record<string, unknown>;
  /** set by tests, or by a caller that already knows the request (the error hook); otherwise read from the current request */
  context?: Partial<RequestContext>;
};

export type RequestContext = { requestId: string | null; path: string | null; method: string | null; ip: string | null; userAgent: string | null };
export const NO_CONTEXT: RequestContext = { requestId: null, path: null, method: null, ip: null, userAgent: null };

const cut = (s: unknown, n: number) => (typeof s === "string" ? s : s == null ? "" : String(s)).slice(0, n);

// ---- scrubbing -------------------------------------------------------------------------------------------------------------------------------------------------
const SECRET_KEY = /pass(word)?|token|secret|key|otp|code|authorization|cookie|signature|bearer|credential|smtp|hash/i;
const SCRUBS: [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "[token]"],                      // a JWT
  [/\b(sb_secret|sb_publishable|sk-ant|sk_live|whsec)_?[A-Za-z0-9_-]{8,}/g, "[key]"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/gi, "[credentials]@"],                              // user:password@ in a URL
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [token]"],
  [/\b[0-9a-f]{32,}\b/gi, "[hex]"],                                                                 // a hash, a token, a key
];
/** Free text from outside the program (an error message): secrets taken out, and cut short. */
export function scrub(text: unknown, max = 300): string {
  let s = cut(text, max * 2);
  for (const [re, to] of SCRUBS) s = s.replace(re, to);
  return s.slice(0, max);
}

/** Detail values kept small and plain: no secret-looking key survives, strings are scrubbed, depth and size are limited. */
export function safeDetails(d: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!d) return null;
  const walk = (v: unknown, depth: number): unknown => {
    if (v == null || typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "string") return scrub(v, 200);
    if (v instanceof Date) return v.toISOString();
    if (depth >= 2) return "[nested]";
    if (Array.isArray(v)) return v.slice(0, 20).map((x) => walk(x, depth + 1));
    if (typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 30).map(([k, x]) => [k.slice(0, 40), SECRET_KEY.test(k) ? "[hidden]" : walk(x, depth + 1)]));
    return cut(v, 50);
  };
  const out = walk(d, 0) as Record<string, unknown>;
  const text = JSON.stringify(out);
  return text.length > 2000 ? { truncated: true, size: text.length } : out;
}

/**
 * The framework's own signals are not failures and must not be logged as such: redirect(), notFound() and forbidden() work by throwing, and while Next test-renders a
 * route during the build it rejects dynamic reads ("During prerendering ... rejects"). Rethrow these untouched.
 */
export function isFrameworkSignal(e: unknown): boolean {
  const x = e as { digest?: unknown; message?: unknown } | null;
  const digest = typeof x?.digest === "string" ? x.digest : "";
  if (/^(NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND|DYNAMIC_SERVER_USAGE|HANGING_PROMISE_REJECTION|BAILOUT_TO_CLIENT_SIDE_RENDERING)/.test(digest)) return true;
  return typeof x?.message === "string" && /^During prerendering|Dynamic server usage|Route .* couldn't be rendered statically/i.test(x.message);
}

export function describeError(e: unknown): { cls: string | null; message: string | null; digest: string | null } {
  if (e == null) return { cls: null, message: null, digest: null };
  const x = e as { name?: string; message?: string; digest?: string; code?: string };
  const cls = [x.name && x.name !== "Error" ? x.name : "Error", x.code].filter(Boolean).join(" ");
  return { cls: cut(cls, 80), message: scrub(typeof e === "string" ? e : x.message ?? String(e)), digest: x.digest ? cut(x.digest, 40) : null };
}

// ---- writing ---------------------------------------------------------------------------------------------------------------------------------------------------
/** Writes one row. Never throws. */
export async function record(driver: Driver, e: ActivityEntry, ctx: RequestContext): Promise<void> {
  try {
    const err = describeError(e.error);
    const c = { ...ctx, ...(e.context ?? {}) };
    await withPlatform(driver, (q) => q.query(
      `insert into public.activity_log(kind, name, outcome, actor_id, subject, tenant_id, role, request_id, path, method, status, duration_ms, ip, user_agent, error_class, error_message, error_digest, details)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [e.kind, cut(e.name, 120), e.outcome, e.actorId ?? null, e.subject ? cut(e.subject, 120) : null, e.tenantId ?? null, e.role ? cut(e.role, 40) : null,
        c.requestId ? cut(c.requestId, 80) : null, cut(e.path ?? c.path ?? "", 200) || null, cut(e.method ?? c.method ?? "", 10) || null, e.status ?? null,
        e.durationMs == null ? null : Math.round(e.durationMs), c.ip ? cut(c.ip, 60) : null, c.userAgent ? cut(c.userAgent, 160) : null,
        err.cls, err.message, e.errorDigest ?? err.digest, JSON.stringify(safeDetails(e.details))]));
  } catch (x) {
    console.error(`activity-log: could not write an entry (${(x as { code?: string })?.code ?? (x instanceof Error ? x.name : "error")})`);
  }
}

/** The same answer for the same person, so a log can be searched for one account without reading anyone's address. */
export const fingerprint = (value: string) => createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 12);

/**
 * Times one step of a background job and logs how it ended, ok or error (the error is rethrown). `details` turns the result into the few counts worth keeping.
 * Needs the driver because a job runs outside any request. Never throws on its own account.
 */
export async function timedJob<T>(driver: Driver, name: string, work: () => Promise<T>, details?: (r: T) => Record<string, unknown>): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await work();
    await record(driver, { kind: "job", name, outcome: "ok", durationMs: Date.now() - t0, details: details ? details(r) : undefined }, NO_CONTEXT);
    return r;
  } catch (error) {
    await record(driver, { kind: "job", name, outcome: "error", durationMs: Date.now() - t0, error }, NO_CONTEXT);
    throw error;
  }
}

/** How long the log is kept. A company's data changes are kept as long as the company is (audit_log); this is only the record of what the software did. */
export const ACTIVITY_RETENTION_DAYS = 400;

/** Clears entries past the retention period. Returns how many went. The database refuses any other way of removing a row. */
export async function purgeActivityLog(driver: Driver, keepDays = Number(process.env.ACTIVITY_RETENTION_DAYS) || ACTIVITY_RETENTION_DAYS): Promise<number> {
  try {
    return await withPlatform(driver, async (q) => Number((await q.query<{ n: string }>("select public.purge_activity_log($1)::text as n", [Math.max(30, Math.floor(keepDays))])).rows[0].n));
  } catch (e) {
    if ((e as { code?: string })?.code === "42883") return 0;       // the log's migration has not been applied yet: nothing to clear, and the daily job must go on
    throw e;
  }
}
