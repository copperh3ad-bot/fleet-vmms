// Rate limiting for the few pages that are open to the world (sign-in, the odometer link).
//
// allowShared() counts in the database (public.rate_limits, migration platform 0005), so every server shares one
// count. If the database cannot be reached it falls back to a per-process count rather than letting everything
// through or locking everyone out. Keys are hashed before they are stored, so no email address or address is kept.
import { createHash } from "node:crypto";
import type { Driver } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";

const hits = new Map<string, number[]>();

/** In-process sliding window. True if the call is allowed. Records the hit. */
export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) { hits.set(key, recent); return false; }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
  return true;
}

export function resetRateLimits() { hits.clear(); }

const digest = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 32);

/** Shared across servers. `key` is like "login-ip:203.0.113.4"; windows are fixed blocks of `windowSeconds`. */
export async function allowShared(driver: Driver, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const r = await withPlatform(driver, (q) => q.query<{ ok: boolean }>("select public.rate_limit_hit($1, $2, $3) as ok", [digest(key), limit, windowSeconds]));
    return r.rows[0].ok;
  } catch {
    return allow(`fallback:${key}`, limit, windowSeconds * 1000);   // the database is unreachable: still slow people down
  }
}
