// CSV exports. Every export names the permission it needs and is checked before any data is read (CLAUDE.md rule 3).
// Visibility rules match the screens: vehicles and job cards respect the member's "own" scope. Each export is
// written to the audit log with who, what and how many rows. Capped so a download cannot exhaust the server.
import type { Driver, Queryable } from "@/lib/db/types";
import { authorizedAny, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { csvFileName, toCsv, type Column } from "./csv";
import { costPerHourIn, costPerKmIn, downtimeIn } from "@/lib/analytics/fleet-use";

export const MAX_EXPORT_ROWS = 50_000;

type Filters = { dept?: string; q?: string; status?: string; type?: string; months?: string };
type Ctx = { q: Queryable; held: Set<string>; m: Membership; f: Filters };
type Def = { perms: string[]; run: (c: Ctx) => Promise<Record<string, unknown>[]>; columns: Column<Record<string, unknown>>[] };

const col = (header: string, key: string, raw = false): Column<Record<string, unknown>> => ({ header, value: (r) => r[key] as never, raw });
const like = (s: string) => `%${s.replace(/[%_\\]/g, "\\$&")}%`;
const cap = `limit ${MAX_EXPORT_ROWS + 1}`;

const DEFS: Record<string, Def> = {
  vehicles: {
    perms: ["vehicle.read"],
    columns: [col("Registration", "registration_no"), col("Make", "make"), col("Model", "model"), col("Year", "year"), col("Class", "vehicle_class"), col("Fuel", "fuel_type"),
      col("Status", "status"), col("Odometer km", "odometer_km"), col("Base location", "base_location"), col("Department", "department"), col("Held by", "holder"), col("Employee ID", "holder_no"), col("Worst service status", "pm_worst")],
    async run({ q, m, f }) {
      const where: string[] = ["dept_ok(v.id)"], p: unknown[] = [];
      if (m.vehicleScope === "own") { p.push(m.userId); where.push(`h.user_id = $${p.length}`); }
      if (f.status) { p.push(f.status); where.push(`v.status = $${p.length}`); }
      if (f.dept === "_none") where.push("(v.department is null or btrim(v.department) = '')");
      else if (f.dept) { p.push(f.dept); where.push(`lower(btrim(v.department)) = lower($${p.length})`); }
      if (f.q) { p.push(like(f.q)); where.push(`(v.registration_no ilike $${p.length} or v.make ilike $${p.length} or v.model ilike $${p.length} or h.full_name ilike $${p.length})`); }
      return (await q.query(
        `select v.registration_no, v.make, v.model, v.year, v.vehicle_class, v.fuel_type, v.status, v.odometer_km::text, v.base_location, v.department, h.full_name as holder, h.employee_no as holder_no,
                (select case min(case x.pm_status when 'overdue' then 0 when 'due_soon' then 1 when 'no_history' then 2 when 'scheduled' then 3 else 4 end)
                          when 0 then 'overdue' when 1 then 'due_soon' when 2 then 'no_history' when 3 then 'scheduled' when 4 then 'ok' end from v_pm_status x where x.vehicle_id = v.id) as pm_worst
           from vehicles v left join vehicle_custody c on c.vehicle_id = v.id and c.to_date is null left join employees h on h.id = c.employee_id
          ${where.length ? "where " + where.join(" and ") : ""} order by v.registration_no ${cap}`, p)).rows;
    },
  },
  "job-cards": {
    perms: ["jobcard.read_all", "jobcard.read_own"],
    columns: [col("Job", "job_no"), col("Raised", "created_at"), col("Vehicle", "registration_no"), col("Status", "status"), col("Type", "category"), col("Priority", "priority"),
      col("Reason", "reason"), col("Requested by", "requester"), col("Approved by", "approver"), col("Workshop", "vendor"), col("Estimate", "estimated_cost"), col("Cost counted", "cost"), col("Cause", "cause_text")],
    async run({ q, m, held, f }) {
      const where: string[] = ["dept_ok(jc.vehicle_id)"], p: unknown[] = [];
      if (!held.has("jobcard.read_all")) { p.push(m.userId); where.push(`(re.user_id = $${p.length} or cu.user_id = $${p.length})`); }
      if (f.status) { p.push(f.status); where.push(`jc.status = $${p.length}`); }
      if (f.q) { p.push(like(f.q)); where.push(`(jc.job_no ilike $${p.length} or v.registration_no ilike $${p.length} or re.full_name ilike $${p.length})`); }
      return (await q.query(
        `select jc.job_no, jc.created_at::date::text as created_at, v.registration_no, jc.status, jc.category, jc.priority, rc.label as reason, re.full_name as requester,
                ap.full_name as approver, vn.name as vendor, jc.estimated_cost::text, (select c.cost::text from v_vehicle_job_cost c where c.job_card_id = jc.id) as cost, jc.cause_text
           from job_cards jc join vehicles v on v.id = jc.vehicle_id join employees re on re.id = jc.requested_by left join employees cu on cu.id = jc.custodian_id
           left join employees ap on ap.id = jc.approved_by left join vendors vn on vn.id = jc.vendor_id join reason_codes rc on rc.id = jc.reason_code_id
          ${where.length ? "where " + where.join(" and ") : ""} order by jc.created_at desc ${cap}`, p)).rows;
    },
  },
  invoices: {
    perms: ["invoice.verify"],
    columns: [col("Invoice", "invoice_no"), col("Date", "invoice_date"), col("Job", "job_no"), col("Vehicle", "registration_no"), col("Workshop", "vendor"), col("Invoiced", "amount"), col("Tax", "tax_amount"),
      col("Approved amount", "approved_amount"), col("Difference", "variance"), col("Lines not in quotation", "unapproved_lines"), col("Status", "status"), col("Payable", "payable_amount")],
    async run({ q, f }) {
      const p: unknown[] = []; if (f.status) p.push(f.status);
      return (await q.query(
        `select i.invoice_no, i.invoice_date::text, jc.job_no, v.registration_no, vn.name as vendor, i.amount::text, i.tax_amount::text, c.approved_amount::text, c.variance::text,
                c.unapproved_lines::int, i.status, i.payable_amount::text
           from invoices i join v_invoice_check c on c.invoice_id = i.id join work_orders wo on wo.id = i.work_order_id join job_cards jc on jc.id = wo.job_card_id
           join vehicles v on v.id = jc.vehicle_id join vendors vn on vn.id = wo.vendor_id ${f.status ? "where i.status = $1" : ""} order by i.invoice_date desc ${cap}`, p)).rows;
    },
  },
  documents: {
    perms: ["compliance.manage", "report.view"],
    columns: [col("Vehicle", "registration_no"), col("Document", "doc_type"), col("Reference", "reference"), col("Issued by", "issued_by"), col("Expires", "expires_on"), col("Days left", "days_left"), col("Status", "doc_status")],
    async run({ q, f }) {
      const where: string[] = [`v.status in ('active','in_workshop')`], p: unknown[] = [];
      if (f.status) { p.push(f.status); where.push(`d.doc_status = $${p.length}`); }
      if (f.type) { p.push(f.type); where.push(`d.doc_type = $${p.length}`); }
      if (f.q) { p.push(like(f.q)); where.push(`(v.registration_no ilike $${p.length} or d.reference ilike $${p.length})`); }
      return (await q.query(
        `select v.registration_no, d.doc_type, d.reference, d.issued_by, d.expires_on::text, d.days_left::int, d.doc_status
           from v_documents_status d join vehicles v on v.id = d.vehicle_id where ${where.join(" and ")} order by d.expires_on ${cap}`, p)).rows;
    },
  },
  accidents: {
    perms: ["compliance.manage", "report.view"],
    columns: [col("When", "occurred_at"), col("Vehicle", "registration_no"), col("Driver", "driver"), col("Where", "location"), col("Severity", "severity"), col("At fault", "fault"),
      col("Insurance claim", "insurance_claim"), col("Claim reference", "claim_ref"), col("Job card", "job_no"), col("Description", "description")],
    async run({ q }) {
      return (await q.query(
        `select a.occurred_at::text, v.registration_no, e.full_name as driver, a.location, a.severity, a.fault, a.insurance_claim, a.claim_ref, jc.job_no, a.description
           from accidents a join vehicles v on v.id = a.vehicle_id left join employees e on e.id = a.employee_id left join job_cards jc on jc.id = a.job_card_id order by a.occurred_at desc ${cap}`)).rows;
    },
  },
  challans: {
    perms: ["compliance.manage", "report.view"],
    columns: [col("Date", "issued_on"), col("Vehicle", "registration_no"), col("Driver", "driver"), col("Challan number", "reference"), col("Violation", "violation"), col("Amount", "amount"), col("Status", "status"), col("Paid on", "paid_on")],
    async run({ q, f }) {
      const p: unknown[] = []; if (f.status) p.push(f.status);
      return (await q.query(
        `select c.issued_on::text, v.registration_no, e.full_name as driver, c.reference, c.violation, c.amount::text, c.status, c.paid_on::text
           from challans c join vehicles v on v.id = c.vehicle_id left join employees e on e.id = c.employee_id ${f.status ? "where c.status = $1" : ""} order by c.issued_on desc ${cap}`, p)).rows;
    },
  },
  budgets: {
    perms: ["budget.manage", "report.view"],
    columns: [col("Applies to", "applies_to"), col("From", "period_start"), col("To", "period_end"), col("Budget", "amount"), col("Spent", "spent"), col("Percent used", "pct_used"), col("Over budget", "over_budget"), col("Note", "reason")],
    async run({ q }) {
      return (await q.query(
        `select coalesce(v.registration_no, 'Whole fleet') as applies_to, b.period_start::text, b.period_end::text, b.amount::text, u.spent::text, u.pct_used::text, u.over_budget, b.reason
           from budgets b join v_budget_utilisation u on u.budget_id = b.id left join vehicles v on v.id = b.vehicle_id order by (b.vehicle_id is not null), v.registration_no, b.period_start desc ${cap}`)).rows;
    },
  },
  "costs-by-vehicle": {
    perms: ["report.view"],
    columns: [col("Vehicle", "registration_no"), col("Make", "make"), col("Model", "model"), col("Department", "department"), col("Job cards (12 months)", "jobs"), col("Cost (12 months)", "cost"), col("Job cards (all time)", "jobs_all"), col("Cost (all time)", "cost_all")],
    async run({ q, f }) {
      const p: unknown[] = [];
      const where = f.dept === "_none" ? "where (v.department is null or btrim(v.department) = '')"
        : f.dept ? (p.push(f.dept), "where lower(btrim(v.department)) = lower($1)") : "";
      return (await q.query(
        `select v.registration_no, v.make, v.model, v.department,
                count(c.job_card_id) filter (where c.created_at > now() - interval '12 months')::int as jobs,
                coalesce(sum(c.cost) filter (where c.created_at > now() - interval '12 months'), 0)::text as cost,
                count(c.job_card_id)::int as jobs_all, coalesce(sum(c.cost), 0)::text as cost_all
           from vehicles v left join v_vehicle_job_cost c on c.vehicle_id = v.id ${where} group by v.id order by 6 desc, v.registration_no ${cap}`, p)).rows;
    },
  },
  "repeat-repairs": {
    perms: ["report.view"],
    columns: [col("Vehicle", "registration_no"), col("Fault", "reason"), col("Earlier job", "previous_job_no"), col("Came back as", "job_no"), col("Days between", "days_since"), col("Earlier work by", "previous_vendor")],
    async run({ q }) {
      return (await q.query(
        `select r.registration_no, r.reason, pj.job_no as previous_job_no, jc.job_no, r.days_since, pv.name as previous_vendor
           from flag_repeat_days r join job_cards jc on jc.id = r.job_card_id join job_cards pj on pj.id = r.previous_job_card_id left join vendors pv on pv.id = pj.vendor_id
          order by r.created_at desc ${cap}`)).rows;
    },
  },
  "cost-per-km": {
    perms: ["report.view"],
    columns: [col("Vehicle", "registration_no"), col("Job cards", "jobs"), col("Cost", "cost"), col("Kilometres", "km"), col("Cost per km", "per_km")],
    async run({ q, f }) {
      const r = await costPerKmIn(q, Number(f.months) || 12);
      return r.rows.map((x) => ({ registration_no: x.registration_no, jobs: x.jobs, cost: x.cost.toFixed(2), km: x.km === null ? "Not enough readings" : x.km.toFixed(1), per_km: x.per_km === null ? "" : x.per_km.toFixed(2) }));
    },
  },
  "cost-per-hour": {
    perms: ["report.view"],
    columns: [col("Vehicle", "registration_no"), col("Job cards", "jobs"), col("Cost", "cost"), col("Engine hours", "hours"), col("Cost per hour", "per_hour")],
    async run({ q, f }) {
      const r = await costPerHourIn(q, Number(f.months) || 12);
      return r.rows.map((x) => ({ registration_no: x.registration_no, jobs: x.jobs, cost: x.cost.toFixed(2), hours: x.hours === null ? "Not enough readings" : x.hours.toFixed(1), per_hour: x.per_hour === null ? "" : x.per_hour.toFixed(2) }));
    },
  },
  "workshop-time": {
    perms: ["report.view"],
    columns: [col("Vehicle", "registration_no"), col("Days in the workshop", "workshop_days"), col("Visits", "visits"), col("Longest visit (days)", "longest_days"), col("Days counted", "days"), col("Availability percent", "availability")],
    async run({ q, f }) {
      const r = await downtimeIn(q, Number(f.months) || 12);
      return r.rows.map((x) => ({ ...x, availability: x.availability === null ? "" : (x.availability * 100).toFixed(1) }));
    },
  },
  "outsourced-trips": {
    perms: ["trip.award", "trip.read_all", "invoice.verify"],
    columns: [col("Trip", "trip_no"), col("Provider", "vendor_name"), col("From", "from_place"), col("To", "to_place"), col("Awarded on", "awarded_on"), col("Status", "status"),
      col("Awarded price", "award_amount"), col("Highest quote", "max_quote"), col("Invoice no", "invoice_no"), col("Invoiced", "invoiced"), col("Invoice status", "invoice_status"), col("Payable", "payable")],
    async run({ q, f }) {
      return (await q.query(
        `select t.trip_no, v.name as vendor_name, t.from_place, t.to_place, t.decided_at::date::text as awarded_on, t.status, t.award_amount::text,
                (select max(tq.amount) from trip_quotes tq where tq.trip_id = t.id)::text as max_quote,
                i.invoice_no, i.amount::text as invoiced, i.status as invoice_status, i.payable::text as payable
           from trips t join vendors v on v.id = t.outsourced_vendor_id
           left join lateral (select * from trip_invoices x where x.trip_id = t.id and x.status in ('submitted','verified') limit 1) i on true
          where t.decided_at >= now() - ($1 || ' months')::interval and t.status in ('approved','started','completed')
          order by t.decided_at desc ${cap}`, [String([3, 6, 12, 24].includes(Number(f.months)) ? Number(f.months) : 12)])).rows;
    },
  },
  flags: {
    perms: ["report.view"],
    columns: [col("Vehicle", "registration_no"), col("Flag", "flag"), col("Severity", "severity"), col("Detail", "detail")],
    async run({ q }) { return (await q.query(`select coalesce(registration_no, 'Whole fleet') as registration_no, flag, severity, detail from v_vehicle_flags order by 3, 1 ${cap}`)).rows; },
  },
};

export const EXPORT_KINDS = Object.keys(DEFS);
export const isExportKind = (k: string) => Object.prototype.hasOwnProperty.call(DEFS, k);

/** Builds one CSV. Rejects unknown kinds, missing permission and oversized results; records the export in the audit log. */
export async function exportCsv(driver: Driver, m: Membership, kind: string, filters: Filters = {}): Promise<{ fileName: string; csv: string; rows: number }> {
  if (!isExportKind(kind)) throw new UserError("Unknown export.");
  const def = DEFS[kind];
  const f: Filters = { q: filters.q?.slice(0, 80) || undefined, status: filters.status?.slice(0, 30) || undefined, type: filters.type?.slice(0, 30) || undefined, months: filters.months?.slice(0, 3) || undefined, dept: filters.dept?.slice(0, 60) || undefined };
  return authorizedAny(driver, m, def.perms, async (q, held) => {
    const rows = await def.run({ q, held, m, f });
    if (rows.length > MAX_EXPORT_ROWS) throw new UserError(`Too many rows to export at once (more than ${MAX_EXPORT_ROWS.toLocaleString("en-US")}). Narrow it with a filter.`);
    await q.query("insert into audit_log(table_name, row_id, action, actor_id, new_data) values ($1, null, 'INSERT', $2, $3::jsonb)", [`export:${kind}`, m.userId, JSON.stringify({ rows: rows.length, filters: f })]);
    return { fileName: csvFileName(kind), csv: toCsv(def.columns, rows), rows: rows.length };
  });
}
