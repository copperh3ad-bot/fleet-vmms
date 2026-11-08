// The activity log inside a web request (ADR-070). The plain parts (scrubbing, writing a row, jobs) are in ./core, which has no dependency on Next.js, so a scheduled
// function can use them without carrying the framework. This file adds the request: who is calling, from where, and writing after the response has gone.
import type { Driver } from "@/lib/db/types";
import { NO_CONTEXT, record, type ActivityEntry, type RequestContext } from "./core";

export * from "./core";

/** Where this request came from, if there is a request. The proxy sets x-fleet-path and x-fleet-rid on every request it forwards, so a browser cannot choose them. */
export async function currentRequest(): Promise<RequestContext> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const ref = h.get("referer");
    let refPath: string | null = null;
    try { refPath = ref ? new URL(ref).pathname : null; } catch { /* not a URL */ }
    return {
      requestId: h.get("x-fleet-rid") ?? h.get("x-nf-request-id"),
      path: h.get("x-fleet-path") ?? refPath,
      method: null,
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
      userAgent: h.get("user-agent"),
    };
  } catch {
    return NO_CONTEXT;                                   // not inside a request: a script, a test
  }
}

/**
 * Logs one entry for the current request. Inside a request the write finishes after the response has gone (Next's after()), so the log never slows a page down;
 * anywhere else it is awaited. Never throws.
 */
export async function logActivity(e: ActivityEntry, driver?: Driver): Promise<void> {
  try {
    if (process.env.NEXT_PHASE === "phase-production-build") return;       // Next test-renders pages while building: that is not activity
    const d = driver ?? (await defaultDriver());
    if (!d) return;
    const ctx = e.context ? NO_CONTEXT : await currentRequest();
    const write = record(d, e, ctx);
    try {
      const { after } = await import("next/server");
      after(() => write);
    } catch {
      await write;
    }
  } catch { /* the log must never break the work it describes */ }
}

async function defaultDriver(): Promise<Driver | null> {
  if (!process.env.DATABASE_URL || process.env.VITEST) return null;      // tests pass their own driver and never write to a real database
  const { getDriver } = await import("@/lib/db");
  return getDriver();
}
