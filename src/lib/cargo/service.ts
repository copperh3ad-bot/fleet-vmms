// Cargo pick-up and delivery requests (ADR-079 phase C). A person asks for something to be collected and delivered; the fleet manager or Logistics accepts it, follows it, and may turn it
// into a trip. Every status change goes through cargo_transition (CLAUDE.md rule 4), which writes the history row. Requests come from the app's form or from the WhatsApp menu.
import { z } from "zod";
import type { Driver, Queryable } from "@/lib/db/types";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { fleetAuthorized as authorized, fleetAuthorizedAny as authorizedAny, requireFleetOps } from "@/lib/billing/fleet-ops";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";
import { notify, usersWithPermission } from "@/lib/notify";
import { withPlatform } from "@/lib/db/tenant";
import { normalizePhone } from "@/lib/phone";
import { requestTrip } from "@/lib/trips/service";
import { sendTemplate, whatsappConfigured } from "@/lib/whatsapp";

const e164 = (s: string) => { const n = normalizePhone(s); return n.ok ? n.e164 : s; };
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const when = z.string().min(1, "Enter the date and time").refine((s) => !Number.isNaN(Date.parse(s)), "Enter a valid date and time");
const phone = z.preprocess(blank, z.string().trim().refine((s) => normalizePhone(s).ok, "Enter a mobile number a message can reach, like 0300 1234567").optional());
const optText = (min: number, max: number, msg: string) => z.preprocess(blank, z.string().trim().min(min, msg).max(max).optional());

export const HANDLING: Record<string, string> = { fragile: "Fragile", cold: "Keep cold", hazardous: "Hazardous", loading_help: "Needs loading help" };

export const cargoSchema = z.object({
  description: z.string().trim().min(3, "Say what is being moved").max(300),
  quantity_text: z.string().trim().min(1, "Say how much, for example 12 cartons or 300 kg").max(120),
  pickup_place: z.string().trim().min(2, "Where is it collected?").max(200),
  pickup_at: when,                                     // "Vehicle required: date and time" on the company's Vehicle Request Form
  drop_place: z.string().trim().min(2, "Where is it delivered?").max(200),
  vehicle_type: z.string().trim().min(2, "Which type of vehicle is needed?").max(60),
  poc_details: optText(5, 200, "Give the person to contact and their number"),            // one box, as on the form: names and numbers
  instructions: optText(1, 500, "Say what is needed"),
  // The older shape, kept so requests already made, and anyone who still gives them, work: a contact and number at each end, a time to deliver by, special handling.
  pickup_contact: optText(2, 100, "Who is the contact there?"),
  pickup_phone: phone,
  drop_contact: optText(2, 100, "Who is the contact there?"),
  drop_phone: phone,
  deliver_by: z.preprocess(blank, when.optional()),
  handling: z.preprocess(blank, z.string().trim().max(200).optional()),
  department: z.preprocess(blank, z.string().trim().max(80).optional()),
}).superRefine((v, ctx) => {
  if (v.deliver_by && Date.parse(v.deliver_by) <= Date.parse(v.pickup_at)) ctx.addIssue({ code: "custom", path: ["deliver_by"], message: "Delivery must be after the pick-up" });
  if (!v.poc_details && !(v.pickup_contact && v.pickup_phone)) ctx.addIssue({ code: "custom", path: ["poc_details"], message: "Give the person to contact and their number" });
});

export const CARGO_STATUS_LABEL: Record<string, string> = { requested: "Waiting for a decision", accepted: "Accepted", in_transit: "On the way", delivered: "Delivered", rejected: "Rejected", cancelled: "Cancelled" };

const KNOWN = [/cargo request not found/, /illegal cargo transition [a-z_]+ -> [a-z_]+/, /segregation of duties: [^"]*/, /a reason of at least 5 characters is required/];
function friendly(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  for (const re of KNOWN) { const hit = msg.match(re); if (hit) throw new UserError(hit[0].replace(/^./, (c) => c.toUpperCase()) + (hit[0].endsWith(".") ? "" : ".")); }
  throw e;
}

async function myEmployee(q: Queryable, userId: string): Promise<string> {
  const e = (await q.query<{ id: string }>("select id from employees where user_id = $1 and active", [userId])).rows[0];
  if (!e) throw new UserError("You need an employee record linked to your login to ask for cargo. Ask an administrator.");
  return e.id;
}

export async function createCargoRequest(driver: Driver, m: Membership, raw: unknown, source: "app" | "whatsapp" = "app"): Promise<{ id: string; cargo_no: string }> {
  await requireFleetOps(driver, m);
  const p = cargoSchema.safeParse(raw);
  if (!p.success) throw new UserError("Fix the highlighted fields.", fieldErrors(p.error));
  const c = p.data;
  const made = await authorized(driver, m, "cargo.request", async (q) => {
    const emp = await myEmployee(q, m.userId);
    const row = (await q.query<{ id: string; cargo_no: string }>(
      `insert into cargo_requests(requested_by, description, quantity_text, pickup_place, pickup_contact, pickup_phone, pickup_at, drop_place, drop_contact, drop_phone, deliver_by, handling, department, source,
                                  vehicle_type, poc_details, instructions)
       values ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9,$10,$11::timestamptz,$12,$13,$14,$15,$16,$17) returning id, cargo_no`,
      [emp, c.description, c.quantity_text, c.pickup_place, c.pickup_contact ?? null, c.pickup_phone ? e164(c.pickup_phone) : null, c.pickup_at, c.drop_place, c.drop_contact ?? null,
        c.drop_phone ? e164(c.drop_phone) : null, c.deliver_by ?? null, c.handling ?? null, c.department ?? null, source, c.vehicle_type, c.poc_details ?? null, c.instructions ?? null])).rows[0];
    await q.query("insert into cargo_events(cargo_id, from_status, to_status, actor_id, note) values ($1, null, 'requested', $2, $3)", [row.id, m.userId, source === "whatsapp" ? "Asked on WhatsApp" : null]);
    await notify(q, await usersWithPermission(q, m.tenantId, "cargo.handle"), "cargo.requested", { cargo_id: row.id, cargo_no: row.cargo_no, text: `${row.cargo_no}: ${c.description}, ${c.pickup_place} to ${c.drop_place}` }, m.userId);
    return { ...row, handlers: await usersWithPermission(q, m.tenantId, "cargo.handle"), asker: (await q.query<{ full_name: string }>("select full_name from employees where id = $1", [emp])).rows[0]?.full_name ?? "A colleague" };
  });
  await tellHandlersOnWhatsApp(driver, m, made.id, made.cargo_no, made.asker, made.handlers).catch(() => undefined);   // best effort: the in-app notice is the record
  return { id: made.id, cargo_no: made.cargo_no };
}

/**
 * The fleet manager or Logistics is also told on WhatsApp. They have usually not written in the last 24 hours, so this is an approved utility template (WHATSAPP_CARGO_NOTICE_TEMPLATE),
 * sent only to people who hold cargo.handle and have a mobile number on their employee record. Never an error to the person who asked, and nothing is logged but a code.
 */
async function tellHandlersOnWhatsApp(driver: Driver, m: Membership, cargoId: string, cargoNo: string, asker: string, handlerUsers: string[]): Promise<void> {
  const template = process.env.WHATSAPP_CARGO_NOTICE_TEMPLATE;
  if (!template || !whatsappConfigured() || handlerUsers.length === 0) return;
  const people = await authorizedAny(driver, m, ["cargo.request", "cargo.handle"], async (q) =>
    (await q.query<{ full_name: string; phone: string | null; user_id: string }>("select full_name, phone, user_id from employees where active and user_id = any($1::uuid[]) and phone is not null", [handlerUsers])).rows);
  const slug = await withPlatform(driver, async (q) => (await q.query<{ slug: string }>("select slug from public.tenants where id = $1", [m.tenantId])).rows[0]?.slug);
  if (!slug) return;
  for (const p of people) {
    if (p.user_id === m.userId) continue;
    const n = normalizePhone(p.phone ?? "");
    if (!n.ok) continue;
    try { await sendTemplate(n.e164, { name: template, params: [p.full_name.split(/\s+/)[0] || "there", "cargo", cargoNo, asker], buttonUrlSuffix: `${slug}/cargo/${cargoId}` }); }
    catch (e) { console.error(`cargo whatsapp notice failed: ${e instanceof Error ? e.message.slice(0, 60) : "unknown"}`); }
  }
}

export type CargoRow = {
  id: string; cargo_no: string; status: string; description: string; quantity_text: string; pickup_place: string; drop_place: string; pickup_at: string; deliver_by: string | null;
  requester_name: string; mine: boolean; source: string; trip_id: string | null;
};

const ROW = `select c.id, c.cargo_no, c.status, c.description, c.quantity_text, c.pickup_place, c.drop_place, c.pickup_at::text, c.deliver_by::text, re.full_name as requester_name,
  (re.user_id = $1) as mine, c.source, c.trip_id from cargo_requests c join employees re on re.id = c.requested_by`;

/** Those who handle cargo see every request; anyone else sees only their own. */
export function listCargo(driver: Driver, m: Membership, opts: { status?: string } = {}): Promise<CargoRow[]> {
  return authorizedAny(driver, m, ["cargo.request", "cargo.handle", "cargo.read_all"], async (q, held) => {
    const params: unknown[] = [m.userId];
    const where: string[] = [];
    if (!held.has("cargo.handle") && !held.has("cargo.read_all")) where.push("re.user_id = $1");
    if (opts.status) { params.push(opts.status); where.push(`c.status = $${params.length}`); }
    return (await q.query<CargoRow>(`${ROW} ${where.length ? "where " + where.join(" and ") : ""} order by c.pickup_at desc limit 300`, params)).rows;
  });
}

export type CargoDetail = CargoRow & {
  pickup_contact: string | null; pickup_phone: string | null; drop_contact: string | null; drop_phone: string | null; handling: string | null; department: string | null; decision_note: string | null;
  vehicle_type: string | null; poc_details: string | null; instructions: string | null; created_at: string;
  trip_no: string | null; events: { to_status: string; note: string | null; created_at: string; actor_name: string | null }[];
};

export function getCargo(driver: Driver, m: Membership, id: string): Promise<CargoDetail | null> {
  return authorizedAny(driver, m, ["cargo.request", "cargo.handle", "cargo.read_all"], async (q, held) => {
    const c = (await q.query<Omit<CargoDetail, "events">>(
      `select c.id, c.cargo_no, c.status, c.description, c.quantity_text, c.pickup_place, c.drop_place, c.pickup_at::text, c.deliver_by::text, re.full_name as requester_name, (re.user_id = $2) as mine,
              c.source, c.trip_id, c.pickup_contact, c.pickup_phone, c.drop_contact, c.drop_phone, c.handling, c.department, c.decision_note, c.vehicle_type, c.poc_details, c.instructions, c.created_at::text, t.trip_no
         from cargo_requests c join employees re on re.id = c.requested_by left join trips t on t.id = c.trip_id where c.id = $1`, [id, m.userId])).rows[0];
    if (!c || (!held.has("cargo.handle") && !held.has("cargo.read_all") && !c.mine)) return null;
    const events = (await q.query<CargoDetail["events"][number]>(
      `select e.to_status, e.note, e.created_at::text, emp.full_name as actor_name from cargo_events e left join employees emp on emp.user_id = e.actor_id where e.cargo_id = $1 order by e.created_at, e.id`, [id])).rows;
    return { ...c, events };
  });
}

/** Accept, reject, start, deliver or cancel. Handlers do all but cancel; the person who asked may cancel their own request while it waits. */
export async function transitionCargo(driver: Driver, m: Membership, id: string, to: string, note?: string): Promise<void> {
  if (!["accepted", "rejected", "in_transit", "delivered", "cancelled"].includes(to)) throw new UserError("That step is not available.");
  return authorizedAny(driver, m, ["cargo.request", "cargo.handle"], async (q, held) => {
    const c = (await q.query<{ cargo_no: string; description: string; requester_user: string | null; status: string }>(
      "select c.cargo_no, c.description, c.status, re.user_id as requester_user from cargo_requests c join employees re on re.id = c.requested_by where c.id = $1", [id])).rows[0];
    if (!c) throw new UserError("Cargo request not found.");
    const mine = c.requester_user === m.userId;
    if (!(held.has("cargo.handle") || (to === "cancelled" && mine && c.status === "requested"))) throw new ForbiddenError("cargo.handle");
    try { await q.query("select cargo_transition($1, $2, $3, $4)", [id, to, m.userId, note ?? null]); } catch (e) { friendly(e); }
    await notify(q, [c.requester_user], `cargo.${to}`, { cargo_id: id, cargo_no: c.cargo_no, text: `${c.cargo_no}: ${CARGO_STATUS_LABEL[to].toLowerCase()}` }, m.userId);
  });
}

/** Turns an accepted request into a trip request, prefilled from it, and keeps the link. The trip then follows the usual approval and, in Pro, can be sent to logistics providers for quotes. */
export async function makeTripFromCargo(driver: Driver, m: Membership, id: string): Promise<string> {
  const c = await authorized(driver, m, "cargo.handle", async (q) =>
    (await q.query<{ cargo_no: string; description: string; pickup_place: string; drop_place: string; pickup_at: string; deliver_by: string | null; status: string; trip_id: string | null; quantity_text: string }>(
      "select cargo_no, description, pickup_place, drop_place, pickup_at::text, deliver_by::text, status, trip_id, quantity_text from cargo_requests where id = $1", [id])).rows[0]);
  if (!c) throw new UserError("Cargo request not found.");
  if (c.trip_id) throw new UserError("A trip has already been made from this request.");
  if (!["accepted", "in_transit"].includes(c.status)) throw new UserError("Accept the request first, then make a trip from it.");
  const tripId = await requestTrip(driver, m, { kind: "trip", purpose: `Cargo ${c.cargo_no}: ${c.description} (${c.quantity_text})`.slice(0, 300), from_place: c.pickup_place, to_place: c.drop_place, start_at: c.pickup_at, end_at: c.deliver_by ?? new Date(Date.parse(c.pickup_at) + 12 * 3600_000).toISOString(), passengers: "0" });
  await authorized(driver, m, "cargo.handle", async (q) => {
    await q.query("update cargo_requests set trip_id = $2, updated_at = now() where id = $1 and trip_id is null", [id, tripId]);
    const no = (await q.query<{ trip_no: string }>("select trip_no from trips where id = $1", [tripId])).rows[0]?.trip_no;
    await q.query("insert into cargo_events(cargo_id, from_status, to_status, actor_id, note) select id, status, status, $2, $3 from cargo_requests where id = $1", [id, m.userId, `Trip ${no} made from this request`]);
  });
  return tripId;
}
