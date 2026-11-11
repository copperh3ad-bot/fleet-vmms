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
  requested: "Waiting for a decision", budget_confirmed: "Budget confirmed, waiting for approval", purchase_approved: "Purchase approved, vehicle to be added", assigned: "Vehicle given", rejected: "Rejected", cancelled: "Cancelled",
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
  /that vehicle is not available[^"]*/, /that vehicle is already held by someone/, /a reason of at least 5 characters is required/, /employee is not active/, /enter the budget amount/, /Finance must confirm a budget before the purchase is approved/,
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
export type DealerQuote = { id: string; dealer: string; vehicle: string; amount: string; valid_until: string | null; note: string | null; created_at: string; added_by_name: string | null; mine: boolean };
export type VehicleRequestDetail = VehicleRequestRow & { vehicle_id: string | null; decision_note: string | null; for_user: string | null; requested_by_me: boolean; purchase_budget: string | null; quotes: DealerQuote[]; events: VehicleRequestEvent[] };

const ROW_SQL = `select r.id, r.request_no, r.status, r.reason, r.vehicle_class, r.needed_from::text, fe.full_name as for_name, re.full_name as requester_name,
       v.registration_no, r.created_at::text, (re.user_id = $1) as mine
  from vehicle_requests r join employees fe on fe.id = r.for_employee join employees re on re.id = r.requested_by left join vehicles v on v.id = r.vehicle_id`;

/** vreq.read_all and vreq.decide see every request; anyone else sees only the ones they asked for. */
export function listVehicleRequests(driver: Driver, m: Membership, opts: { status?: string } = {}): Promise<VehicleRequestRow[]> {
  return authorizedAny(driver, m, ["vreq.request", "vreq.decide", "vreq.read_all", "vreq.confirm_budget"], async (q, held) => {
    const params: unknown[] = [m.userId];
    const where: string[] = [];
    if (!held.has("vreq.read_all") && !held.has("vreq.decide")) where.push("re.user_id = $1");
    if (opts.status) { params.push(opts.status); where.push(`r.status = $${params.length}`); }
    return (await q.query<VehicleRequestRow>(`${ROW_SQL} ${where.length ? "where " + where.join(" and ") : ""} order by r.created_at desc limit 300`, params)).rows;
  });
}

export function getVehicleRequest(driver: Driver, m: Membership, id: string): Promise<VehicleRequestDetail | null> {
  return authorizedAny(driver, m, ["vreq.request", "vreq.decide", "vreq.read_all", "vreq.confirm_budget"], async (q, held) => {
    const r = (await q.query<Omit<VehicleRequestDetail, "events" | "quotes">>(
      `select r.id, r.request_no, r.status, r.reason, r.vehicle_class, r.needed_from::text, fe.full_name as for_name, re.full_name as requester_name, v.registration_no, r.created_at::text,
              r.vehicle_id, r.decision_note, r.purchase_budget::text, fe.user_id as for_user, (re.user_id = $2) as requested_by_me, (re.user_id = $2) as mine
         from vehicle_requests r join employees fe on fe.id = r.for_employee join employees re on re.id = r.requested_by left join vehicles v on v.id = r.vehicle_id where r.id = $1`, [id, m.userId])).rows[0];
    if (!r) return null;
    if (!held.has("vreq.read_all") && !held.has("vreq.decide") && !r.requested_by_me) return null;
    const events = (await q.query<VehicleRequestEvent>(
      `select e.from_status, e.to_status, e.note, e.created_at::text, emp.full_name as actor_name
         from vehicle_request_events e left join employees emp on emp.user_id = e.actor_id where e.request_id = $1 order by e.created_at, e.id`, [id])).rows;
    const quotes = (await q.query<DealerQuote>(
      `select k.id, k.dealer, k.vehicle, k.amount::text, k.valid_until::text, k.note, k.created_at::text, emp.full_name as added_by_name, (k.added_by = $2) as mine
         from vehicle_request_quotes k left join employees emp on emp.user_id = k.added_by where k.request_id = $1 order by k.amount, k.created_at`, [id, m.userId])).rows;
    return { ...r, quotes, events };
  });
}

/** For the request form: active employees, and for the decision: active vehicles that nobody holds (the pool). */
export function employeesToChoose(driver: Driver, m: Membership) {
  return authorized(driver, m, "vreq.request", async (q) => (await q.query<{ id: string; full_name: string; employee_no: string | null }>(
    "select id, full_name, employee_no from employees where active order by full_name")).rows);
}
export type PoolVehicle = { id: string; registration_no: string; label: string; seats: number | null; load_capacity_kg: string | null; vehicle_class: string | null; base_location: string | null; warnings: string[] };

/** The SQL that finds what is wrong with a pool vehicle (D1): expired papers (latest of each kind) and an open repair. */
const WARNINGS_SQL = `array_remove(array[
  (select 'papers expired: ' || string_agg(replace(d.doc_type, '_', ' '), ', ' order by d.doc_type) from v_documents_status d where d.vehicle_id = v.id and d.doc_status = 'expired'),
  (select 'open repair: ' || string_agg(j.job_no, ', ' order by j.job_no) from job_cards j where j.vehicle_id = v.id and j.status not in ('closed','cancelled','rejected'))
], null)`;

export function poolVehicles(driver: Driver, m: Membership) {
  return authorizedAny(driver, m, ["vreq.assign", "vreq.decide", "vreq.see_pool"], async (q) => (await q.query<PoolVehicle>(
    `select v.id, v.registration_no, concat_ws(' ', v.make, v.model) as label, v.seats, v.load_capacity_kg::text, v.vehicle_class, v.base_location, ${WARNINGS_SQL} as warnings
       from vehicles v
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
    await notify(q, await usersWithPermission(q, m.tenantId, "vreq.assign"), "vreq.requested", { request_id: row.id, request_no: row.request_no, text: `${row.request_no}: ${v.reason}` }, m.userId);
    return row.id;
  });
}

// ---------- Purchase booking (ADR-091) ----------

export const dealerQuoteSchema = z.object({
  dealer: z.string().trim().min(2, "Enter the dealer").max(120),
  vehicle: z.string().trim().min(2, "Say which vehicle is quoted").max(160),
  amount: z.coerce.number("Enter the price").positive("Enter the price").max(99_999_999_999),
  valid_until: z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date").optional()),
  note: z.preprocess(blank, z.string().trim().max(500).optional()),
});
const QUOTE_PERMS = ["vreq.request", "vreq.decide", "vreq.assign", "vreq.confirm_budget"];

/** Record a dealer's quotation for the vehicle to be bought. Open while the purchase is still being decided. */
export function addDealerQuote(driver: Driver, m: Membership, requestId: string, raw: unknown): Promise<void> {
  const p = dealerQuoteSchema.safeParse(raw);
  return authorizedAny(driver, m, QUOTE_PERMS, async (q, held) => {
    if (!p.success) throw new UserError("Fix the highlighted fields.", fieldErrors(p.error));
    const r = (await q.query<{ status: string; mine: boolean }>(
      "select r.status, (re.user_id = $2) as mine from vehicle_requests r join employees re on re.id = r.requested_by where r.id = $1", [requestId, m.userId])).rows[0];
    if (!r) throw new UserError("Vehicle request not found.");
    // HR may add quotations to its own requests; the people who decide, give or confirm the budget may add to any
    if (!(r.mine && held.has("vreq.request")) && !(held.has("vreq.decide") || held.has("vreq.assign") || held.has("vreq.confirm_budget"))) throw new ForbiddenError("vreq.decide");
    if (!["requested", "budget_confirmed"].includes(r.status)) throw new UserError("Quotations can be added only until the purchase is approved.");
    await q.query("insert into vehicle_request_quotes(request_id, dealer, vehicle, amount, valid_until, note, added_by) values ($1,$2,$3,$4,$5::date,$6,$7)",
      [requestId, p.data.dealer, p.data.vehicle, p.data.amount, p.data.valid_until ?? null, p.data.note ?? null, m.userId]);
  });
}

/** Remove a quotation that was entered by mistake: the person who added it, or someone who decides. Only until the purchase is approved. */
export function removeDealerQuote(driver: Driver, m: Membership, quoteId: string): Promise<void> {
  return authorizedAny(driver, m, QUOTE_PERMS, async (q, held) => {
    const k = (await q.query<{ status: string; added_by: string | null }>(
      "select r.status, k.added_by from vehicle_request_quotes k join vehicle_requests r on r.id = k.request_id where k.id = $1", [quoteId])).rows[0];
    if (!k) throw new UserError("Quotation not found.");
    if (k.added_by !== m.userId && !held.has("vreq.decide")) throw new ForbiddenError("vreq.decide");
    if (!["requested", "budget_confirmed"].includes(k.status)) throw new UserError("Quotations can be changed only until the purchase is approved.");
    await q.query("delete from vehicle_request_quotes where id = $1", [quoteId]);
  });
}

/**
 * E5: the vehicle bought for an approved purchase has just been added (inside the same transaction as the add). The request closes and the
 * employee becomes the holder through the one transition function. Refused unless the request is an approved purchase and the person may give vehicles.
 */
export async function handOverPurchasedVehicle(q: import("@/lib/db/types").Queryable, m: Membership, requestId: string, vehicleId: string, plate: string): Promise<void> {
  const ok = (await q.query("select 1 from role_permissions where role_key = $1 and permission_key = 'vreq.assign'", [m.role])).rows.length > 0;
  if (!ok) throw new ForbiddenError("vreq.assign");
  const r = (await q.query<{ request_no: string; reason: string; requester_user: string | null; for_user: string | null }>(
    `select r.request_no, r.reason, re.user_id as requester_user, fe.user_id as for_user from vehicle_requests r
       join employees re on re.id = r.requested_by join employees fe on fe.id = r.for_employee where r.id = $1 and r.status = 'purchase_approved'`, [requestId])).rows[0];
  if (!r) throw new UserError("That vehicle request is not an approved purchase waiting for its vehicle.");
  try {
    await q.query("select vehicle_request_transition($1, 'assigned', $2, $3, $4, null)", [requestId, m.userId, `Bought and added: ${plate}`, vehicleId]);
  } catch (e) { friendly(e); }
  await notify(q, [r.requester_user, r.for_user], "vreq.assigned", { request_id: requestId, request_no: r.request_no, to: "assigned", text: `${r.request_no}: the vehicle ${plate} has been added and handed over` }, m.userId);
}

/** The approved purchases waiting for their vehicle, for the Add a vehicle screen. */
export function purchaseAwaitingVehicle(driver: Driver, m: Membership, requestId: string): Promise<{ id: string; request_no: string; for_name: string; vehicle_class: string | null } | null> {
  return authorizedAny(driver, m, ["vreq.assign"], async (q) => (await q.query<{ id: string; request_no: string; for_name: string; vehicle_class: string | null }>(
    "select r.id, r.request_no, fe.full_name as for_name, r.vehicle_class from vehicle_requests r join employees fe on fe.id = r.for_employee where r.id = $1 and r.status = 'purchase_approved'", [requestId])).rows[0] ?? null);
}

/** The permission each step needs. Cancelling is also open to the person who asked (checked below). */
export const VREQ_TRANSITION_PERMISSION: Record<string, string> = { assigned: "vreq.assign", budget_confirmed: "vreq.confirm_budget", purchase_approved: "vreq.decide", rejected: "vreq.decide", cancelled: "vreq.request" };

/** The one way a vehicle request changes status. */
export async function transitionVehicleRequest(driver: Driver, m: Membership, id: string, to: string, opts: { note?: string; vehicleId?: string; warnReason?: string; amount?: number } = {}): Promise<void> {
  const permission = VREQ_TRANSITION_PERMISSION[to];
  if (!permission) throw new UserError("That step is not available.");
  return authorizedAny(driver, m, ["vreq.decide", "vreq.assign", "vreq.request", "vreq.confirm_budget"], async (q, held) => {
    const r = (await q.query<{ request_no: string; reason: string; requester_user: string | null }>(
      "select r.request_no, r.reason, re.user_id as requester_user from vehicle_requests r join employees re on re.id = r.requested_by where r.id = $1", [id])).rows[0];
    if (!r) throw new UserError("Vehicle request not found.");
    const mine = r.requester_user === m.userId;
    // giving a pool vehicle needs vreq.assign (Logistics, Fleet Manager, Admin); buying one or rejecting needs vreq.decide (A2); cancelling is also open to the asker
    if (!(held.has(permission) || (to === "cancelled" && (held.has("vreq.decide") || held.has("vreq.assign") || (mine && held.has("vreq.request")))))) throw new ForbiddenError(permission);
    // D1: warn, never block. A vehicle with expired papers or an open repair may still be given, with a written reason that is kept in the note.
    let note = opts.note ?? null;
    if (to === "assigned" && opts.vehicleId) {
      const w = (await q.query<{ warnings: string[] }>(`select ${WARNINGS_SQL} as warnings from vehicles v where v.id = $1`, [opts.vehicleId])).rows[0]?.warnings ?? [];
      if (w.length > 0) {
        const why = (opts.warnReason ?? "").trim();
        if (why.length < 5) throw new UserError(`This vehicle has a warning (${w.join("; ")}). Write why you still give it (at least 5 letters).`, { warn_reason: "Write why you still give this vehicle" });
        note = [note, `Warning accepted (${w.join("; ")}): ${why}`].filter(Boolean).join(" | ");
      }
    }
    try {
      await q.query("select vehicle_request_transition($1, $2, $3, $4, $5, $6)", [id, to, m.userId, note, opts.vehicleId || null, opts.amount ?? null]);
    } catch (e) { friendly(e); }
    const payload = { request_id: id, request_no: r.request_no, to, text: `${r.request_no}: ${r.reason}` };
    if (to === "cancelled") await notify(q, await usersWithPermission(q, m.tenantId, "vreq.assign"), "vreq.cancelled", payload, m.userId);
    else if (to === "budget_confirmed") await notify(q, [...(await usersWithPermission(q, m.tenantId, "vreq.decide")), r.requester_user], "vreq.budget_confirmed", { ...payload, text: `${r.request_no}: budget confirmed, waiting for the purchase decision` }, m.userId);
    else await notify(q, [r.requester_user], `vreq.${to}`, payload, m.userId);
  });
}
