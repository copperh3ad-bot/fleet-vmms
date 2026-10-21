// Applies platform + tenant template SQL to an in-memory Postgres (PGlite) and runs smoke checks.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

const db = new PGlite();
const platform = readdirSync("db/public").filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(`db/public/${f}`, "utf8").replace(/create extension if not exists pgcrypto;/, "")).join("\n");
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

// ---- Odometer: validation and monthly cycle ('tracker' source value is reserved for the later module) ----
const T = (n: number) => `00000000-0000-0000-0000-0000000003${String(n).padStart(2, "0")}`;
const km = async (id: string) => Number((await db.query<{ odometer_km: string }>("select odometer_km from vehicles where id=$1", [id])).rows[0].odometer_km);
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) console.log(`ok   ${label}`); else { console.log(`FAIL ${label} ${detail}`); process.exitCode = 1; }
};
await db.exec(`
  insert into vehicles(id, registration_no) values
    ('${T(1)}','OD-1'), ('${T(2)}','OD-2'), ('${T(3)}','OD-3'), ('${T(4)}','OD-4');
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
check("cycle covers every active vehicle", !!sub(T(2)) && !!sub(T(3)) && !!sub(T(4)));
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

// ---- Forms alignment: every screen saves what it shows ----
const F = (n: number) => `00000000-0000-0000-0000-0000000004${String(n).padStart(2, "0")}`;
const finUser = "00000000-0000-0000-0000-00000000f001";
await db.exec(`
  insert into employees(id, full_name, user_id) values ('${F(1)}','Driver Imran', null), ('${F(2)}','Finance Sana','${finUser}');
  insert into service_types(key, label, interval_months, applies_to_classes) values ('truck_grease','Truck greasing',2,array['truck']);
`);
// Add a vehicle: one call, everything lands
const vid = (await db.query<{ onboard_vehicle: string }>(`select onboard_vehicle($1::jsonb, $2)`, [JSON.stringify({
  registration_no: "bnk-902", make: "Toyota", model: "Hilux Revo", year: 2022, fuel_type: "diesel", vehicle_class: "pickup",
  odometer_km: 48320, employee_id: F(1), holding_since: "2026-11-01",
  baselines: [{ service_type_key: "oil_change", last_done_on: new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10), last_odometer_km: 44100 }],
  insurance: { insurer: "Jubilee", policy_no: "J-1", valid_from: "2026-01-01", valid_to: "2027-01-01" },
  documents: [{ doc_type: "fitness", expires_on: "2027-03-01", issued_by: "Excise" }],
  budget_amount: 240000, budget_from: "2026-01-01", budget_to: "2026-12-31",
}), finUser])).rows[0].onboard_vehicle;
check("onboard: odometer applied through the reading path", (await km(vid)) === 48320);
check("onboard: custody open", Number((await db.query("select count(*)::int c from vehicle_custody where vehicle_id=$1 and to_date is null", [vid])).rows[0].c) === 1);
check("onboard: oil change has history", (await db.query<{ pm_status: string }>("select pm_status from v_pm_status where vehicle_id=$1 and service_type_key='oil_change'", [vid])).rows[0].pm_status === "ok");
check("onboard: shows in documents list", Number((await db.query("select count(*)::int c from v_documents_status where vehicle_id=$1", [vid])).rows[0].c) === 2);
await expectFail("same plate typed differently", `select onboard_vehicle('{"registration_no":"BNK 902"}'::jsonb)`);
await expectFail("atomic: bad baseline rolls back the vehicle", `select onboard_vehicle('{"registration_no":"ZZZ-1","baselines":[{"service_type_key":"nope","last_done_on":"2026-01-01"}]}'::jsonb)`);
check("atomic: no half-saved vehicle", Number((await db.query("select count(*)::int c from vehicles where registration_no='ZZZ-1'")).rows[0].c) === 0);
check("service rule applies_to: pickup does not get truck greasing", Number((await db.query("select count(*)::int c from v_pm_status where vehicle_id=$1 and service_type_key='truck_grease'", [vid])).rows[0].c) === 0);

// Budgets
await expectFail("overlapping budget", `insert into budgets(vehicle_id, period_start, period_end, amount) values ('${vid}','2026-06-01','2026-12-31',1)`);
await expectFail("raise budget without a reason", `update budgets set amount = 300000 where vehicle_id='${vid}'`);
await db.exec(`update budgets set amount = 300000, reason = 'Added a second route' where vehicle_id='${vid}'`);
check("budget raised with a reason", true);

// Settings
await expectFail("unknown setting", `insert into settings values ('made_up','1')`);
await expectFail("non-numeric setting", `update settings set value='abc' where key='pm_warning_days'`);
await db.exec(`update settings set value='30,14' where key='doc_reminder_days'`);

// Quotation + invoice + finance decision
const reqE = F(1);
const jcId = F(10), woId = F(11), qId = F(12), invId = F(13);
await db.exec(`
  insert into job_cards(id, vehicle_id, requested_by, reason_code_id, cause_text, needed_by)
    values ('${jcId}','${vid}','${reqE}','${rc}','Front brakes grind and pull left', current_date + 3);
`);
const rt = (await db.query<{ requested_reason_code_id: string }>("select requested_reason_code_id from job_cards where id=$1", [jcId])).rows[0].requested_reason_code_id;
const other = (await db.query<{ id: string }>("select id from reason_codes where id <> $1 limit 1", [rc])).rows[0].id;
await db.exec(`update job_cards set reason_code_id='${other}' where id='${jcId}'`);
check("re-tag keeps the requester's reason", (await db.query<{ requested_reason_code_id: string }>("select requested_reason_code_id from job_cards where id=$1", [jcId])).rows[0].requested_reason_code_id === rt);
await db.exec(`insert into vendors(id, name, user_id) values ('${F(20)}','Al-Noor','${F(21)}')`);
await db.exec(`insert into quotations(id, job_card_id, vendor_id, amount) values ('${qId}','${jcId}','${F(20)}',0)`);
await db.exec(`insert into quotation_lines(id, quotation_id, kind, description, qty, unit_cost) values
  ('${F(30)}','${qId}','part','Pads',1,14500), ('${F(31)}','${qId}','labour','Discs',2,2200)`);
check("quotation total follows its lines", Number((await db.query("select amount from quotations where id=$1", [qId])).rows[0].amount) === 18900);
for (const [st, extra] of [["submitted", ""], ["approved", `, approved_by='${F(2)}'`], ["vendor_assigned", `, vendor_id='${F(20)}'`], ["quotation_received", ""], ["quotation_approved", ""], ["in_progress", ""], ["completed", ""]] as const)
  await db.exec(`update job_cards set status='${st}'${extra} where id='${jcId}'`);
await db.exec(`insert into work_orders(id, wo_no, job_card_id, vendor_id, quotation_id, approved_amount) values ('${woId}','WO-T1','${jcId}','${F(20)}','${qId}',18900)`);
await db.exec(`insert into invoices(id, work_order_id, invoice_no, invoice_date, amount) values ('${invId}','${woId}','INV-1',current_date,21400)`);
await db.exec(`insert into invoice_lines(invoice_id, quotation_line_id, kind, description, qty, unit_cost) values
  ('${invId}','${F(30)}','part','Pads',1,14500), ('${invId}','${F(31)}','labour','Discs',2,2200), ('${invId}',null,'part','Rear shoes',1,2500)`);
await db.exec(`update job_cards set status='invoiced' where id='${jcId}'`);
const chk = (await db.query<{ variance: string; unapproved_lines: number }>("select variance, unapproved_lines from v_invoice_check where invoice_id=$1", [invId])).rows[0];
check("invoice check shows variance and the unapproved line", Number(chk.variance) === 2500 && Number(chk.unapproved_lines) === 1, JSON.stringify(chk));
// the approver's employee needs a login for the segregation check to see them
await db.exec(`update employees set user_id='${F(40)}' where id='${F(2)}'`);
await expectFail("approver verifying their own job", `select verify_invoice('${invId}', '${F(40)}', 'pay_approved')`);
await db.exec(`insert into employees(id, full_name, user_id) values ('${F(3)}','Finance Hina','${finUser}') on conflict do nothing`);
await expectFail("pay in full without a note", `select verify_invoice('${invId}', '${finUser}', 'pay_full')`);
await db.exec(`select verify_invoice('${invId}', '${finUser}', 'pay_approved', 'Rear shoes were not approved')`);
const vi = (await db.query<{ payable_amount: string; status: string }>("select payable_amount, status from invoices where id=$1", [invId])).rows[0];
check("pay approved amount only", Number(vi.payable_amount) === 18900 && vi.status === "verified", JSON.stringify(vi));
check("job card moves to invoice_verified", (await db.query<{ status: string }>("select status from job_cards where id=$1", [jcId])).rows[0].status === "invoice_verified");
check("vehicle cost uses the payable amount", Number((await db.query("select cost from v_vehicle_job_cost where job_card_id=$1", [jcId])).rows[0].cost) === 18900);
await db.exec(`select set_config('app.user_id','${F(21)}',false)`);
check("vendor sees own work order", Number((await db.query("select count(*)::int c from v_vendor_work_orders")).rows[0].c) === 1);
await db.exec(`select set_config('app.user_id','${F(99)}',false)`);
check("other users see no vendor orders", Number((await db.query("select count(*)::int c from v_vendor_work_orders")).rows[0].c) === 0);
await db.exec(`select set_config('app.user_id','',false)`);

// Accidents and challans take the driver from custody
await db.exec(`insert into accidents(vehicle_id, occurred_at, description, severity, fault, insurance_claim) values ('${vid}', '2026-11-05 10:00', 'Rear-ended', 'moderate', 'third_party', true)`);
await db.exec(`insert into challans(vehicle_id, issued_on, amount, violation, status) values ('${vid}', '2026-11-10', 3000, 'Signal', 'open')`);
check("accident and challan pick up the custodian", Number((await db.query(`select count(*)::int c from accidents where employee_id='${F(1)}'`)).rows[0].c) === 1 && Number((await db.query(`select count(*)::int c from challans where employee_id='${F(1)}'`)).rows[0].c) === 1);
await db.exec(`update challans set status='paid'`);
check("challan paid date set", Number((await db.query(`select count(*)::int c from challans where paid_on is not null`)).rows[0].c) === 1);
