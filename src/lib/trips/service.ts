// Trip requests and their approval (ADR-045, phase 5a). An optional module: off until an administrator sets settings.module_trips to 1.
// Every status change goes through transitionTrip (CLAUDE.md rule 4), which calls the SQL function trip_transition; that function
// writes the trip_events row and, on departure and return, the odometer reading. Nothing else updates trips.status.
import { z } from "zod";
import type { Driver, Queryable } from "@/lib/db/types";
import { authorized, authorizedAny, ForbiddenError, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";
import { notify, usersWithPermission } from "@/lib/notify";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const TRIP_STATUS_LABEL: Record<string, string> = {
  requested: "Waiting for approval", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled", started: "On the road", completed: "Completed",
};

export const tripSchema = z.object({
  kind: z.enum(["trip", "pick_drop"]).default("trip"),
  stops: z.preprocess(blank, z.string().trim().max(500).optional()),
  purpose: z.string().trim().min(3, "Say what the trip is for").max(300),
  from_place: z.string().trim().min(2, "Where does it start?").max(120),
  to_place: z.string().trim().min(2, "Where is it going?").max(120),
  start_at: z.string().min(1, "Enter the start date and time").refine((s) => !Number.isNaN(Date.parse(s)), "Enter a valid date and time"),
  end_at: z.string().min(1, "Enter the end date and time").refine((s) => !Number.isNaN(Date.parse(s)), "Enter a valid date and time"),
  passengers: z.preprocess(blank, z.coerce.number().int().min(0).max(200).optional()),
  preferred_vehicle_id: z.preprocess(blank, z.uuid().optional()),
}).superRefine((v, ctx) => {
  if (Date.parse(v.end_at) <= Date.parse(v.start_at)) ctx.addIssue({ code: "custom", path: ["end_at"], message: "The end must be after the start" });
});

/** Messages raised by trip_transition and the overlap guard that a person can act on. Anything else is a bug and stays loud. */
const KNOWN = [
  /trip not found/, /illegal trip transition [a-z]+ -> [a-z]+/, /segregation of duties: [^"]*/, /choose a vehicle for this trip/, /choose a driver for this trip/,
  /vehicle not found/, /that vehicle is not available[^"]*/, /pick and drop runs use a pool car/, /the driver must be an active employee/, /a reason of at least 5 characters is required/,
  /enter the odometer reading [a-z ]+/, /the return reading is below the departure reading/,
  /that vehicle is already booked for part of this time/, /that driver is already on another trip for part of this time/,
];
function friendly(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  for (const re of KNOWN) { const hit = msg.match(re); if (hit) throw new UserError(hit[0].replace(/^./, (c) => c.toUpperCase()) + (hit[0].endsWith(".") ? "" : ".")); }
  throw e;
}

/** Is the module switched on for this organization? Pages and actions say "not available" when it is not. */
export async function tripsOn(q: Queryable): Promise<boolean> {
  return (await q.query<{ value: string }>("select value from settings where key = 'module_trips'")).rows[0]?.value === "1";
}
async function requireOn(q: Queryable) { if (!(await tripsOn(q))) throw new UserError("Trips are not switched on for this organization."); }

export function tripsEnabled(driver: Driver, m: Membership): Promise<boolean> {
  return authorizedAny(driver, m, ["trip.request", "trip.approve", "trip.dispatch", "trip.read_all", "gate.use", "admin.settings"], (q) => tripsOn(q));
}

export type TripRow = {
  id: string; trip_no: string; kind: string; status: string; purpose: string; from_place: string; to_place: string; start_at: string; end_at: string;
  requester_name: string; registration_no: string | null; driver_name: string | null; distance_km: string | null; mine: boolean;
};
const ROW_SQL = `select t.id, t.trip_no, t.kind, t.status, t.purpose, t.from_place, t.to_place, t.start_at::text, t.end_at::text,
       re.full_name as requester_name, v.registration_no, d.full_name as driver_name,
       (t.odometer_in - t.odometer_out)::text as distance_km, (re.user_id = $1 or d.user_id = $1) as mine
  from trips t join employees re on re.id = t.requested_by left join vehicles v on v.id = t.vehicle_id left join employees d on d.id = t.driver_id`;

/** trip.read_all sees every trip; anyone else sees the trips they asked for or drive. A person limited to their own vehicles sees only trips on them. */
export function listTrips(driver: Driver, m: Membership, opts: { status?: string } = {}): Promise<TripRow[]> {
  return authorizedAny(driver, m, ["trip.request", "trip.approve", "trip.dispatch", "trip.read_all"], async (q, held) => {
    await requireOn(q);
    const params: unknown[] = [m.userId];
    const where: string[] = [];
    // Logistics sees every pick and drop run plus its own trips; the others see their own unless they may read or approve all.
    if (!held.has("trip.read_all") && !held.has("trip.approve")) where.push(held.has("trip.dispatch") ? "(re.user_id = $1 or d.user_id = $1 or t.kind = 'pick_drop')" : "(re.user_id = $1 or d.user_id = $1)");
    if (m.vehicleScope === "own") where.push("(re.user_id = $1 or d.user_id = $1)");
    if (opts.status) { params.push(opts.status); where.push(`t.status = $${params.length}`); }
    return (await q.query<TripRow>(`${ROW_SQL} ${where.length ? "where " + where.join(" and ") : ""} order by t.start_at desc limit 300`, params)).rows;
  });
}

export type TripEvent = { from_status: string | null; to_status: string; note: string | null; created_at: string; actor_name: string | null };
export type TripDetail = TripRow & {
  stops: string | null; passengers: number | null; vehicle_id: string | null; driver_id: string | null; preferred_vehicle: string | null; decision_note: string | null;
  odometer_out: string | null; odometer_in: string | null; requested_by_me: boolean; driver_licence_expired: boolean; events: TripEvent[];
};

export function getTrip(driver: Driver, m: Membership, id: string): Promise<TripDetail | null> {
  return authorizedAny(driver, m, ["trip.request", "trip.approve", "trip.dispatch", "trip.read_all"], async (q, held) => {
    await requireOn(q);
    const t = (await q.query<Omit<TripDetail, "events">>(
      `select t.id, t.trip_no, t.kind, t.stops, t.status, t.purpose, t.from_place, t.to_place, t.start_at::text, t.end_at::text, t.passengers, t.vehicle_id, t.driver_id,
              t.decision_note, t.odometer_out::text, t.odometer_in::text, re.full_name as requester_name, v.registration_no, d.full_name as driver_name,
              pv.registration_no as preferred_vehicle, (t.odometer_in - t.odometer_out)::text as distance_km, (re.user_id = $2 or d.user_id = $2) as mine,
              (re.user_id = $2) as requested_by_me,
              coalesce((select l.expires_on < t.end_at::date from driver_licences l where l.employee_id = t.driver_id), false) as driver_licence_expired
         from trips t join employees re on re.id = t.requested_by left join vehicles v on v.id = t.vehicle_id left join employees d on d.id = t.driver_id
         left join vehicles pv on pv.id = t.preferred_vehicle_id where t.id = $1`, [id, m.userId])).rows[0];
    if (!t) return null;
    if (!held.has("trip.read_all") && !held.has("trip.approve") && !t.mine && !(held.has("trip.dispatch") && t.kind === "pick_drop")) return null;
    const events = (await q.query<TripEvent>(
      `select e.from_status, e.to_status, e.note, e.created_at::text, coalesce(emp.full_name, null) as actor_name
         from trip_events e left join employees emp on emp.user_id = e.actor_id where e.trip_id = $1 order by e.created_at, e.id`, [id])).rows;
    return { ...t, events };
  });
}

/** Active vehicles an approver may assign, and the active employees who may drive. */
export function assignables(driver: Driver, m: Membership, opts: { poolOnly?: boolean } = {}) {
  return authorizedAny(driver, m, ["trip.request", "trip.approve", "trip.dispatch"], async (q) => ({
    vehicles: (await q.query<{ id: string; registration_no: string; label: string }>(
      `select id, registration_no, concat_ws(' ', make, model) as label from vehicles where status = 'active' ${opts.poolOnly ? "and is_pool" : ""} order by registration_no`)).rows,
    drivers: (await q.query<{ id: string; full_name: string }>("select id, full_name from employees where active order by full_name")).rows,
  }));
}

async function myEmployee(q: Queryable, userId: string): Promise<string> {
  const e = (await q.query<{ id: string }>("select id from employees where user_id = $1 and active", [userId])).rows[0];
  if (!e) throw new UserError("You need an employee record linked to your login to ask for a trip. Ask an administrator.");
  return e.id;
}

export async function requestTrip(driver: Driver, m: Membership, raw: unknown): Promise<string> {
  const p = tripSchema.safeParse(raw);
  if (!p.success) throw new UserError("Fix the highlighted fields.", fieldErrors(p.error));
  const t = p.data;
  return authorized(driver, m, "trip.request", async (q) => {
    await requireOn(q);
    const emp = await myEmployee(q, m.userId);
    if (t.preferred_vehicle_id && (await q.query("select 1 from vehicles where id = $1" + (t.kind === "pick_drop" ? " and is_pool" : ""), [t.preferred_vehicle_id])).rows.length === 0)
      throw new UserError(t.kind === "pick_drop" ? "Choose one of the pool cars." : "Vehicle not found.");
    const row = (await q.query<{ id: string; trip_no: string }>(
      `insert into trips(requested_by, kind, stops, purpose, from_place, to_place, start_at, end_at, passengers, preferred_vehicle_id)
       values ($1,$9,$10,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,$8) returning id, trip_no`,
      [emp, t.purpose, t.from_place, t.to_place, t.start_at, t.end_at, t.passengers ?? null, t.preferred_vehicle_id ?? null, t.kind, t.stops ?? null])).rows[0];
    await q.query("insert into trip_events(trip_id, from_status, to_status, actor_id) values ($1, null, 'requested', $2)", [row.id, m.userId]);
    await notify(q, [...new Set([...(await usersWithPermission(q, m.tenantId, "trip.approve")), ...(t.kind === "pick_drop" ? await usersWithPermission(q, m.tenantId, "trip.dispatch") : [])])], "trip.requested", { trip_id: row.id, trip_no: row.trip_no, text: `${row.trip_no}: ${t.purpose}` }, m.userId);
    return row.id;
  });
}

/** What a caller may ask for. The permission each needs; cancelling is also open to the person who asked (checked below). */
export const TRIP_TRANSITION_PERMISSION: Record<string, string> = { approved: "trip.approve", rejected: "trip.approve", cancelled: "trip.request", started: "trip.approve", completed: "trip.approve" };

export type TripTransitionOptions = { note?: string; vehicleId?: string; driverId?: string; odometer?: string };

/** The one way a trip changes status. */
export async function transitionTrip(driver: Driver, m: Membership, id: string, to: string, opts: TripTransitionOptions = {}): Promise<void> {
  const permission = TRIP_TRANSITION_PERMISSION[to];
  if (!permission) throw new UserError("That step is not available.");
  const odo = opts.odometer?.trim() ? Number(opts.odometer) : null;
  if (odo !== null && (!Number.isFinite(odo) || odo < 0)) throw new UserError("Enter the odometer as a number.", { odometer: "Enter a number" });
  return authorizedAny(driver, m, ["trip.approve", "trip.dispatch", "trip.request"], async (q, held) => {
    await requireOn(q);
    const t = (await q.query<{ kind: string; trip_no: string; status: string; requester_user: string | null; driver_user: string | null; purpose: string }>(
      `select t.kind, t.trip_no, t.status, t.purpose, re.user_id as requester_user, d.user_id as driver_user
         from trips t join employees re on re.id = t.requested_by left join employees d on d.id = t.driver_id where t.id = $1`, [id])).rows[0];
    if (!t) throw new UserError("Trip not found.");
    // approvers act on any trip; a requester may cancel only their own request. The driver of an approved trip may also record start and return.
    const isMine = t.requester_user === m.userId;
    const driverMe = t.driver_user === m.userId;
    const allowed = held.has("trip.approve") || (t.kind === "pick_drop" && held.has("trip.dispatch")) || (to === "cancelled" && isMine && held.has("trip.request")) || ((to === "started" || to === "completed") && driverMe);
    if (!allowed) throw new ForbiddenError(permission);
    try {
      await q.query("select trip_transition($1, $2, $3, $4, $5, $6, $7)", [id, to, m.userId, opts.note ?? null, opts.vehicleId || null, opts.driverId || null, odo]);
    } catch (e) { friendly(e); }
    const payload = { trip_id: id, trip_no: t.trip_no, to, text: `${t.trip_no}: ${t.purpose}` };
    if (to === "approved") {
      const drv = (await q.query<{ user_id: string | null }>("select d.user_id from trips t join employees d on d.id = t.driver_id where t.id = $1", [id])).rows[0];
      await notify(q, [t.requester_user, drv?.user_id], "trip.approved", payload, m.userId);
    } else if (to === "rejected") await notify(q, [t.requester_user], "trip.rejected", payload, m.userId);
    else if (to === "cancelled") await notify(q, [t.requester_user, t.driver_user, ...(await usersWithPermission(q, m.tenantId, t.kind === "pick_drop" ? "trip.dispatch" : "trip.approve"))], "trip.cancelled", payload, m.userId);
  });
}

// ---------- Pool cars (logistics) ----------
export type PoolCar = { id: string; registration_no: string; label: string; status: string; is_pool: boolean };

/** Every vehicle that is not disposed, with whether it is a pool car. For the people who dispatch or manage vehicles. */
export function listPoolCandidates(driver: Driver, m: Membership): Promise<PoolCar[]> {
  return authorizedAny(driver, m, ["trip.dispatch", "vehicle.write"], async (q) => {
    await requireOn(q);
    return (await q.query<PoolCar>("select id, registration_no, concat_ws(' ', make, model) as label, status, is_pool from vehicles where status <> 'disposed' order by is_pool desc, registration_no")).rows;
  });
}

/** Marks a vehicle as a pool car, or takes it out of the pool. A pool car with a live pick and drop run cannot be taken out. */
export function setPoolCar(driver: Driver, m: Membership, vehicleId: string, pool: boolean): Promise<void> {
  return authorizedAny(driver, m, ["trip.dispatch", "vehicle.write"], async (q) => {
    await requireOn(q);
    if (!pool && (await q.query("select 1 from trips where vehicle_id = $1 and kind = 'pick_drop' and status in ('approved','started')", [vehicleId])).rows.length)
      throw new UserError("This car has pick and drop runs booked. Cancel or finish them first.");
    const r = await q.query("update vehicles set is_pool = $2 where id = $1 and status <> 'disposed' returning id", [vehicleId, pool]);
    if (r.rows.length === 0) throw new UserError("Vehicle not found.");
  });
}
