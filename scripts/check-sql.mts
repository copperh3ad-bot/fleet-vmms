// Applies platform + tenant template SQL to an in-memory Postgres (PGlite) and runs smoke checks.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

const db = new PGlite();
const platform = readFileSync("db/public/0001_platform.sql", "utf8").replace(/create extension if not exists pgcrypto;/, "");
const tenant = readdirSync("db/tenant-template").filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(`db/tenant-template/${f}`, "utf8"));

await db.exec(platform);
for (const s of ["tenant_a", "tenant_b"]) {
  await db.exec(`create schema ${s}; set search_path = ${s}, public;`);
  for (const sql of tenant) {
    await db.exec(sql);
    await db.exec(sql); // each migration must be idempotent on its own
  }
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

// ---- Odometer: tracker, validation, monthly cycle ----
const T = (n: number) => `00000000-0000-0000-0000-0000000003${String(n).padStart(2, "0")}`;
const km = async (id: string) => Number((await db.query<{ odometer_km: string }>("select odometer_km from vehicles where id=$1", [id])).rows[0].odometer_km);
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) console.log(`ok   ${label}`); else { console.log(`FAIL ${label} ${detail}`); process.exitCode = 1; }
};
await db.exec(`
  insert into vehicles(id, registration_no) values
    ('${T(1)}','OD-1'), ('${T(2)}','OD-2'), ('${T(3)}','OD-3-TRACKED'), ('${T(4)}','OD-4');
  insert into tracker_integrations(provider, enabled, secret_ref) values ('demo', true, 'TRACKER_DEMO_KEY');
  insert into vehicle_trackers(vehicle_id, provider, device_ref, last_sync_at) values ('${T(3)}','demo','DEV-1', now());
`);
const ins = (v: string, k: number, daysAgo: number, src: string) => db.query(
  `insert into odometer_readings(vehicle_id, reading_km, read_at, source) values ($1,$2, now() - ($3 || ' days')::interval, $4) returning id, status, flag_reason`,
  [v, k, String(daysAgo), src]);
const r1 = (await ins(T(1), 1000, 40, "manual")).rows[0] as { status: string };
const r2 = (await ins(T(1), 1900, 30, "tracker")).rows[0] as { status: string };
const r3 = (await ins(T(1), 1500, 20, "tracker")).rows[0] as { id: string; status: string; flag_reason: string };
const r4 = (await ins(T(1), 50000, 10, "tracker")).rows[0] as { status: string; flag_reason: string };
check("normal readings accepted", r1.status === "accepted" && r2.status === "accepted");
check("lower reading flagged", r3.status === "flagged" && r3.flag_reason === "lower_than_previous");
check("impossible jump flagged", r4.status === "flagged" && r4.flag_reason === "implausible_jump");
check("flagged readings do not move the odometer", (await km(T(1))) === 1900, String(await km(T(1))));
await db.query("update odometer_readings set status='accepted' where id=$1", [r3.id]);
check("accepting a flagged reading applies it", (await km(T(1))) === 1500, String(await km(T(1))));
const fresh = (await db.query<{ freshness: string; flagged_readings: number }>("select freshness, flagged_readings from v_odometer_status where vehicle_id=$1", [T(1)])).rows[0];
check("status view: fresh with 1 flagged left", fresh.freshness === "fresh" && fresh.flagged_readings === 1, JSON.stringify(fresh));

await ins(T(4), 3000, 5, "manual");
const mgrId = "00000000-0000-0000-0000-00000000aaaa";
const cycle = (await db.query<{ open_odometer_cycle: string }>("select open_odometer_cycle(current_date, current_date + 7, $1)", [mgrId])).rows[0].open_odometer_cycle;
const subs = (await db.query<{ id: string; vehicle_id: string }>("select id, vehicle_id from odometer_submissions where cycle_id=$1", [cycle])).rows;
const sub = (v: string) => subs.find((s) => s.vehicle_id === v)?.id as string;
check("cycle skips vehicle with a fresh tracker", !sub(T(3)) && !!sub(T(2)) && !!sub(T(4)));
await expectFail("second cycle for the same month", `select open_odometer_cycle(current_date, current_date + 7)`);
await db.query("select submit_odometer($1, 2500, $2, 'dashboard photo attached')", [sub(T(2)), mgrId]);
await db.query("select approve_odometer_submission($1, $2)", [sub(T(2)), mgrId]);
check("approved monthly reading updates the vehicle", (await km(T(2))) === 2500, String(await km(T(2))));
await db.query("select submit_odometer($1, 2000, $2)", [sub(T(4)), mgrId]);
await expectFail("approving a lower reading without a note", `select approve_odometer_submission('${sub(T(4))}', '${mgrId}')`);
await db.query("select approve_odometer_submission($1, $2, 'odometer cluster replaced, confirmed with workshop')", [sub(T(4)), mgrId]);
check("override with a note is applied", (await km(T(4))) === 2000, String(await km(T(4))));
await expectFail("submit into an already approved row", `select submit_odometer('${sub(T(2))}', 2600, '${mgrId}')`);
await db.exec(`insert into job_cards(vehicle_id, requested_by, reason_code_id, cause_text, odometer_km)
  values ('${T(2)}','${req}','${rc}','Odometer captured on job card',2600)`);
check("job card odometer becomes a reading", (await km(T(2))) === 2600, String(await km(T(2))));
const stale = (await db.query<{ km_data_stale: boolean }>("select km_data_stale from v_pm_status where registration_no='PM-KM'")).rows[0];
check("PM view marks a never-updated odometer as stale", stale.km_data_stale === true);
