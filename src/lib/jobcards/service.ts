// Job cards. Every function checks the permission first (CLAUDE.md rule 3). Status changes happen only in
// transitionJobCard (rule 4), which calls the SQL function that also writes job_card_events.
import { dm } from "@/lib/format/date";
import type { Driver, Queryable } from "@/lib/db/types";
import { authorized, authorizedAny, ForbiddenError, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { assertHoursPlausible } from "@/lib/hours/service";
import { notify, usersWithPermission } from "@/lib/notify";
import { fieldErrors } from "@/lib/master/schemas";
import { jobCardSchema, TRANSITION_PERMISSION, type JobCardData, type JobCardInput } from "./schemas";

/** Messages raised by the job card SQL functions that a person can act on. Anything else is a bug and stays loud. */
const KNOWN = [
  /you need an employee record linked to your login[^"]*/, /requester is not an active employee/, /vehicle not found/, /vehicle is disposed/,
  /only a draft or a returned job card can be edited/, /only the requester can [a-z ]+ this job card/,
  /a comment of at least 5 characters is required/, /choose an active vendor/, /reason code not available/,
  /segregation of duties: [^"]*/, /company rule: the administrator does not [a-z ]+ while [a-z ,]+ is active/, /this role may not approve job cards/, /job card is already [a-z_]+/,
  /illegal job card transition [a-z_]+ -> [a-z_]+/, /job card not found/,
  // vendor flow (migration 0007) and invoice check (verify_invoice)
  /this login is not linked to an active vendor/, /this job is not waiting for a quotation/, /add at least one line/,
  /this quotation is not awaiting a decision/, /quotation not found/, /work order not found/, /this work order has already been started/,
  /start the work before completing it/, /the work must be completed before invoicing/, /an invoice is already open for this work order/,
  /enter the invoice number/, /an invoice line points at a line that is not in the approved quotation/,
  /invoice [0-9a-f-]+ is not awaiting verification/, /job card [A-Za-z0-9-]+ is [a-z_]+ and cannot be verified/,
  /a note is required for decision [a-z_]+/, /unknown decision [a-z_]*/,
  /this is over the approval limit for your department[^"]*/, /this vehicle belongs to another department/,
  /a pool car can only be held by[^"]*/, /pool cars belong to the [A-Za-z ]+ department/, /this car is held by someone outside[^"]*/,
];
/** Turns a known database message into something a person can read; anything else is rethrown as a real error. */
export function friendly(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  for (const re of KNOWN) { const hit = msg.match(re); if (hit) throw new UserError(hit[0].replace(/^./, (c) => c.toUpperCase()) + (hit[0].endsWith(".") ? "" : ".")); }
  throw e;
}

function parse(input: JobCardInput): JobCardData {
  const r = jobCardSchema.safeParse(input);
  if (!r.success) throw new UserError("Fix the highlighted fields.", fieldErrors(r.error));
  return r.data;
}

// ---------- Notifications (same transaction as the change, so a notice never exists without its cause) ----------

/** Who hears about a status change: approvers on submit, the requester on a decision, the vendor when assigned. */
export async function notifyAfter(q: Queryable, m: Membership, jobId: string, to: string) {
  const jc = (await q.query<{ job_no: string; requester_user: string | null; vendor_user: string | null }>(
    `select jc.job_no, e.user_id as requester_user, vn.user_id as vendor_user
       from job_cards jc join employees e on e.id = jc.requested_by left join vendors vn on vn.id = jc.vendor_id where jc.id = $1`, [jobId])).rows[0];
  const payload = { job_card_id: jobId, job_no: jc.job_no, to };
  if (to === "submitted") await notify(q, await usersWithPermission(q, m.tenantId, "jobcard.approve"), "jobcard.submitted", payload, m.userId);
  else if (["approved", "rejected", "returned_for_edit"].includes(to)) await notify(q, [jc.requester_user], `jobcard.${to}`, payload, m.userId);
  else if (to === "vendor_assigned") await notify(q, [jc.vendor_user], "jobcard.vendor_assigned", payload, m.userId);
  else if (to === "quotation_received") await notify(q, await usersWithPermission(q, m.tenantId, "quotation.approve"), "quotation.received", payload, m.userId);
  else if (to === "completed") await notify(q, await usersWithPermission(q, m.tenantId, "jobcard.approve"), "work.completed", payload, m.userId);
  else if (to === "invoiced") await notify(q, await usersWithPermission(q, m.tenantId, "invoice.verify"), "invoice.submitted", payload, m.userId);
  else if (["quotation_approved", "invoice_verified"].includes(to)) await notify(q, [jc.vendor_user], to === "quotation_approved" ? "quotation.approved" : "invoice.verified", payload, m.userId);
}

// ---------- Reference lists ----------

export type ReasonCode = { id: string; category: string; code: string; label: string };
export function listReasonCodes(driver: Driver, m: Membership): Promise<ReasonCode[]> {
  return authorizedAny(driver, m, ["jobcard.create", "jobcard.approve", "jobcard.read_all", "jobcard.read_own"], async (q) =>
    (await q.query<ReasonCode>("select id, category, code, label from reason_codes where active order by (category = 'other'), category, label")).rows);
}

// ---------- Create / edit ----------

/** A requester whose vehicle scope is "own" may only raise cards for the vehicle they currently hold. */
async function assertVehicleAllowed(q: Queryable, m: Membership, vehicleId: string) {
  if (m.vehicleScope !== "own") return;
  const ok = await q.query(
    `select 1 from vehicle_custody c join employees e on e.id = c.employee_id
      where c.vehicle_id = $1 and c.to_date is null and e.user_id = $2`, [vehicleId, m.userId]);
  if (ok.rows.length === 0) throw new ForbiddenError("jobcard.create for this vehicle");
}

/** The odometer on a job card cannot be lower than the reading on file; a lower number is almost always a typo. */
async function assertOdometerNotLower(q: Queryable, vehicleId: string, km: number | undefined) {
  if (km === undefined) return;
  const on = (await q.query<{ km: string }>("select odometer_km::text as km from vehicles where id = $1", [vehicleId])).rows[0];
  if (on && km < Number(on.km)) {
    const shown = Number(on.km).toLocaleString("en-US", { maximumFractionDigits: 0 });
    throw new UserError(`The odometer must be at least ${shown} km, the reading on file.`, { odometer_km: `Must be at least ${shown}` });
  }
}

/** An hour meter reading on the card counts only for a vehicle that tracks hours; it must not be lower than the one on file. Returns the number to store, or undefined. */
async function checkedHours(q: Queryable, vehicleId: string, hours: number | undefined): Promise<number | undefined> {
  if (hours === undefined) return undefined;
  const v = (await q.query<{ t: boolean }>("select tracks_hours as t from vehicles where id = $1", [vehicleId])).rows[0];
  if (!v?.t) return undefined;
  await assertHoursPlausible(q, vehicleId, hours, "engine_hours");
  return hours;
}

export async function createJobCard(driver: Driver, m: Membership, input: JobCardInput, submit: boolean): Promise<{ id: string; job_no: string }> {
  const data = parse(input);
  return authorized(driver, m, "jobcard.create", async (q) => {
    await assertVehicleAllowed(q, m, data.vehicle_id);
    await assertOdometerNotLower(q, data.vehicle_id, data.odometer_km);
    const hours = await checkedHours(q, data.vehicle_id, data.engine_hours);
    try {
      const id = (await q.query<{ id: string }>("select create_job_card($1::jsonb, $2, $3) as id", [JSON.stringify(data), m.userId, submit])).rows[0].id;
      if (hours !== undefined) await q.query("update job_cards set engine_hours = $2 where id = $1", [id, hours]);
      if (submit) await notifyAfter(q, m, id, "submitted");
      const jc = (await q.query<{ job_no: string }>("select job_no from job_cards where id = $1", [id])).rows[0];
      return { id, job_no: jc.job_no };
    } catch (e) { return friendly(e); }
  });
}

export async function editJobCard(driver: Driver, m: Membership, id: string, input: JobCardInput, submit: boolean): Promise<void> {
  const data = parse(input);
  return authorized(driver, m, "jobcard.create", async (q) => {
    await assertVehicleAllowed(q, m, data.vehicle_id);
    await assertOdometerNotLower(q, data.vehicle_id, data.odometer_km);
    const hours = await checkedHours(q, data.vehicle_id, data.engine_hours);
    try {
      await q.query("select edit_job_card($1, $2::jsonb, $3, $4)", [id, JSON.stringify(data), m.userId, submit]);
      if (hours !== undefined) await q.query("update job_cards set engine_hours = $2 where id = $1", [id, hours]);
      if (submit) await notifyAfter(q, m, id, "submitted");
    } catch (e) { friendly(e); }
  });
}

/** Active routine services a line on the form can be tagged with, so "last oil change" is found without guessing text. */
export function listServiceTags(driver: Driver, m: Membership): Promise<{ key: string; label: string }[]> {
  return authorizedAny(driver, m, ["jobcard.create", "jobcard.approve"], async (q) =>
    (await q.query<{ key: string; label: string }>("select key, label from service_types where active order by label")).rows);
}

// ---------- What the form knows about the chosen vehicle ----------

export type JobContext = {
  vehicle: { id: string; registration_no: string; label: string; odometer_km: number; odometer_updated_at: string | null; holder: string | null; department: string | null; tracks_hours: boolean; engine_hours: number | null };
  due: { label: string; service_type_key: string; status: string; due_on: string | null; days: number | null }[];
  budget: { budget: number; spent: number; pct: number } | null;
  lastJobs: { job_no: string; created_at: string; reason: string; cost: number }[];
  recent: { reason_code_id: string; reason: string; job_no: string; created_at: string; days_ago: number }[];
  repeatWindowDays: number;
};

/** Read-only help for the new job card form. Same visibility rule as raising the card. */
export function getJobContext(driver: Driver, m: Membership, vehicleId: string): Promise<JobContext | null> {
  return authorizedAny(driver, m, ["jobcard.create", "jobcard.approve"], async (q, held) => {
    if (held.has("jobcard.create") && !held.has("jobcard.approve")) await assertVehicleAllowed(q, m, vehicleId);
    const v = (await q.query<{ id: string; registration_no: string; label: string; km: string; updated: string | null; holder: string | null; department: string | null; tracks_hours: boolean; hours: string | null }>(
      `select v.id, v.registration_no, concat_ws(' ', v.make, v.model, v.year) as label, v.odometer_km::text as km, v.odometer_updated_at::text as updated, h.full_name as holder, h.department, v.tracks_hours, v.engine_hours::text as hours
         from vehicles v left join vehicle_custody c on c.vehicle_id = v.id and c.to_date is null left join employees h on h.id = c.employee_id where v.id = $1 and dept_ok(v.id)`, [vehicleId])).rows[0];
    if (!v) return null;
    const due = (await q.query<{ label: string; service_type_key: string; status: string; due_on: string | null; days: number | null }>(
      `select label, service_type_key, pm_status as status, due_on::text, days_remaining::int as days from v_pm_status
        where vehicle_id = $1 and pm_status in ('overdue','due_soon') order by coalesce(days_remaining, 99999)`, [vehicleId])).rows;
    const b = (await q.query<{ budget: string; spent: string; pct: string | null }>("select budget::text, spent::text, pct_used::text as pct from v_vehicle_budget_now where vehicle_id = $1", [vehicleId])).rows[0];
    const lastJobs = (await q.query<{ job_no: string; created_at: string; reason: string; cost: string }>(
      `select jc.job_no, jc.created_at::text, rc.label as reason, coalesce(c.cost, 0)::text as cost
         from job_cards jc join reason_codes rc on rc.id = jc.reason_code_id left join v_vehicle_job_cost c on c.job_card_id = jc.id
        where jc.vehicle_id = $1 and jc.status not in ('draft','cancelled','rejected') order by jc.created_at desc limit 3`, [vehicleId])).rows;
    const window = (await q.query<{ d: string }>("select setting_num('flag_repeat_days', 60)::text d")).rows[0].d;
    const recent = (await q.query<{ reason_code_id: string; reason: string; job_no: string; created_at: string; days_ago: number }>(
      `select distinct on (jc.reason_code_id) jc.reason_code_id, rc.label as reason, jc.job_no, jc.created_at::text, (current_date - jc.created_at::date)::int as days_ago
         from job_cards jc join reason_codes rc on rc.id = jc.reason_code_id
        where jc.vehicle_id = $1 and jc.status not in ('draft','cancelled','rejected') and rc.category <> 'scheduled_service'
          and jc.created_at >= now() - ($2 || ' days')::interval order by jc.reason_code_id, jc.created_at desc`, [vehicleId, window])).rows;
    return {
      vehicle: { id: v.id, registration_no: v.registration_no, label: v.label, odometer_km: Number(v.km), odometer_updated_at: v.updated, holder: v.holder, department: v.department, tracks_hours: v.tracks_hours, engine_hours: v.hours === null ? null : Number(v.hours) },
      due, budget: b ? { budget: Number(b.budget), spent: Number(b.spent), pct: Number(b.pct ?? 0) } : null,
      lastJobs: lastJobs.map((j) => ({ ...j, cost: Number(j.cost) })), recent, repeatWindowDays: Number(window),
    };
  });
}

// ---------- The review screen: what the decider needs to know ----------

export type ReviewContext = {
  vehicle: { id: string; label: string; holder: string | null; department: string | null; odometer_km: number };
  previousReading: { km: number; read_at: string } | null;
  budget: { budget: number; spent: number; pct: number; after: number; afterPct: number } | null;
  repeat: { job_id: string; job_no: string; created_at: string; days_ago: number; cost: number; reason: string; vendor_id: string | null; vendor: string | null; cause_text: string } | null;
  due: { label: string; status: string; due_on: string | null; days: number | null }[];
  vendors: { id: string; name: string; jobs: number; avg_days: number | null; quote_vs_bill_pct: number | null; rework_pct: number | null; warning: string | null }[];
  queue: { position: number; total: number; prev: string | null; next: string | null } | null;
};

/** Read-only help for the approver. The approval queue is the cards this person could decide, oldest first. */
export function getReviewContext(driver: Driver, m: Membership, jobId: string): Promise<ReviewContext | null> {
  return authorizedAny(driver, m, ["jobcard.read_all", "jobcard.read_own"], async (q, held) => {
    const jc = (await q.query<{ vehicle_id: string; reason_code_id: string; created_at: string; estimated_cost: string | null; status: string }>(
      "select vehicle_id, reason_code_id, created_at::text, estimated_cost::text, status from job_cards where id = $1 and dept_ok(vehicle_id)", [jobId])).rows[0];
    if (!jc) return null;
    const v = (await q.query<{ id: string; label: string; km: string; holder: string | null; department: string | null }>(
      `select v.id, concat_ws(' ', v.make, v.model, v.year) as label, v.odometer_km::text as km, h.full_name as holder, h.department
         from vehicles v left join vehicle_custody c on c.vehicle_id = v.id and c.to_date is null left join employees h on h.id = c.employee_id where v.id = $1`, [jc.vehicle_id])).rows[0];
    const prev = (await q.query<{ km: string; read_at: string }>(
      `select reading_km::text as km, read_at::text from odometer_readings where vehicle_id = $1 and status = 'accepted' and read_at < $2::timestamptz
        order by read_at desc, created_at desc limit 1`, [jc.vehicle_id, jc.created_at])).rows[0];
    const b = (await q.query<{ budget: string; spent: string; pct: string | null }>("select budget::text, spent::text, pct_used::text as pct from v_vehicle_budget_now where vehicle_id = $1", [jc.vehicle_id])).rows[0];
    const est = Number(jc.estimated_cost ?? 0);
    const budget = b ? { budget: Number(b.budget), spent: Number(b.spent), pct: Number(b.pct ?? 0), after: Number(b.spent) + est, afterPct: Math.round(((Number(b.spent) + est) / Number(b.budget)) * 100) } : null;

    const window = Number((await q.query<{ d: string }>("select setting_num('flag_repeat_days', 60)::text d")).rows[0].d);
    const rp = (await q.query<{ id: string; job_no: string; created_at: string; days_ago: number; cost: string; reason: string; vendor_id: string | null; vendor: string | null; cause_text: string }>(
      `select p.id, p.job_no, p.created_at::text, (current_date - p.created_at::date)::int as days_ago, coalesce(c.cost, 0)::text as cost, rc.label as reason,
              p.vendor_id, vn.name as vendor, p.cause_text
         from job_cards p join reason_codes rc on rc.id = p.reason_code_id left join vendors vn on vn.id = p.vendor_id left join v_vehicle_job_cost c on c.job_card_id = p.id
        where p.vehicle_id = $1 and p.reason_code_id = $2 and p.id <> $3 and rc.category <> 'scheduled_service' and p.status not in ('draft','cancelled','rejected')
          and p.created_at < $4::timestamptz and p.created_at >= $4::timestamptz - ($5 || ' days')::interval order by p.created_at desc limit 1`,
      [jc.vehicle_id, jc.reason_code_id, jobId, jc.created_at, String(window)])).rows[0];
    const repeat = rp ? { job_id: rp.id, job_no: rp.job_no, created_at: rp.created_at, days_ago: rp.days_ago, cost: Number(rp.cost), reason: rp.reason, vendor_id: rp.vendor_id, vendor: rp.vendor, cause_text: rp.cause_text } : null;

    const due = (await q.query<{ label: string; status: string; due_on: string | null; days: number | null }>(
      "select label, pm_status as status, due_on::text, days_remaining::int as days from v_pm_status where vehicle_id = $1 and pm_status in ('overdue','due_soon') order by coalesce(days_remaining, 99999)", [jc.vehicle_id])).rows;

    // workshops to choose from, with their record: only for people who may assign one
    const canAssign = (await q.query("select 1 from role_permissions where role_key = $1 and permission_key = 'jobcard.assign_vendor'", [m.role])).rows.length > 0;
    const vendors = canAssign ? (await q.query<{ id: string; name: string; jobs: number | null; avg_days: string | null; qb: string | null; rw: string | null }>(
      `select vn.id, vn.name, s.jobs, s.avg_days::text, s.quote_vs_bill_pct::text as qb, s.rework_pct::text as rw
         from vendors vn left join workshop_scorecard(90) s on s.vendor_id = vn.id where vn.status = 'active' order by coalesce(s.jobs, 0) desc, vn.name`)).rows.map((r) => ({
      id: r.id, name: r.name, jobs: r.jobs ?? 0, avg_days: r.avg_days === null ? null : Number(r.avg_days), quote_vs_bill_pct: r.qb === null ? null : Number(r.qb), rework_pct: r.rw === null ? null : Number(r.rw),
      warning: repeat && repeat.vendor_id === r.id ? `Did the ${dm(repeat.created_at)} ${repeat.reason.toLowerCase()} job. Ask about guarantee.` : null,
    })) : [];

    // the queue this person works through
    let queue: ReviewContext["queue"] = null;
    if (jc.status === "submitted" && held.has("jobcard.read_all")) {
      const ids = (await q.query<{ id: string }>("select id from job_cards where status = 'submitted' and requested_by is distinct from actor_employee($1) order by created_at, id", [m.userId])).rows.map((r) => r.id);
      const i = ids.indexOf(jobId);
      if (i >= 0) queue = { position: i + 1, total: ids.length, prev: ids[i - 1] ?? null, next: ids[i + 1] ?? null };
    }
    return { vehicle: { id: v.id, label: v.label, holder: v.holder, department: v.department, odometer_km: Number(v.km) },
      previousReading: prev ? { km: Number(prev.km), read_at: prev.read_at } : null, budget, repeat, due, vendors, queue };
  });
}

/** Approve and assign the workshop in one step, as the review screen does. Needs both permissions; one transaction. */
export async function approveAndAssign(driver: Driver, m: Membership, id: string, opts: { vendorId: string; reasonCodeId?: string; comment?: string }): Promise<void> {
  if (!opts.vendorId) throw new UserError("Choose a workshop.", { vendor_id: "Choose a workshop" });
  return authorized(driver, m, "jobcard.approve", async (q) => {
    const ok = await q.query("select 1 from role_permissions where role_key = $1 and permission_key = 'jobcard.assign_vendor'", [m.role]);
    if (ok.rows.length === 0) throw new ForbiddenError("jobcard.assign_vendor");
    try {
      await transitionInTx(q, m, id, "approved", { comment: opts.comment, reasonCodeId: opts.reasonCodeId });
      await transitionInTx(q, m, id, "vendor_assigned", { vendorId: opts.vendorId });
    } catch (e) { friendly(e); }
  });
}

// ---------- The one way a status changes ----------

export type TransitionOptions = { comment?: string; reasonCodeId?: string; vendorId?: string };

/** The one place a status is changed inside a transaction: the SQL function (guard + event row) and the notices. */
async function transitionInTx(q: Queryable, m: Membership, id: string, to: string, opts: TransitionOptions = {}) {
  await q.query("select transition_job_card($1, $2, $3, $4, $5::jsonb)", [
    id, to, m.userId, opts.comment ?? null, JSON.stringify({ reason_code_id: opts.reasonCodeId ?? null, vendor_id: opts.vendorId ?? null })]);
  await notifyAfter(q, m, id, to);
}

export async function transitionJobCard(driver: Driver, m: Membership, id: string, to: string, opts: TransitionOptions = {}): Promise<void> {
  const permission = TRANSITION_PERMISSION[to];
  if (!permission) throw new UserError("That step is not available yet.");
  return authorized(driver, m, permission, async (q) => {
    try { await transitionInTx(q, m, id, to, opts); } catch (e) { friendly(e); }
  });
}

// ---------- Reading ----------

export type JobCardRow = {
  id: string; job_no: string; status: string; category: string; priority: string; created_at: string; needed_by: string | null;
  registration_no: string; vehicle_id: string; requester_name: string; reason_label: string; estimated_cost: string | null;
};

/** "read_all" sees everything; "read_own" sees cards the member raised or whose vehicle they held when it was raised. */
export function listJobCards(driver: Driver, m: Membership, opts: { status?: string; search?: string } = {}): Promise<JobCardRow[]> {
  return authorizedAny(driver, m, ["jobcard.read_all", "jobcard.read_own"], async (q, held) => {
    const where: string[] = ["dept_ok(jc.vehicle_id)"], params: unknown[] = [];
    if (!held.has("jobcard.read_all")) { params.push(m.userId); where.push(`(re.user_id = $${params.length} or cu.user_id = $${params.length})`); }
    if (opts.status) { params.push(opts.status); where.push(`jc.status = $${params.length}`); }
    if (opts.search) {
      params.push(`%${opts.search.replace(/[%_\\]/g, "\\$&")}%`);
      where.push(`(jc.job_no ilike $${params.length} or v.registration_no ilike $${params.length} or re.full_name ilike $${params.length})`);
    }
    return (await q.query<JobCardRow>(
      `select jc.id, jc.job_no, jc.status, jc.category, jc.priority, jc.created_at::text, jc.needed_by::text, jc.vehicle_id,
              v.registration_no, re.full_name as requester_name, rc.label as reason_label, jc.estimated_cost::text
         from job_cards jc
         join vehicles v on v.id = jc.vehicle_id
         join employees re on re.id = jc.requested_by
         left join employees cu on cu.id = jc.custodian_id
         join reason_codes rc on rc.id = jc.reason_code_id
        ${where.length ? "where " + where.join(" and ") : ""}
        order by jc.created_at desc limit 300`, params)).rows;
  });
}

export type JobCardDetail = JobCardRow & { source: string;
  cause_text: string; description: string | null; odometer_km: string | null; engine_hours: string | null; custodian_name: string | null;
  requested_reason_label: string; reason_code_id: string; requested_by: string; approver_name: string | null; approved_by: string | null;
  vendor_id: string | null; vendor_name: string | null; mine: boolean; requester_is_me: boolean; age_days: number;
  lines: { id: string; kind: string; description: string; qty: string; unit_cost: string; service_type_key: string | null }[];
  events: { id: string; from_status: string | null; to_status: string; actor_name: string | null; comment: string | null; created_at: string }[];
};

export function getJobCard(driver: Driver, m: Membership, id: string): Promise<JobCardDetail | null> {
  return authorizedAny(driver, m, ["jobcard.read_all", "jobcard.read_own"], async (q, held) => {
    const jc = (await q.query<JobCardDetail>(
      `select jc.id, jc.job_no, jc.source, jc.status, jc.category, jc.priority, jc.created_at::text, jc.needed_by::text, jc.vehicle_id,
              jc.cause_text, jc.description, jc.odometer_km::text, jc.engine_hours::text, jc.estimated_cost::text, jc.reason_code_id, jc.requested_by, jc.approved_by,
              jc.vendor_id, v.registration_no, re.full_name as requester_name, rc.label as reason_label, rq.label as requested_reason_label,
              cu.full_name as custodian_name, ap.full_name as approver_name, vn.name as vendor_name,
              job_card_is_mine(jc.id, $2) as mine, (jc.requested_by = actor_employee($2)) as requester_is_me, greatest(0, current_date - jc.created_at::date)::int as age_days
         from job_cards jc
         join vehicles v on v.id = jc.vehicle_id
         join employees re on re.id = jc.requested_by
         left join employees cu on cu.id = jc.custodian_id
         left join employees ap on ap.id = jc.approved_by
         left join vendors vn on vn.id = jc.vendor_id
         join reason_codes rc on rc.id = jc.reason_code_id
         join reason_codes rq on rq.id = jc.requested_reason_code_id
        where jc.id = $1 and dept_ok(jc.vehicle_id) ${held.has("jobcard.read_all") ? "" : "and (re.user_id = $2 or cu.user_id = $2)"}`, [id, m.userId])).rows[0];
    if (!jc) return null;
    jc.lines = (await q.query<JobCardDetail["lines"][number]>(
      "select id, kind, description, qty::text, unit_cost::text, service_type_key from job_card_lines where job_card_id = $1 order by id", [id])).rows;
    jc.events = (await q.query<JobCardDetail["events"][number]>(
      `select ev.id, ev.from_status, ev.to_status, coalesce(e.full_name, vn.name) as actor_name, ev.comment, ev.created_at::text
         from job_card_events ev left join employees e on e.user_id = ev.actor_id left join vendors vn on vn.user_id = ev.actor_id
        where ev.job_card_id = $1 order by ev.seq`, [id])).rows;
    return jc;
  });
}

export function listActiveVendors(driver: Driver, m: Membership): Promise<{ id: string; name: string }[]> {
  return authorized(driver, m, "jobcard.assign_vendor", async (q) =>
    (await q.query<{ id: string; name: string }>("select id, name from vendors where status = 'active' order by name")).rows);
}

// ---------- Notifications ----------

export type NotificationRow = { id: string; kind: string; payload: { job_card_id?: string; job_no?: string; to?: string; text?: string; key?: string; request_id?: string; vehicle_id?: string; trip_id?: string; cargo_id?: string }; read_at: string | null; created_at: string };

const NOTICE_PERMISSIONS = ["jobcard.create", "jobcard.read_own", "jobcard.read_all", "jobcard.approve", "quotation.submit", "invoice.verify", "compliance.manage", "trip.request", "trip.approve", "trip.dispatch", "vreq.request", "vreq.decide", "cargo.request", "cargo.handle"];

export function listNotifications(driver: Driver, m: Membership): Promise<NotificationRow[]> {
  return authorizedAny(driver, m, NOTICE_PERMISSIONS, async (q) =>
    (await q.query<NotificationRow>(
      "select id, kind, payload, read_at::text, created_at::text from notifications where user_id = $1 order by created_at desc limit 50", [m.userId])).rows);
}

export function markNotificationsRead(driver: Driver, m: Membership): Promise<void> {
  return authorizedAny(driver, m, NOTICE_PERMISSIONS, async (q) => {
    await q.query("update notifications set read_at = now() where user_id = $1 and read_at is null", [m.userId]);
  });
}

/** Roles with no job card permission have no notices; that is 0, not an error. */
export const unreadCount = (driver: Driver, m: Membership): Promise<number> =>
  authorizedAny(driver, m, NOTICE_PERMISSIONS, async (q) =>
    (await q.query<{ c: number }>("select count(*)::int c from notifications where user_id = $1 and read_at is null", [m.userId])).rows[0].c)
    .catch((e) => { if (e instanceof ForbiddenError) return 0; throw e; });
