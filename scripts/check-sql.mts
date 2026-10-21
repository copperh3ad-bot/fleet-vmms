// Applies platform + tenant template SQL to an in-memory Postgres (PGlite) and runs smoke checks.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
const platform = readFileSync("db/public/0001_platform.sql", "utf8").replace(/create extension if not exists pgcrypto;/, "");
const tenant = readFileSync("db/tenant-template/0001_core.sql", "utf8");

await db.exec(platform);
for (const s of ["tenant_a", "tenant_b"]) {
  await db.exec(`create schema ${s}; set search_path = ${s}, public;`);
  await db.exec(tenant);
  await db.exec(tenant); // idempotency
}
await db.exec("set search_path = tenant_a, public;");

await db.exec(`
  insert into employees(id, full_name) values
    ('00000000-0000-0000-0000-000000000001','Requester'),
    ('00000000-0000-0000-0000-000000000002','Manager');
  insert into vehicles(id, registration_no) values ('00000000-0000-0000-0000-0000000000a1','KAA-123');
`);
const rc = (await db.query<{ id: string }>("select id from reason_codes where code='WEAR_BRAKES'")).rows[0].id;
await db.exec(`insert into job_cards(id, vehicle_id, requested_by, reason_code_id, cause_text)
  values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1',
          '00000000-0000-0000-0000-000000000001','${rc}','Brakes squealing for two weeks');`);

async function expectFail(label: string, sql: string) {
  try { await db.exec(sql); console.log("FAIL (should have errored):", label); process.exitCode = 1; }
  catch { console.log("ok   blocked:", label); }
}
await db.exec("update job_cards set status='submitted'");
await expectFail("illegal transition submitted->closed", "update job_cards set status='closed'");
await expectFail("self-approval", "update job_cards set approved_by='00000000-0000-0000-0000-000000000001'");
await expectFail("short cause_text", `insert into job_cards(vehicle_id, requested_by, reason_code_id, cause_text) values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','${rc}','short')`);
await expectFail("audit_log update", "update audit_log set action='INSERT'");
await db.exec("update job_cards set status='approved', approved_by='00000000-0000-0000-0000-000000000002'");

const audit = (await db.query("select count(*)::int n from audit_log")).rows[0] as { n: number };
console.log("ok   audit rows:", audit.n);
await db.query("select * from v_vehicle_maintenance_summary");
await db.query("select * from v_repeat_repairs");
await db.query("select * from v_budget_utilisation");
const b = (await db.query("select count(*)::int n from tenant_b.vehicles")).rows[0] as { n: number };
console.log("ok   tenant_b isolated, vehicles:", b.n);
console.log("ok   views query");
