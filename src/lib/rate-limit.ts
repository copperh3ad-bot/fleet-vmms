// Small in-memory sliding-window limiter. It is per server process, so it slows down guessing and button-mashing
// but is not a hard global limit; Phase 9 moves it to shared storage.
const hits = new Map<string, number[]>();

/** True if the call is allowed. Records the hit. */
export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) { hits.set(key, recent); return false; }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
  return true;
}

export function resetRateLimits() { hits.clear(); }
