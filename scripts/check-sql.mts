// Applies platform + tenant template SQL to an in-memory Postgres (PGlite) and runs smoke checks.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

const db = new PGlite();
const platform = readFileSync("db/public/0001_platform.sql", "utf8").replace(/create extension if not exists pgcrypto;/, "");
const tenant = readdirSync("db/tenant-template").filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(`db/tenant-template/${f}`, "utf8")).join("\n");

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

// ---- Preventive maintenance (oil change every 3 months) ----
const V = (n: number) => `00000000-0000-0000-0000-0000000001${String(n).padStart(2, "0")}`;
await db.exec(`
  insert into vehicles(id, registration_no, odometer_km) values
    ('${V(1)}','PM-OK',1000), ('${V(2)}','PM-SOON',1000), ('${V(3)}','PM-OVER',1000),
    ('${V(4)}','PM-NONE',1000), ('${V(5)}','PM-JOB',1000), ('${V(6)}','PM-DONE',1000), ('${V(7)}','PM-KM',5700);
  insert into vehicle_service_baselines(vehicle_id, service_type_key, last_done_on, last_odometer_km) values
    ('${V(1)}','oil_change', current_date - 10, 500),
    ('${V(2)}','oil_change', current_date - 80, 500),
    ('${V(3)}','oil_change', current_date - 100, 500),
    ('${V(5)}','oil_change', current_date - 100, 500),
    ('${V(7)}','oil_change', current_date - 10, 1000);
`);
// Vehicle 5: overdue but a job card for the oil change is already in flight -> scheduled.
const mgr = "00000000-0000-0000-0000-000000000002", req = "00000000-0000-0000-0000-000000000001";
async function jobWithOil(vehicle: string, id: string) {
  await db.exec(`insert into job_cards(id, vehicle_id, requested_by, reason_code_id, cause_text, odometer_km, category)
    values ('${id}','${vehicle}','${req}','${rc}','Routine oil change due','1000','preventive');
    insert into job_card_lines(job_card_id, kind, description, service_type_key) values ('${id}','service','Engine oil + filter','oil_change');`);
}
await jobWithOil(V(5), "00000000-0000-0000-0000-0000000002e5");
await db.exec(`update job_cards set status='submitted' where id='00000000-0000-0000-0000-0000000002e5'`);
// Vehicle 6: baseline is old, but a completed oil-change job card resets the clock.
await db.exec(`insert into vehicle_service_baselines values ('${V(6)}','oil_change', current_date - 200, 100)`);
await jobWithOil(V(6), "00000000-0000-0000-0000-0000000002e6");
for (const s of ["submitted", "approved", "vendor_assigned", "quotation_received", "quotation_approved", "in_progress", "completed"]) {
  await db.exec(`update job_cards set status='${s}'${s === "approved" ? `, approved_by='${mgr}'` : ""} where id='00000000-0000-0000-0000-0000000002e6'`);
}
// Vehicle 7: 4700 km run on a 5000 km rule (300 km left), 500 km warning -> due_soon by distance even though date is fine.
await db.exec(`update service_types set interval_km = 5000 where key = 'oil_change'`);

const st = Object.fromEntries(
  (await db.query<{ registration_no: string; pm_status: string }>("select registration_no, pm_status from v_pm_status")).rows
    .map((r) => [r.registration_no, r.pm_status]),
);
const expected: Record<string, string> = {
  "PM-OK": "ok", "PM-SOON": "due_soon", "PM-OVER": "overdue", "PM-NONE": "no_history",
  "PM-JOB": "scheduled", "PM-DONE": "ok", "PM-KM": "due_soon",
};
for (const [reg, want] of Object.entries(expected)) {
  const got = st[reg];
  if (got === want) console.log(`ok   pm ${reg}: ${got}`);
  else { console.log(`FAIL pm ${reg}: expected ${want}, got ${got}`); process.exitCode = 1; }
}
