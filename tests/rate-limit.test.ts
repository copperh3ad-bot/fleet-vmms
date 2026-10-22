import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDriver } from "./helpers";
import { withPlatform } from "@/lib/db/tenant";
import { allowShared, resetRateLimits } from "@/lib/rate-limit";
import { ForbiddenError } from "@/lib/auth/can";
import type { Driver } from "@/lib/db/types";

let d: Awaited<ReturnType<typeof testDriver>>;
beforeAll(async () => { d = await testDriver(); });
beforeEach(() => resetRateLimits());

const key = () => `k-${Math.random().toString(36).slice(2)}`;
const rows = () => withPlatform(d, async (q) => (await q.query<{ key: string; hits: number }>("select key, hits from public.rate_limits")).rows);

describe("shared rate limit", () => {
  it("allows up to the limit in a window, then refuses", async () => {
    const k = key();
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await allowShared(d, k, 4, 600));
    expect(results).toEqual([true, true, true, true, false, false]);
  });

  it("keeps different keys apart", async () => {
    const a = key(), b = key();
    for (let i = 0; i < 3; i++) await allowShared(d, a, 3, 600);
    expect(await allowShared(d, a, 3, 600)).toBe(false);
    expect(await allowShared(d, b, 3, 600)).toBe(true);
  });

  it("counts requests that arrive at the same moment exactly", async () => {
    const k = key();
    const r = await Promise.all(Array.from({ length: 25 }, () => allowShared(d, k, 5, 600)));
    expect(r.filter(Boolean)).toHaveLength(5);
  });

  it("starts a fresh count in the next window", async () => {
    const k = key();
    expect(await allowShared(d, k, 1, 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 1100));
    expect(await allowShared(d, k, 1, 1)).toBe(true);
  });

  it("stores only a hash of the key, never an email address or an IP", async () => {
    const k = "login-email:someone@example.com";
    await allowShared(d, k, 3, 600);
    const all = await rows();
    expect(all.length).toBeGreaterThan(0);
    expect(JSON.stringify(all)).not.toContain("someone");
    expect(all.every((r) => /^[0-9a-f]{32}$/.test(r.key))).toBe(true);
  });

  it("falls back to a per-process count when the database is unreachable", async () => {
    const down: Driver = { transaction: async () => { throw new Error("connection refused"); } };
    const k = key();
    expect([await allowShared(down, k, 2, 600), await allowShared(down, k, 2, 600), await allowShared(down, k, 2, 600)]).toEqual([true, true, false]);
  });

  it("refuses a nonsense limit in the database", async () => {
    await expect(withPlatform(d, (q) => q.query("select public.rate_limit_hit('x', 0, 60)"))).rejects.toThrow(/invalid rate limit/);
    await expect(withPlatform(d, (q) => q.query("select public.rate_limit_hit('x', 5, 0)"))).rejects.toThrow(/invalid rate limit/);
  });

  it("is not callable by everyone: no grant to PUBLIC", async () => {
    const acl = await withPlatform(d, async (q) => (await q.query<{ acl: string | null }>("select proacl::text as acl from pg_proc where proname = 'rate_limit_hit'")).rows[0].acl);
    expect(acl === null ? "" : acl).not.toMatch(/(^|[{,])=X?\//);   // an entry that starts with "=" is a grant to PUBLIC
  });
});

describe("friendly refusal", () => {
  it("a forbidden error carries the marker that makes Next show the 'not allowed' page", () => {
    const e = new ForbiddenError("vehicle.write");
    expect(e.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;403");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("forbidden: vehicle.write");
  });
});
