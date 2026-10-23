import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";

// Every tenant table that holds business data must write to audit_log, so a change can always be traced to a person.
// A table can be left out only by being listed here WITH the reason. A new table fails this test until someone decides.
const NOT_AUDITED: Record<string, string> = {
  audit_log: "it is the log itself",
  schema_migrations: "written by the migration tool, not by the application",
  job_card_events: "append-only history that is its own audit trail",
  notifications: "messages, high volume, rebuilt from the changes that caused them",
  document_reminders: "bookkeeping written only by the reminder job, no business decision",
  policy_readings: "a draft: text found in an uploaded policy; the rules a person applies from it are audited as settings changes",
};

let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: "00000000-0000-0000-0000-000000000001", ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
});

describe("audit coverage", () => {
  it("every tenant table is audited or explicitly excused", async () => {
    const rows = await withTenant(d, { schema: t.schema, userId: "00000000-0000-0000-0000-000000000001", role: "tenant_admin" }, async (q) =>
      (await q.query<{ t: string; audited: boolean }>(
        `select c.relname as t, exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname like '%\\_audit') as audited
           from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = current_schema() and c.relkind = 'r' order by 1`)).rows);
    const missing = rows.filter((r) => !r.audited && !(r.t in NOT_AUDITED)).map((r) => r.t);
    expect(missing, `tables with no audit trigger and no reason: ${missing.join(", ")}`).toEqual([]);
    const stale = Object.keys(NOT_AUDITED).filter((k) => !rows.some((r) => r.t === k));
    expect(stale, "excused tables that no longer exist").toEqual([]);
    const wronglyExcused = rows.filter((r) => r.audited && r.t in NOT_AUDITED).map((r) => r.t);
    expect(wronglyExcused, "excused but actually audited, remove from the list").toEqual([]);
  });
});
