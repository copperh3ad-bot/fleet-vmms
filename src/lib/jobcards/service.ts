// Job cards. Every function checks the permission first (CLAUDE.md rule 3). Status changes happen only in
// transitionJobCard (rule 4), which calls the SQL function that also writes job_card_events.
import type { Driver, Queryable } from "@/lib/db/types";
import { authorized, authorizedAny, ForbiddenError, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";
import { jobCardSchema, TRANSITION_PERMISSION, type JobCardData, type JobCardInput } from "./schemas";

/** Messages raised by the job card SQL functions that a person can act on. Anything else is a bug and stays loud. */
const KNOWN = [
  /you need an employee record linked to your login[^"]*/, /requester is not an active employee/, /vehicle not found/, /vehicle is disposed/,
  /only a draft or a returned job card can be edited/, /only the requester can [a-z ]+ this job card/,
  /a comment of at least 5 characters is required/, /choose an active vendor/, /reason code not available/,
  /segregation of duties: [^"]*/, /this role may not approve job cards/, /job card is already [a-z_]+/,
  /illegal job card transition [a-z_]+ -> [a-z_]+/, /job card not found/,
];
function friendly(e: unknown): never {
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

async function notify(q: Queryable, userIds: (string | null)[], kind: string, payload: Record<string, unknown>, except: string) {
  const ids = [...new Set(userIds.filter((u): u is string => !!u && u !== except))];
  for (const id of ids) await q.query("insert into notifications(user_id, kind, payload) values ($1, $2, $3::jsonb)", [id, kind, JSON.stringify(payload)]);
}

const approversOf = async (q: Queryable, tenantId: string) =>
  (await q.query<{ user_id: string }>(
    `select m.user_id from public.tenant_memberships m
      where m.tenant_id = $1 and m.status = 'active'
        and m.role in (select role_key from role_permissions where permission_key = 'jobcard.approve')`, [tenantId])).rows.map((r) => r.user_id);

async function notifyAfter(q: Queryable, m: Membership, jobId: string, to: string) {
  const jc = (await q.query<{ job_no: string; requester_user: string | null }>(
    `select jc.job_no, e.user_id as requester_user from job_cards jc join employees e on e.id = jc.requested_by where jc.id = $1`, [jobId])).rows[0];
  const payload = { job_card_id: jobId, job_no: jc.job_no, to };
  if (to === "submitted") await notify(q, await approversOf(q, m.tenantId), "jobcard.submitted", payload, m.userId);
  else if (["approved", "rejected", "returned_for_edit"].includes(to)) await notify(q, [jc.requester_user], `jobcard.${to}`, payload, m.userId);
}

// ---------- Reference lists ----------

export type ReasonCode = { id: string; category: string; code: string; label: string };
export function listReasonCodes(driver: Driver, m: Membership): Promise<ReasonCode[]> {
  return authorizedAny(driver, m, ["jobcard.create", "jobcard.approve", "jobcard.read_all", "jobcard.read_own"], async (q) =>
    (await q.query<ReasonCode>("select id, category, code, label from reason_codes where active order by category, label")).rows);
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

export async function createJobCard(driver: Driver, m: Membership, input: JobCardInput, submit: boolean): Promise<{ id: string; job_no: string }> {
  const data = parse(input);
  return authorized(driver, m, "jobcard.create", async (q) => {
    await assertVehicleAllowed(q, m, data.vehicle_id);
    try {
      const id = (await q.query<{ id: string }>("select create_job_card($1::jsonb, $2, $3) as id", [JSON.stringify(data), m.userId, submit])).rows[0].id;
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
    try {
      await q.query("select edit_job_card($1, $2::jsonb, $3, $4)", [id, JSON.stringify(data), m.userId, submit]);
      if (submit) await notifyAfter(q, m, id, "submitted");
    } catch (e) { friendly(e); }
  });
}

// ---------- The one way a status changes ----------

export type TransitionOptions = { comment?: string; reasonCodeId?: string; vendorId?: string };

export async function transitionJobCard(driver: Driver, m: Membership, id: string, to: string, opts: TransitionOptions = {}): Promise<void> {
  const permission = TRANSITION_PERMISSION[to];
  if (!permission) throw new UserError("That step is not available yet.");
  return authorized(driver, m, permission, async (q) => {
    try {
      await q.query("select transition_job_card($1, $2, $3, $4, $5::jsonb)", [
        id, to, m.userId, opts.comment ?? null, JSON.stringify({ reason_code_id: opts.reasonCodeId ?? null, vendor_id: opts.vendorId ?? null })]);
      await notifyAfter(q, m, id, to);
    } catch (e) { friendly(e); }
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
    const where: string[] = [], params: unknown[] = [];
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

export type JobCardDetail = JobCardRow & {
  cause_text: string; description: string | null; odometer_km: string | null; custodian_name: string | null;
  requested_reason_label: string; reason_code_id: string; requested_by: string; approver_name: string | null; approved_by: string | null;
  vendor_id: string | null; vendor_name: string | null; mine: boolean; requester_is_me: boolean;
  lines: { id: string; kind: string; description: string; qty: string; unit_cost: string; service_type_key: string | null }[];
  events: { id: string; from_status: string | null; to_status: string; actor_name: string | null; comment: string | null; created_at: string }[];
};

export function getJobCard(driver: Driver, m: Membership, id: string): Promise<JobCardDetail | null> {
  return authorizedAny(driver, m, ["jobcard.read_all", "jobcard.read_own"], async (q, held) => {
    const jc = (await q.query<JobCardDetail>(
      `select jc.id, jc.job_no, jc.status, jc.category, jc.priority, jc.created_at::text, jc.needed_by::text, jc.vehicle_id,
              jc.cause_text, jc.description, jc.odometer_km::text, jc.estimated_cost::text, jc.reason_code_id, jc.requested_by, jc.approved_by,
              jc.vendor_id, v.registration_no, re.full_name as requester_name, rc.label as reason_label, rq.label as requested_reason_label,
              cu.full_name as custodian_name, ap.full_name as approver_name, vn.name as vendor_name,
              job_card_is_mine(jc.id, $2) as mine, (jc.requested_by = actor_employee($2)) as requester_is_me
         from job_cards jc
         join vehicles v on v.id = jc.vehicle_id
         join employees re on re.id = jc.requested_by
         left join employees cu on cu.id = jc.custodian_id
         left join employees ap on ap.id = jc.approved_by
         left join vendors vn on vn.id = jc.vendor_id
         join reason_codes rc on rc.id = jc.reason_code_id
         join reason_codes rq on rq.id = jc.requested_reason_code_id
        where jc.id = $1 ${held.has("jobcard.read_all") ? "" : "and (re.user_id = $2 or cu.user_id = $2)"}`, [id, m.userId])).rows[0];
    if (!jc) return null;
    jc.lines = (await q.query<JobCardDetail["lines"][number]>(
      "select id, kind, description, qty::text, unit_cost::text, service_type_key from job_card_lines where job_card_id = $1 order by id", [id])).rows;
    jc.events = (await q.query<JobCardDetail["events"][number]>(
      `select ev.id, ev.from_status, ev.to_status, e.full_name as actor_name, ev.comment, ev.created_at::text
         from job_card_events ev left join employees e on e.user_id = ev.actor_id
        where ev.job_card_id = $1 order by ev.seq`, [id])).rows;
    return jc;
  });
}

export function listActiveVendors(driver: Driver, m: Membership): Promise<{ id: string; name: string }[]> {
  return authorized(driver, m, "jobcard.assign_vendor", async (q) =>
    (await q.query<{ id: string; name: string }>("select id, name from vendors where status = 'active' order by name")).rows);
}

// ---------- Notifications ----------

export type NotificationRow = { id: string; kind: string; payload: { job_card_id?: string; job_no?: string; to?: string }; read_at: string | null; created_at: string };

const NOTICE_PERMISSIONS = ["jobcard.create", "jobcard.read_own", "jobcard.read_all", "jobcard.approve"];

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
