// HR vehicle requests (ADR-059). HR asks for a vehicle for an employee; an administrator or fleet manager gives one from the pool (a vehicle
// nobody holds) or approves buying one. Every status change goes through transitionVehicleRequest, which calls the SQL function
// vehicle_request_transition; that function writes the event row and, on giving a vehicle, opens the employee's custody of it.
import { z } from "zod";
import type { Driver } from "@/lib/db/types";
import { authorized, authorizedAny, ForbiddenError, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";
import { notify, usersWithPermission } from "@/lib/notify";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const VREQ_STATUS_LABEL: Record<string, string> = {
  requested: "Waiting for a decision", purchase_approved: "Purchase approved", assigned: "Vehicle given", rejected: "Rejected", cancelled: "Cancelled",
};

export const vehicleRequestSchema = z.object({
  for_employee: z.uuid("Choose the employee"),
  reason: z.string().trim().min(3, "Say why the vehicle is needed").max(300),
  vehicle_class: z.preprocess(blank, z.string().trim().max(80).optional()),
  needed_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date it is needed from"),
});

/** Messages raised by vehicle_request_transition that a person can act on. Anything else is a bug and stays loud. */
const KNOWN = [
  /vehicle request not found/, /illegal vehicle request transition [a-z_]+ -> [a-z_]+/, /segregation of duties: [^"]*/, /choose a vehicle to give/, /vehicle not found/,
  /that vehicle is not available[^"]*/, /that vehicle is already held by someone/, /a reason of at least 5 characters is required/, /employee is not active/,
];
function friendly(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (/vehicle_requests_one_open_uq/.test(msg)) throw new UserError("That employee already has an open vehicle request.");
  for (const re of KNOWN) { const hit = msg.match(re); if (hit) throw new UserError(hit[0].replace(/^./, (c) => c.toUpperCase()) + (hit[0].endsWith(".") ? "" : ".")); }
  throw e;
}

export type VehicleRequestRow = {
  id: string; request_no: string; status: string; reason: string; vehicle_class: string | null; needed_from: string;
  for_name: string; requester_name: string; registration_no: string | null; created_at: string; mine: boolean;
};
export type VehicleRequestEvent = { from_status: string | null; to_status: string; note: string | null; created_at: string; actor_name: string | null };
export type VehicleRequestDetail = VehicleRequestRow & { vehicle_id: string | null; decision_note: string | null; for_user: string | null; requested_by_me: boolean; events: VehicleRequestEvent[] };

const ROW_SQL = `select r.id, r.request_no, r.status, r.reason, r.vehicle_class, r.needed_from::text, fe.full_name as for_name, re.full_name as requester_name,
       v.registration_no, r.created_at::text, (re.user_id = $1) as mine
  from vehicle_requests r join employees fe on fe.id = r.for_employee join employees re on re.id = r.requested_by left join vehicles v on v.id = r.vehicle_id`;

/** vreq.read_all and vreq.decide see every request; anyone else sees only the ones they asked for. */
export function listVehicleRequests(driver: Driver, m: Membership, opts: { status?: string } = {}): Promise<VehicleRequestRow[]> {
  return authorizedAny(driver, m, ["vreq.request", "vreq.decide", "vreq.read_all"], async (q, held) => {
    const params: unknown[] = [m.userId];
    const where: string[] = [];
    if (!held.has("vreq.read_all") && !held.has("vreq.decide")) where.push("re.user_id = $1");
    if (opts.status) { params.push(opts.status); where.push(`r.status = $${params.length}`); }
    return (await q.query<VehicleRequestRow>(`${ROW_SQL} ${where.length ? "where " + where.join(" and ") : ""} order by r.created_at desc limit 300`, params)).rows;
  });
}

export function getVehicleRequest(driver: Driver, m: Membership, id: string): Promise<VehicleRequestDetail | null> {
  return authorizedAny(driver, m, ["vreq.request", "vreq.decide", "vreq.read_all"], async (q, held) => {
    const r = (await q.query<Omit<VehicleRequestDetail, "events">>(
      `select r.id, r.request_no, r.status, r.reason, r.vehicle_class, r.needed_from::text, fe.full_name as for_name, re.full_name as requester_name, v.registration_no, r.created_at::text,
              r.vehicle_id, r.decision_note, fe.user_id as for_user, (re.user_id = $2) as requested_by_me, (re.user_id = $2) as mine
         from vehicle_requests r join employees fe on fe.id = r.for_employee join employees re on re.id = r.requested_by left join vehicles v on v.id = r.vehicle_id where r.id = $1`, [id, m.userId])).rows[0];
    if (!r) return null;
    if (!held.has("vreq.read_all") && !held.has("vreq.decide") && !r.requested_by_me) return null;
    const events = (await q.query<VehicleRequestEvent>(
      `select e.from_status, e.to_status, e.note, e.created_at::text, emp.full_name as actor_name
         from vehicle_request_events e left join employees emp on emp.user_id = e.actor_id where e.request_id = $1 order by e.created_at, e.id`, [id])).rows;
    return { ...r, events };
  });
}

/** For the request form: active employees, and for the decision: active vehicles that nobody holds (the pool). */
export function employeesToChoose(driver: Driver, m: Membership) {
  return authorized(driver, m, "vreq.request", async (q) => (await q.query<{ id: string; full_name: string; employee_no: string | null }>(
    "select id, full_name, employee_no from employees where active order by full_name")).rows);
}
export function poolVehicles(driver: Driver, m: Membership) {
  return authorized(driver, m, "vreq.decide", async (q) => (await q.query<{ id: string; registration_no: string; label: string }>(
    `select v.id, v.registration_no, concat_ws(' ', v.make, v.model) as label from vehicles v
      where v.status = 'active' and not exists (select 1 from vehicle_custody c where c.vehicle_id = v.id and c.to_date is null) order by v.registration_no`)).rows);
}

async function myEmployee(q: import("@/lib/db/types").Queryable, userId: string): Promise<string> {
  const e = (await q.query<{ id: string }>("select id from employees where user_id = $1 and active", [userId])).rows[0];
  if (!e) throw new UserError("You need an employee record linked to your login to ask for a vehicle. Ask an administrator.");
  return e.id;
}

export async function requestVehicle(driver: Driver, m: Membership, raw: unknown): Promise<string> {
  const p = vehicleRequestSchema.safeParse(raw);
  if (!p.success) throw new UserError("Fix the highlighted fields.", fieldErrors(p.error));
  const v = p.data;
  return authorized(driver, m, "vreq.request", async (q) => {
    const emp = await myEmployee(q, m.userId);
    if ((await q.query("select 1 from employees where id = $1 and active", [v.for_employee])).rows.length === 0) throw new UserError("Choose an active employee.", { for_employee: "Choose an active employee" });
    let row: { id: string; request_no: string };
    try {
      row = (await q.query<{ id: string; request_no: string }>(
        "insert into vehicle_requests(requested_by, for_employee, reason, vehicle_class, needed_from) values ($1,$2,$3,$4,$5::date) returning id, request_no",
        [emp, v.for_employee, v.reason, v.vehicle_class ?? null, v.needed_from])).rows[0];
    } catch (e) { friendly(e); }
    await q.query("insert into vehicle_request_events(request_id, from_status, to_status, actor_id) values ($1, null, 'requested', $2)", [row.id, m.userId]);
    await notify(q, await usersWithPermission(q, m.tenantId, "vreq.decide"), "vreq.requested", { request_id: row.id, request_no: row.request_no, text: `${row.request_no}: ${v.reason}` }, m.userId);
    return row.id;
  });
}

/** The permission each step needs. Cancelling is also open to the person who asked (checked below). */
export const VREQ_TRANSITION_PERMISSION: Record<string, string> = { assigned: "vreq.decide", purchase_approved: "vreq.decide", rejected: "vreq.decide", cancelled: "vreq.request" };

/** The one way a vehicle request changes status. */
export async function transitionVehicleRequest(driver: Driver, m: Membership, id: string, to: string, opts: { note?: string; vehicleId?: string } = {}): Promise<void> {
  const permission = VREQ_TRANSITION_PERMISSION[to];
  if (!permission) throw new UserError("That step is not available.");
  return authorizedAny(driver, m, ["vreq.decide", "vreq.request"], async (q, held) => {
    const r = (await q.query<{ request_no: string; reason: string; requester_user: string | null }>(
      "select r.request_no, r.reason, re.user_id as requester_user from vehicle_requests r join employees re on re.id = r.requested_by where r.id = $1", [id])).rows[0];
    if (!r) throw new UserError("Vehicle request not found.");
    const mine = r.requester_user === m.userId;
    if (!(held.has("vreq.decide") || (to === "cancelled" && mine && held.has("vreq.request")))) throw new ForbiddenError(permission);
    try {
      await q.query("select vehicle_request_transition($1, $2, $3, $4, $5)", [id, to, m.userId, opts.note ?? null, opts.vehicleId || null]);
    } catch (e) { friendly(e); }
    const payload = { request_id: id, request_no: r.request_no, to, text: `${r.request_no}: ${r.reason}` };
    if (to === "cancelled") await notify(q, await usersWithPermission(q, m.tenantId, "vreq.decide"), "vreq.cancelled", payload, m.userId);
    else await notify(q, [r.requester_user], `vreq.${to}`, payload, m.userId);
  });
}
