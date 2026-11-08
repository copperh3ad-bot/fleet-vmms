// The activity log (ADR-070): what is written, what is kept out, that nobody can change or delete a row, and that only the operator can read it.
import { beforeAll, describe, expect, it } from "vitest";
import { newControl } from "./helpers";
import { withPlatform } from "@/lib/db/tenant";
import { NO_CONTEXT, purgeActivityLog, record, safeDetails, scrub, timedJob, describeError } from "@/lib/activity/core";
import { judge } from "@/lib/activity/auth";
import { outcomeOfStatus, loggedRoute } from "@/lib/activity/route";
import { listActivity, activityCsv, whereOf } from "@/lib/activity/read";
import { OP, NOT_OP } from "./billing-harness";

let d: Awaited<ReturnType<typeof newControl>>;
beforeAll(async () => {
  d = await newControl();
  await d.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("insert into public.platform_admins(user_id) values ($1)", [OP]); });
});
const rows = (sql = "") => withPlatform(d, async (q) => (await q.query<Record<string, unknown>>(`select * from public.activity_log ${sql} order by id`)).rows);

describe("what is kept out of the log", () => {
  it("takes secrets out of free text", () => {
    const text = "failed for smtps://noreply%40x.com:s3cretPass@smtp.zoho.com with Bearer abcdefghijklmnop and eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdEFGHijkl and sb_secret_abcdefghijkl and 0123456789abcdef0123456789abcdef0123";
    const out = scrub(text, 1000);
    for (const bad of ["s3cretPass", "abcdefghijklmnop", "eyJhbGci", "sb_secret_abcdefghijkl", "0123456789abcdef0123456789abcdef"]) expect(out).not.toContain(bad);
  });
  it("hides detail values under secret-looking names, at any depth", () => {
    const d1 = safeDetails({ password: "hunter2", note: "fine", nested: { api_key: "k", token: "t", ok: 1 }, list: [{ otp: "123456" }] })!;
    const text = JSON.stringify(d1);
    expect(text).not.toMatch(/hunter2|"k"|"t"|123456/);
    expect(text).toContain("fine");
  });
  it("cuts oversized details instead of storing them", () => {
    expect(safeDetails({ big: "x".repeat(150), a: Array.from({ length: 30 }, (_, i) => "y".repeat(190) + i) })).toMatchObject({ truncated: true });
  });
  it("describes an error by its class and a scrubbed message", () => {
    const e = Object.assign(new Error("duplicate key for token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdEFGHijkl"), { code: "23505", digest: "d123" });
    const x = describeError(e);
    expect(x.cls).toBe("Error 23505"); expect(x.digest).toBe("d123"); expect(x.message).not.toContain("eyJhbGci");
  });
});

describe("writing and protecting the log", () => {
  it("writes a row with who, what, outcome and the scrubbed error", async () => {
    await record(d, { kind: "action", name: "saveVehicleAction", outcome: "error", actorId: OP, role: "tenant_admin", durationMs: 12.6, error: new Error("boom Bearer abcdefghijklmnop"), details: { password: "x", n: 1 } },
      { ...NO_CONTEXT, requestId: "req-1", path: "/w/acme/vehicles", ip: "203.0.113.4", userAgent: "test" });
    const [r] = await rows(`where request_id = 'req-1'`);
    expect(r).toMatchObject({ kind: "action", name: "saveVehicleAction", outcome: "error", actor_id: OP, role: "tenant_admin", duration_ms: 13, path: "/w/acme/vehicles", ip: "203.0.113.4" });
    expect(String(r.error_message)).not.toContain("abcdefghijklmnop");
    expect(JSON.stringify(r.details)).not.toContain('"x"');
  });
  it("never throws, even when the database refuses", async () => {
    await expect(record(d, { kind: "action", name: "x", outcome: "bogus" as never }, NO_CONTEXT)).resolves.toBeUndefined();
  });
  it("cannot be changed", async () => {
    await expect(withPlatform(d, (q) => q.query("update public.activity_log set name = 'edited'"))).rejects.toThrow(/cannot be changed/);
  });
  it("cannot be deleted from, except by the purge", async () => {
    await expect(withPlatform(d, (q) => q.query("delete from public.activity_log"))).rejects.toThrow(/cannot be deleted/);
  });
  it("the purge clears only entries past the retention period, and always keeps 30 days", async () => {
    await withPlatform(d, async (q) => {
      await q.query("set local app.activity_purge = 'on'");           // test set-up only: backdate two rows the way time would
      await q.query("alter table public.activity_log disable trigger activity_log_guard");
      await q.query("insert into public.activity_log(at, kind, name, outcome) values (now() - interval '500 days', 'system', 'old', 'info'), (now() - interval '100 days', 'system', 'middle', 'info')");
      await q.query("alter table public.activity_log enable trigger activity_log_guard");
    });
    expect(await purgeActivityLog(d, 400)).toBe(1);
    expect((await rows(`where name in ('old', 'middle')`)).map((r) => r.name)).toEqual(["middle"]);
    await expect(purgeActivityLog(d, 5)).resolves.toBeGreaterThanOrEqual(0);          // asked for 5, kept at least 30: the 100-day row goes, anything newer stays
    expect((await rows(`where name = 'saveVehicleAction'`)).length).toBe(1);
  });
});

describe("jobs and routes", () => {
  it("timedJob logs the counts and the duration, and rethrows a failure after logging it", async () => {
    await timedJob(d, "document reminders", async () => ({ sent: 3 }), (r) => ({ sent: r.sent }));
    await expect(timedJob(d, "plan switches", async () => { throw new Error("db down"); })).rejects.toThrow("db down");
    const r = await rows(`where kind = 'job'`);
    expect(r.map((x) => `${x.name}:${x.outcome}`)).toEqual(["document reminders:ok", "plan switches:error"]);
    expect(r[0].details).toMatchObject({ sent: 3 });
  });
  it("reads an answer's status as an outcome", () => {
    expect([200, 302, 400, 401, 403, 404, 429, 500].map(outcomeOfStatus)).toEqual(["ok", "ok", "invalid", "denied", "denied", "invalid", "denied", "error"]);
  });
  it("loggedRoute passes the response through untouched", async () => {
    const h = loggedRoute("webhook", "t", async () => new Response("hi", { status: 201 }));
    const res = await (h as unknown as (r: Request) => Promise<Response>)(new Request("https://x.test/api/a"));
    expect(res.status).toBe(201); expect(await res.text()).toBe("hi");
  });
  it("reads an action's answer: a field mistake is invalid, a refusal is denied, anything else worked", () => {
    expect(judge({ error: "Fix it", fields: { a: "b" } }).outcome).toBe("invalid");
    expect(judge({ error: "Too many tries" }).outcome).toBe("denied");
    expect(judge({ ok: "Saved" }).outcome).toBe("ok");
    expect(judge(undefined).outcome).toBe("ok");
  });
});

describe("reading the log", () => {
  it("the operator can read and filter it; anyone else is refused", async () => {
    const all = await listActivity(d, OP, {});
    expect(all.rows.length).toBeGreaterThan(2);
    const errors = await listActivity(d, OP, { outcome: "problem" });
    expect(errors.rows.every((r) => r.outcome === "error" || r.outcome === "denied")).toBe(true);
    const one = await listActivity(d, OP, { q: "saveVehicle" });
    expect(one.rows.map((r) => r.name)).toEqual(["saveVehicleAction"]);
    await expect(listActivity(d, NOT_OP, {})).rejects.toThrow(/Not allowed/);
    await expect(activityCsv(d, NOT_OP, {})).rejects.toThrow(/Not allowed/);
  });
  it("exports a CSV with a header and the rows", async () => {
    const out = await activityCsv(d, OP, { kind: "job" });
    expect(out.rows).toBe(2);
    expect(out.csv).toContain("at,kind,name,outcome");
    expect(out.csv).toContain("document reminders");
  });
  it("ignores a filter it does not understand instead of building SQL from it", () => {
    expect(whereOf({ kind: "x'; drop table y; --", tenant: "not-a-uuid", from: "yesterday" })).toEqual({ sql: "", args: [] });
    expect(whereOf({ q: "100%_x" }).args).toEqual(["%100\\%\\_x%"]);
  });
});
