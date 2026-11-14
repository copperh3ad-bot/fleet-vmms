// Writes every record of the simulated company to one Excel workbook, one sheet per kind, with names instead of ids, so the whole run can be reviewed.
// Usage: npx tsx sim/export-entries.mts [run folder under sim/out, default run6]   (reads the database named by SIM_DB, default fleet_sim, on the local socket)
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import ExcelJS from "exceljs";

const run = process.argv[2] ?? "run6";
const dir = path.join("sim", "out", run);
const client = new pg.Client({ host: process.env.E2E_PGHOST ?? "/tmp", database: process.env.SIM_DB ?? "fleet_sim" });
await client.connect();
const schema = (await client.query("select schema_name from public.tenants where slug = 'sim60'")).rows[0].schema_name as string;
await client.query(`set search_path = "${schema}", public`);

const SHEETS: [string, string][] = [
  ["Job cards", `select j.job_no, j.status, j.created_at::date as raised_on, v.registration_no as vehicle, e.full_name as requested_by, j.source, j.category, j.priority, j.cause_text,
      w.name as workshop, j.estimated_cost, j.repeat_payer, j.repeat_payer_reason, j.closed_at::date as closed_on
    from job_cards j join vehicles v on v.id = j.vehicle_id left join employees e on e.user_id = j.requested_by left join vendors w on w.id = j.vendor_id order by j.job_no`],
  ["Workshop estimates", `select j.job_no, w.name as workshop, q.status, q.amount, q.days_needed, q.warranty_months, q.created_at::date as received_on from quotations q
    join job_cards j on j.id = q.job_card_id join vendors w on w.id = q.vendor_id order by j.job_no, q.amount`],
  ["Workshop invoices", `select j.job_no, w.name as workshop, i.invoice_no, i.invoice_date, i.amount, i.tax_amount, i.payable_amount, i.status, i.decision, i.decision_note, c.full_name as checked_by, i.verified_at::date as checked_on
    from invoices i join work_orders o on o.id = i.work_order_id join job_cards j on j.id = o.job_card_id left join vendors w on w.id = j.vendor_id left join employees c on c.user_id = i.verified_by order by j.job_no`],
  ["Payments", `select p.payment_no, case when p.invoice_id is not null then 'workshop' else 'logistics provider' end as kind, coalesce(i.invoice_no, ti.invoice_no) as invoice_no, p.amount, p.paid_on, p.method, p.reference,
      pb.full_name as paid_by, p.voided_at is not null as voided from invoice_payments p left join invoices i on i.id = p.invoice_id left join trip_invoices ti on ti.id = p.trip_invoice_id
      left join employees pb on pb.user_id = p.paid_by order by p.payment_no`],
  ["Cargo requests", `select c.cargo_no, c.status, c.source, e.full_name as requested_by, c.department, c.description, c.quantity_text, c.weight_kg, c.volume_m3, c.vehicle_type, c.pickup_place, c.drop_place,
      c.pickup_at::date as pickup_on, c.deliver_by::date as deliver_by, t.trip_no, c.created_at::date as requested_on from cargo_requests c left join employees e on e.id = c.requested_by left join trips t on t.id = c.trip_id order by c.cargo_no`],
  ["Trips", `select t.trip_no, t.status, t.kind, t.purpose, t.from_place, t.to_place, t.start_at::date as start_on, e.full_name as requested_by, d.full_name as decided_by, v.name as logistics_provider, t.award_amount
    from trips t left join employees e on e.id = t.requested_by left join employees d on d.user_id = t.decided_by left join vendors v on v.id = t.outsourced_vendor_id order by t.trip_no`],
  ["Provider quotes", `select t.trip_no, v.name as provider, q.status, q.amount, q.vehicle_text, q.valid_until, q.requested_at::date as asked_on, q.quoted_at::date as quoted_on from trip_quotes q
    join trips t on t.id = q.trip_id join vendors v on v.id = q.vendor_id order by t.trip_no, q.amount nulls last`],
  ["Provider invoices", `select t.trip_no, v.name as provider, i.invoice_no, i.invoice_date, i.amount, i.payable, i.status, i.decision_note, c.full_name as checked_by from trip_invoices i
    join trips t on t.id = i.trip_id join vendors v on v.id = i.vendor_id left join employees c on c.user_id = i.verified_by order by t.trip_no, i.submitted_at`],
  ["Odometer readings", `select v.registration_no as vehicle, r.reading_km, r.read_at::date as read_on, r.source, r.status, r.flag_reason from odometer_readings r join vehicles v on v.id = r.vehicle_id order by v.registration_no, r.read_at`],
  ["Papers", `select v.registration_no as vehicle, x.doc_type, x.reference, x.issued_by, x.valid_from, x.expires_on from (
      select vehicle_id, doc_type, reference, issued_by, valid_from, expires_on from compliance_docs
      union all select vehicle_id, 'insurance', policy_no, insurer, valid_from, valid_to from insurance_policies) x join vehicles v on v.id = x.vehicle_id order by v.registration_no, x.doc_type, x.expires_on`],
  ["Paper reminders", `select r.entity_type, r.days_before, r.sent_at::date as sent_on, coalesce(c.reference, p.policy_no) as reference, v.registration_no as vehicle, coalesce(c.expires_on, p.valid_to) as expires_on
    from document_reminders r left join compliance_docs c on c.id = r.entity_id left join insurance_policies p on p.id = r.entity_id left join vehicles v on v.id = coalesce(c.vehicle_id, p.vehicle_id) order by r.sent_at, v.registration_no`],
  ["Accidents", `select a.occurred_at::date as on_date, v.registration_no as vehicle, e.full_name as driver, a.location, a.severity, a.fault, a.insurance_claim, j.job_no as linked_job_card, a.description
    from accidents a join vehicles v on v.id = a.vehicle_id left join employees e on e.id = a.employee_id left join job_cards j on j.id = a.job_card_id order by a.occurred_at`],
  ["Challans", `select c.reference, c.issued_on, v.registration_no as vehicle, e.full_name as driver, c.violation, c.amount, c.status, c.paid_on from challans c join vehicles v on v.id = c.vehicle_id left join employees e on e.id = c.employee_id order by c.issued_on`],
  ["Vehicle requests", `select r.request_no, r.status, f.full_name as for_employee, r.reason, r.vehicle_class, r.needed_from, r.decision_note, r.created_at::date as raised_on from vehicle_requests r left join employees f on f.id = r.for_employee order by r.request_no`],
  ["Vehicles", `select registration_no, make, model, department, odometer_km, load_capacity_kg, load_volume_m3, status from vehicles order by registration_no`],
  ["People", `select e.employee_no, e.full_name, e.department, e.phone, e.email, coalesce(m.role, '') as role from employees e left join public.tenant_memberships m on m.user_id = e.user_id order by e.employee_no`],
  ["Workshops and providers", `select name, kind, phone, email from vendors order by kind, name`],
  ["Notifications by kind", `select kind, count(*) as how_many from notifications group by kind order by 2 desc`],
  ["Change log by table", `select table_name, action, count(*) as how_many from audit_log group by 1, 2 order by 3 desc`],
];

const wb = new ExcelJS.Workbook();
const cell = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);
for (const [name, sql] of SHEETS) {
  const res = await client.query(sql);
  const ws = wb.addWorksheet(name.slice(0, 31));
  ws.columns = res.fields.map((f) => ({ header: f.name.replace(/_/g, " "), key: f.name, width: Math.min(40, Math.max(12, f.name.length + 2)) }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: res.fields.length } };
  for (const r of res.rows) ws.addRow(Object.fromEntries(res.fields.map((f) => [f.name, cell(r[f.name])])));
  console.log(`${name}: ${res.rowCount} rows`);
}
// what the simulation itself did, and what it wrote to its mail and WhatsApp files
const lines = (f: string) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const emails = lines("email.jsonl"), wa = lines("whatsapp.jsonl"), ledger = lines("ledger.jsonl");
const add = (name: string, rows: Record<string, unknown>[]) => { const ws = wb.addWorksheet(name); if (!rows.length) return; const keys = Object.keys(rows[0]); ws.columns = keys.map((k) => ({ header: k, key: k, width: 24 })); ws.getRow(1).font = { bold: true }; ws.views = [{ state: "frozen", ySplit: 1 }]; for (const r of rows) ws.addRow(r); console.log(`${name}: ${rows.length} rows`); };
add("Emails written", emails.map((e) => ({ to: e.to, subject: e.subject, first_line: String(e.text ?? "").split("\n")[0] })));
add("WhatsApp written", wa.map((w) => ({ to: w.to ?? w.phone ?? "", template: w.template ?? w.name ?? "", params: JSON.stringify(w.params ?? w.parameters ?? "") })));
const by = new Map<string, { calls: number; failed: number }>();
for (const l of ledger) { const x = by.get(l.op) ?? { calls: 0, failed: 0 }; x.calls++; if (!l.ok) x.failed++; by.set(l.op, x); }
add("Operations by kind", [...by.entries()].map(([op, v]) => ({ operation: op, calls: v.calls, refused_or_failed: v.failed })).sort((a, b) => b.calls - a.calls));
add("Operation log (every call)", ledger.map((l) => ({ day: l.day + 1, operation: l.op, actor: l.actor, reference: l.ref ?? "", ms: l.ms, ok: l.ok, error: l.err ?? "" })));
const out = path.join(dir, "all-entries.xlsx");
await wb.xlsx.writeFile(out);
console.log(`written: ${out}`);
await client.end();
