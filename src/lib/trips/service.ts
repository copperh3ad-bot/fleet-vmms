// Trip requests and their approval (ADR-045, phase 5a). An optional module: off until an administrator sets settings.module_trips to 1.
// Every status change goes through transitionTrip (CLAUDE.md rule 4), which calls the SQL function trip_transition; that function
// writes the trip_events row and, on departure and return, the odometer reading. Nothing else updates trips.status.
import { z } from "zod";
import type { Driver, Queryable } from "@/lib/db/types";
import { authorized, authorizedAny, ForbiddenError, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";
import { notify, usersWithPermission } from "@/lib/notify";
import { tenantPlan } from "@/lib/billing/plans";
import { normalizePhone } from "@/lib/phone";
import { hashToken, newToken } from "@/lib/odometer/link";
import { routeToken } from "@/lib/orgs";

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
  /this vehicle belongs to another department/, /pool cars belong to the [A-Za-z ]+ department/, /this car is held by someone outside[^"]*/,
  /that quote is not available to award/, /that invoice is not waiting for a check/, /segregation of duties: the person who awarded[^"]*/, /the invoice differs from the awarded amount[^"]*/, /a note of at least 5 characters is required/, /choose a decision/,
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
export async function requireOn(q: Queryable) { if (!(await tripsOn(q))) throw new UserError("Trips are not switched on for this organization."); }

export function tripsEnabled(driver: Driver, m: Membership): Promise<boolean> {
  return authorizedAny(driver, m, ["trip.request", "trip.approve", "trip.dispatch", "trip.read_all", "gate.use", "admin.settings", "invoice.verify"], (q) => tripsOn(q));
}

export type TripRow = {
  id: string; trip_no: string; kind: string; status: string; purpose: string; from_place: string; to_place: string; start_at: string; end_at: string;
  requester_name: string; registration_no: string | null; driver_name: string | null; distance_km: string | null; mine: boolean; dispatchable: boolean;
};
/** True for a pick and drop run, and for a trip on (or asking for) a vehicle of the acting department. Only a department user can be true on the second half. */
const DISPATCHABLE = `(t.kind = 'pick_drop' or (acting_department() is not null and exists (select 1 from vehicles pv where pv.id = coalesce(t.vehicle_id, t.preferred_vehicle_id) and dept_ok(pv.id))))`;

/** A trip that was sent to logistics providers for quotes, or awarded to one. */
const OUTSOURCED = `(t.outsourced_vendor_id is not null or exists (select 1 from trip_quotes oq where oq.trip_id = t.id))`;
/** A trip with a provider invoice on it: seen by the people who check invoices. */
const INVOICED = `exists (select 1 from trip_invoices ti where ti.trip_id = t.id)`;

const ROW_SQL = `select t.id, t.trip_no, t.kind, t.status, t.purpose, t.from_place, t.to_place, t.start_at::text, t.end_at::text,
       re.full_name as requester_name, v.registration_no, d.full_name as driver_name,
       (t.odometer_in - t.odometer_out)::text as distance_km, (re.user_id = $1 or d.user_id = $1) as mine, ${DISPATCHABLE} as dispatchable
  from trips t join employees re on re.id = t.requested_by left join vehicles v on v.id = t.vehicle_id left join employees d on d.id = t.driver_id`;

/** trip.read_all sees every trip; anyone else sees the trips they asked for or drive. A person limited to their own vehicles sees only trips on them. */
export function listTrips(driver: Driver, m: Membership, opts: { status?: string } = {}): Promise<TripRow[]> {
  return authorizedAny(driver, m, ["trip.request", "trip.approve", "trip.dispatch", "trip.read_all", "trip.award", "invoice.verify"], async (q, held) => {
    await requireOn(q);
    const params: unknown[] = [m.userId];
    const where: string[] = ["(t.vehicle_id is null or dept_ok(t.vehicle_id))"];
    // Logistics sees every pick and drop run and every trip on its own vehicles, plus its own trips; the others see their own unless they may read or approve all.
    if (!held.has("trip.read_all") && !held.has("trip.approve")) {
      // Someone who awards quotes also sees the trips that were sent to providers, whoever asked for them (ADR-078).
      const own = `re.user_id = $1 or d.user_id = $1${held.has("trip.dispatch") ? ` or ${DISPATCHABLE}` : ""}${held.has("trip.award") ? ` or ${OUTSOURCED}` : ""}${held.has("invoice.verify") ? ` or ${INVOICED}` : ""}`;
      where.push(`(${own})`);
    }
    if (m.vehicleScope === "own") where.push("(re.user_id = $1 or d.user_id = $1)");
    if (opts.status) { params.push(opts.status); where.push(`t.status = $${params.length}`); }
    return (await q.query<TripRow>(`${ROW_SQL} ${where.length ? "where " + where.join(" and ") : ""} order by t.start_at desc limit 300`, params)).rows;
  });
}

export type TripEvent = { from_status: string | null; to_status: string; note: string | null; created_at: string; actor_name: string | null };
export type TripDetail = TripRow & {
  stops: string | null; passengers: number | null; vehicle_id: string | null; driver_id: string | null; preferred_vehicle: string | null; decision_note: string | null;
  odometer_out: string | null; odometer_in: string | null; requested_by_me: boolean; outsourced_visible: boolean; invoiced: boolean; outsourced_vendor: string | null; award_amount: string | null; vendor_vehicle_text: string | null; vendor_driver_text: string | null; driver_licence_expired: boolean; events: TripEvent[];
};

export function getTrip(driver: Driver, m: Membership, id: string): Promise<TripDetail | null> {
  return authorizedAny(driver, m, ["trip.request", "trip.approve", "trip.dispatch", "trip.read_all", "trip.award", "invoice.verify"], async (q, held) => {
    await requireOn(q);
    const t = (await q.query<Omit<TripDetail, "events">>(
      `select t.id, t.trip_no, t.kind, t.stops, t.status, t.purpose, t.from_place, t.to_place, t.start_at::text, t.end_at::text, t.passengers, t.vehicle_id, t.driver_id,
              t.decision_note, t.odometer_out::text, t.odometer_in::text, ov.name as outsourced_vendor, ${OUTSOURCED} as outsourced_visible, ${INVOICED} as invoiced, t.award_amount::text, t.vendor_vehicle_text, t.vendor_driver_text, re.full_name as requester_name, v.registration_no, d.full_name as driver_name,
              pv.registration_no as preferred_vehicle, (t.odometer_in - t.odometer_out)::text as distance_km, (re.user_id = $2 or d.user_id = $2) as mine,
              (re.user_id = $2) as requested_by_me, ${DISPATCHABLE.replace(/\$1/g, "$2")} as dispatchable,
              coalesce((select l.expires_on < t.end_at::date from driver_licences l where l.employee_id = t.driver_id), false) as driver_licence_expired
         from trips t join employees re on re.id = t.requested_by left join vehicles v on v.id = t.vehicle_id left join employees d on d.id = t.driver_id
         left join vehicles pv on pv.id = t.preferred_vehicle_id left join vendors ov on ov.id = t.outsourced_vendor_id where t.id = $1 and (t.vehicle_id is null or dept_ok(t.vehicle_id))`, [id, m.userId])).rows[0];
    if (!t) return null;
    if (!held.has("trip.read_all") && !held.has("trip.approve") && !t.mine && !(held.has("trip.dispatch") && t.dispatchable) && !(held.has("trip.award") && t.outsourced_visible) && !(held.has("invoice.verify") && t.invoiced)) return null;
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
      `select id, registration_no, concat_ws(' ', make, model) as label from vehicles where status = 'active' and dept_ok(id) ${opts.poolOnly ? "and is_pool" : ""} order by registration_no`)).rows,
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
    const t = (await q.query<{ kind: string; dispatchable: boolean; trip_no: string; status: string; requester_user: string | null; driver_user: string | null; purpose: string }>(
      `select t.kind, ${DISPATCHABLE} as dispatchable, t.trip_no, t.status, t.purpose, re.user_id as requester_user, d.user_id as driver_user
         from trips t join employees re on re.id = t.requested_by left join employees d on d.id = t.driver_id where t.id = $1`, [id])).rows[0];
    if (!t) throw new UserError("Trip not found.");
    // approvers act on any trip; a requester may cancel only their own request. The driver of an approved trip may also record start and return.
    const isMine = t.requester_user === m.userId;
    const driverMe = t.driver_user === m.userId;
    const allowed = held.has("trip.approve") || (t.dispatchable && held.has("trip.dispatch")) || (to === "cancelled" && isMine && held.has("trip.request")) || ((to === "started" || to === "completed") && driverMe);
    if (!allowed) throw new ForbiddenError(permission);
    try {
      await q.query("select trip_transition($1, $2, $3, $4, $5, $6, $7)", [id, to, m.userId, opts.note ?? null, opts.vehicleId || null, opts.driverId || null, odo]);
    } catch (e) { friendly(e); }
    const payload = { trip_id: id, trip_no: t.trip_no, to, text: `${t.trip_no}: ${t.purpose}` };
    if (to === "approved") {
      const drv = (await q.query<{ user_id: string | null }>("select d.user_id from trips t join employees d on d.id = t.driver_id where t.id = $1", [id])).rows[0];
      await notify(q, [t.requester_user, drv?.user_id], "trip.approved", payload, m.userId);
    } else if (to === "rejected") await notify(q, [t.requester_user], "trip.rejected", payload, m.userId);
    else if (to === "cancelled") await notify(q, [t.requester_user, t.driver_user, ...(await usersWithPermission(q, m.tenantId, t.dispatchable ? "trip.dispatch" : "trip.approve"))], "trip.cancelled", payload, m.userId);
  });
}

// ---------- Pool cars (logistics) ----------
export type PoolCar = { id: string; registration_no: string; label: string; status: string; is_pool: boolean };

/** Every vehicle that is not disposed, with whether it is a pool car. For the people who dispatch or manage vehicles. */
export function listPoolCandidates(driver: Driver, m: Membership): Promise<PoolCar[]> {
  return authorizedAny(driver, m, ["trip.dispatch", "vehicle.write"], async (q) => {
    await requireOn(q);
    return (await q.query<PoolCar>("select id, registration_no, concat_ws(' ', make, model) as label, status, is_pool from vehicles where status <> 'disposed' and dept_ok(id) order by is_pool desc, registration_no")).rows;
  });
}

/** Marks a vehicle as a pool car, or takes it out of the pool. A pool car with a live pick and drop run cannot be taken out. */
export function setPoolCar(driver: Driver, m: Membership, vehicleId: string, pool: boolean): Promise<void> {
  return authorizedAny(driver, m, ["trip.dispatch", "vehicle.write"], async (q) => {
    await requireOn(q);
    if (!pool && (await q.query("select 1 from trips where vehicle_id = $1 and kind = 'pick_drop' and status in ('approved','started')", [vehicleId])).rows.length)
      throw new UserError("This car has pick and drop runs booked. Cancel or finish them first.");
    try {
      const r = await q.query("update vehicles set is_pool = $2 where id = $1 and status <> 'disposed' and dept_ok(id) returning id", [vehicleId, pool]);
      if (r.rows.length === 0) throw new UserError("Vehicle not found.");
    } catch (e) { friendly(e); }
  });
}

// ---------- Outsourced trips (ADR-078, V1.4): ask logistics providers for quotes, record them, award one. A Pro feature. ----------

export async function requireOutsourcing(driver: Driver, m: Membership) {
  if (!(await tenantPlan(driver, m.tenantId)).outsourcedTrips) throw new UserError("Sending trips to logistics providers for quotes is part of the Pro plan.");
}

/** Whether the organization's plan includes outsourced trips (pages show or hide the section from this). */
export async function outsourcingOn(driver: Driver, m: Membership): Promise<boolean> {
  return (await tenantPlan(driver, m.tenantId)).outsourcedTrips;
}

export type TripQuote = {
  id: string; vendor_id: string; vendor_name: string; vendor_phone: string | null; status: string; amount: string | null;
  vehicle_text: string | null; driver_text: string | null; notes: string | null; valid_until: string | null; requested_at: string; quoted_at: string | null;
};

export function listTripQuotes(driver: Driver, m: Membership, tripId: string): Promise<TripQuote[]> {
  return authorized(driver, m, "trip.award", async (q) => {
    await requireOn(q);
    return (await q.query<TripQuote>(
      `select tq.id, tq.vendor_id, v.name as vendor_name, v.phone as vendor_phone, tq.status, tq.amount::text, tq.vehicle_text, tq.driver_text, tq.notes,
              tq.valid_until::text, tq.requested_at::text, tq.quoted_at::text
         from trip_quotes tq join vendors v on v.id = tq.vendor_id where tq.trip_id = $1
        order by (tq.status = 'awarded') desc, tq.amount nulls last, v.name`, [tripId])).rows;
  });
}

/** The active logistics providers (the vendors of kind 'logistics'). */
export function listLogisticsProviders(driver: Driver, m: Membership): Promise<{ id: string; name: string; phone: string | null }[]> {
  return authorized(driver, m, "trip.award", async (q) => (await q.query<{ id: string; name: string; phone: string | null }>(
    "select id, name, phone from vendors where kind = 'logistics' and status = 'active' order by name")).rows);
}

/** Asks each chosen provider for a quote on a trip that is still waiting for approval. A provider already asked is left as it is. Returns how many were newly asked. */
export async function requestTripQuotes(driver: Driver, m: Membership, tripId: string, vendorIds: string[]): Promise<number> {
  const ids = [...new Set(vendorIds.filter(Boolean))];
  if (ids.length === 0) throw new UserError("Choose at least one provider.");
  await requireOutsourcing(driver, m);
  return authorized(driver, m, "trip.award", async (q) => {
    await requireOn(q);
    const t = (await q.query<{ status: string; trip_no: string; purpose: string }>("select status, trip_no, purpose from trips where id = $1", [tripId])).rows[0];
    if (!t) throw new UserError("Trip not found.");
    if (t.status !== "requested") throw new UserError("Quotes can only be asked for while the trip is waiting for approval.");
    const names: string[] = [];
    for (const id of ids) {
      const v = (await q.query<{ name: string }>("select name from vendors where id = $1 and kind = 'logistics' and status = 'active'", [id])).rows[0];
      if (!v) throw new UserError("Choose active logistics providers only.");
      const ins = await q.query("insert into trip_quotes(trip_id, vendor_id, requested_by) values ($1,$2,$3) on conflict (trip_id, vendor_id) do nothing returning id", [tripId, id, m.userId]);
      if (ins.rows.length) names.push(v.name);
    }
    if (names.length) await q.query("insert into trip_events(trip_id, from_status, to_status, actor_id, note) values ($1, 'requested', 'requested', $2, $3)", [tripId, m.userId, `Quote asked from ${names.join(", ")}`]);
    return names.length;
  });
}

export const tripInvoiceSchema = z.object({
  invoice_no: z.string().trim().min(1, "Enter the invoice number").max(60),
  invoice_date: z.iso.date("Enter the invoice date"),
  amount: z.preprocess((v) => (typeof v === "string" ? v.replace(/,/g, "").trim() : v), z.coerce.number("Enter the invoiced amount").positive("Enter an amount above zero").max(1e9)),
  notes: z.preprocess(blank, z.string().trim().max(1000).optional()),
});

export const tripQuoteSchema = z.object({
  amount: z.preprocess((v) => (typeof v === "string" ? v.replace(/,/g, "").trim() : v), z.coerce.number("Enter the amount").positive("Enter an amount above zero").max(1e9)),
  vehicle_text: z.preprocess(blank, z.string().trim().max(120).optional()),
  driver_text: z.preprocess(blank, z.string().trim().max(120).optional()),
  notes: z.preprocess(blank, z.string().trim().max(1000).optional()),
  valid_until: z.preprocess(blank, z.iso.date().optional()),
});

/** Records a provider's quote (sent by phone, WhatsApp or email) against the request. A quote can be corrected until one is awarded. */
export async function recordTripQuote(driver: Driver, m: Membership, quoteId: string, raw: unknown): Promise<void> {
  const p = tripQuoteSchema.safeParse(raw);
  if (!p.success) throw new UserError("Fix the highlighted fields.", fieldErrors(p.error));
  const d = p.data;
  await requireOutsourcing(driver, m);
  return authorized(driver, m, "trip.award", async (q) => {
    await requireOn(q);
    const row = (await q.query<{ trip_id: string; status: string; vendor_name: string; trip_status: string }>(
      `select tq.trip_id, tq.status, v.name as vendor_name, t.status as trip_status from trip_quotes tq join vendors v on v.id = tq.vendor_id join trips t on t.id = tq.trip_id where tq.id = $1 for update of tq`, [quoteId])).rows[0];
    if (!row) throw new UserError("Quote request not found.");
    if (row.trip_status !== "requested" || !["requested", "quoted", "declined"].includes(row.status)) throw new UserError("This trip no longer takes quotes.");
    await q.query(
      `update trip_quotes set status = 'quoted', amount = $2, vehicle_text = $3, driver_text = $4, notes = $5, valid_until = $6, quoted_by = $7, quoted_at = now() where id = $1`,
      [quoteId, d.amount, d.vehicle_text ?? null, d.driver_text ?? null, d.notes ?? null, d.valid_until ?? null, m.userId]);
    await q.query("insert into trip_events(trip_id, from_status, to_status, actor_id, note) values ($1, 'requested', 'requested', $2, $3)",
      [row.trip_id, m.userId, `Quote from ${row.vendor_name}: ${d.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`]);
  });
}

/** The provider said no. */
export async function declineTripQuote(driver: Driver, m: Membership, quoteId: string): Promise<void> {
  await requireOutsourcing(driver, m);
  return authorized(driver, m, "trip.award", async (q) => {
    const r = await q.query("update trip_quotes set status = 'declined' where id = $1 and status in ('requested','quoted') returning trip_id", [quoteId]);
    if (r.rows.length === 0) throw new UserError("That request can no longer be declined.");
  });
}

/** Awards one quote: the trip becomes approved as outsourced to that provider, and the other requests close. The requester cannot award their own trip (ADR-077 for a sole administrator). */
export async function awardTripQuote(driver: Driver, m: Membership, tripId: string, quoteId: string, note?: string): Promise<void> {
  await requireOutsourcing(driver, m);
  return authorized(driver, m, "trip.award", async (q) => {
    await requireOn(q);
    const t = (await q.query<{ trip_no: string; purpose: string; requester_user: string | null }>(
      "select t.trip_no, t.purpose, re.user_id as requester_user from trips t join employees re on re.id = t.requested_by where t.id = $1", [tripId])).rows[0];
    if (!t) throw new UserError("Trip not found.");
    try { await q.query("select trip_transition($1, 'approved', $2, $3, null, null, null, $4)", [tripId, m.userId, note ?? null, quoteId]); }
    catch (e) { friendly(e); }
    await notify(q, [t.requester_user], "trip.approved", { trip_id: tripId, trip_no: t.trip_no, to: "approved", text: `${t.trip_no}: ${t.purpose}` }, m.userId);
  });
}

// ---------- The provider's quote link (ADR-078 phase B) ----------

export type NewTripQuoteLink = { token: string; expires_at: string; trip_no: string; vendor_name: string; phone: { e164: string; digits: string; display: string } };
const TRIP_QUOTE_LINK_HOURS = 168;

/**
 * A fresh single-use link for one provider's quote on one trip, to be sent to that provider's own phone number. Any earlier unused link for the
 * same request stops working. Providers are added by the organization and never sign up, so this link is how a provider quotes.
 */
export async function createTripQuoteLink(driver: Driver, m: Membership, quoteId: string): Promise<NewTripQuoteLink> {
  await requireOutsourcing(driver, m);
  const made = await authorized(driver, m, "trip.award", async (q) => {
    await requireOn(q);
    const r = (await q.query<{ status: string; trip_status: string; trip_no: string; vendor_id: string; vendor_name: string; phone: string | null }>(
      `select tq.status, t.status as trip_status, t.trip_no, tq.vendor_id, v.name as vendor_name, v.phone
         from trip_quotes tq join trips t on t.id = tq.trip_id join vendors v on v.id = tq.vendor_id where tq.id = $1`, [quoteId])).rows[0];
    if (!r) throw new UserError("Quote request not found.");
    if (r.trip_status !== "requested" || r.status !== "requested") throw new UserError("This provider is not waiting to quote on a trip that is still open.");
    const phone = normalizePhone(r.phone ?? "");
    if (!phone.ok) throw new UserError(`${r.vendor_name} has no mobile number a message can reach. Add it under Vendors first.`);
    await q.query("update public.quotation_links set revoked_at = now() where tenant_id = $1 and trip_quote_id = $2 and kind = 'trip_quote' and used_at is null and revoked_at is null", [m.tenantId, quoteId]);
    const token = newToken();
    const exp = (await q.query<{ e: string }>(
      `insert into public.quotation_links(token_hash, tenant_id, trip_quote_id, vendor_id, created_by, expires_at, kind)
       values ($1, $2, $3, $4, $5, now() + ($6 || ' hours')::interval, 'trip_quote') returning expires_at::text as e`,
      [hashToken(token), m.tenantId, quoteId, r.vendor_id, m.userId, String(TRIP_QUOTE_LINK_HOURS)])).rows[0].e;
    return { token, expires_at: exp, trip_no: r.trip_no, vendor_name: r.vendor_name, phone: { e164: phone.e164, digits: phone.digits, display: phone.display } };
  });
  try { await routeToken(driver, "trip_quote", m.tenantId, hashToken(made.token), made.expires_at); }
  catch {
    await authorized(driver, m, "trip.award", (q) => q.query("update public.quotation_links set revoked_at = now() where token_hash = $1", [hashToken(made.token)])).catch(() => undefined);
    throw new UserError("The link could not be created. Try again.");
  }
  return made;
}

// ---------- The provider's invoice (ADR-078 phase B2) ----------

export type TripInvoice = {
  id: string; invoice_no: string; invoice_date: string; amount: string; notes: string | null; status: string; decision_note: string | null; payable: string | null;
  submitted_at: string; verified_at: string | null; verifier_name: string | null;
};

/** Invoices on a trip: for the people who award, and for those who check invoices. */
export function listTripInvoices(driver: Driver, m: Membership, tripId: string): Promise<TripInvoice[]> {
  return authorizedAny(driver, m, ["trip.award", "invoice.verify"], async (q) => {
    await requireOn(q);
    return (await q.query<TripInvoice>(
      `select i.id, i.invoice_no, i.invoice_date::text, i.amount::text, i.notes, i.status, i.decision_note, i.payable::text, i.submitted_at::text, i.verified_at::text, e.full_name as verifier_name
         from trip_invoices i left join employees e on e.user_id = i.verified_by where i.trip_id = $1 order by i.submitted_at desc`, [tripId])).rows;
  });
}

/** A fresh single-use link for the awarded provider's invoice on a completed trip, to be sent to that provider's own phone number. */
export async function createTripInvoiceLink(driver: Driver, m: Membership, tripId: string): Promise<NewTripQuoteLink> {
  await requireOutsourcing(driver, m);
  const made = await authorized(driver, m, "trip.award", async (q) => {
    await requireOn(q);
    const r = (await q.query<{ status: string; trip_no: string; vendor_id: string | null; vendor_name: string | null; phone: string | null; live: boolean }>(
      `select t.status, t.trip_no, t.outsourced_vendor_id as vendor_id, v.name as vendor_name, v.phone,
              exists (select 1 from trip_invoices i where i.trip_id = t.id and i.status in ('submitted','verified')) as live
         from trips t left join vendors v on v.id = t.outsourced_vendor_id where t.id = $1`, [tripId])).rows[0];
    if (!r) throw new UserError("Trip not found.");
    if (!r.vendor_id) throw new UserError("This trip was not given to a logistics provider.");
    if (r.status !== "completed") throw new UserError("A provider invoices once the trip is marked as returned.");
    if (r.live) throw new UserError("An invoice has already been sent for this trip.");
    const phone = normalizePhone(r.phone ?? "");
    if (!phone.ok) throw new UserError(`${r.vendor_name} has no mobile number a message can reach. Add one under Vendors first.`);
    await q.query("update public.quotation_links set revoked_at = now() where tenant_id = $1 and trip_id = $2 and kind = 'trip_invoice' and used_at is null and revoked_at is null", [m.tenantId, tripId]);
    const token = newToken();
    const exp = (await q.query<{ e: string }>(
      `insert into public.quotation_links(token_hash, tenant_id, trip_id, vendor_id, created_by, expires_at, kind)
       values ($1, $2, $3, $4, $5, now() + ($6 || ' hours')::interval, 'trip_invoice') returning expires_at::text as e`,
      [hashToken(token), m.tenantId, tripId, r.vendor_id, m.userId, String(TRIP_QUOTE_LINK_HOURS)])).rows[0].e;
    return { token, expires_at: exp, trip_no: r.trip_no, vendor_name: r.vendor_name ?? "", phone: { e164: phone.e164, digits: phone.digits, display: phone.display } };
  });
  try { await routeToken(driver, "trip_invoice", m.tenantId, hashToken(made.token), made.expires_at); }
  catch {
    await authorized(driver, m, "trip.award", (q) => q.query("update public.quotation_links set revoked_at = now() where token_hash = $1", [hashToken(made.token)])).catch(() => undefined);
    throw new UserError("The link could not be created. Try again.");
  }
  return made;
}

/** Finance checks a provider's invoice: pay the awarded amount, pay what was billed (with a note), or send it back (with a note). */
export async function verifyTripInvoice(driver: Driver, m: Membership, invoiceId: string, decision: string, note?: string): Promise<void> {
  if (!["pay_approved", "pay_invoiced", "return"].includes(decision)) throw new UserError("Choose a decision.");
  return authorized(driver, m, "invoice.verify", async (q) => {
    await requireOn(q);
    const t = (await q.query<{ trip_id: string; trip_no: string }>("select i.trip_id, t.trip_no from trip_invoices i join trips t on t.id = i.trip_id where i.id = $1", [invoiceId])).rows[0];
    if (!t) throw new UserError("Invoice not found.");
    try { await q.query("select trip_invoice_verify($1, $2, $3, $4)", [invoiceId, m.userId, decision, note?.trim() || null]); } catch (e) { friendly(e); }
  });
}
