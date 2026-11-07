// Asking to join a company (ADR-016). A company switches on a code. A member of its staff, or a workshop, who knows the code
// fills in a form; the request waits for an administrator. Approving it creates an ordinary invitation (admin/service.ts), so
// plan limits, roles and "the confirmed email must match" all apply as they do for any invitation. Nothing here gives access.
// Since ADR-055 a request is not seen by the administrator until the person has confirmed it from their own phone: a 6-digit code is sent to the WhatsApp number they typed, from the
// Fleet OTG number, and they type it on the page they are on. It also carries their driving licence (not expired; a learner's permit only if the company accepts them), which is checked again at approval and then kept as the
// employee's licence. The licence number is held in the request only until the administrator decides.
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Driver } from "@/lib/db/types";
import { withOrgPlatform, withPlatform, withTenant } from "@/lib/db/tenant";
import { authorized, type Membership } from "@/lib/auth/can";
import { loadAccess } from "@/lib/billing/state";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";
import { notify, usersWithPermission } from "@/lib/notify";
import { SYSTEM_USER } from "@/lib/compliance/reminders";
import { saveVendor } from "@/lib/master/service";
import { inviteUser } from "@/lib/admin/service";
import { findTenantByToken, routeToken, unrouteToken, type TenantRef } from "./index";
import { normalizePhone } from "@/lib/phone";
import { hashToken, newToken } from "@/lib/odometer/link";
import { learnerAllowed, licenceProblem } from "@/lib/compliance/licences";
import { sendWhatsApp, whatsappCodeConfigured } from "@/lib/whatsapp";

export type JoinKind = "staff" | "workshop";

// ---------- the code ----------
// 32 letters and digits with no 0/O or 1/I, ten of them: about 50 bits, so a code cannot be guessed, and one read aloud is not mixed up.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const newJoinCode = (): string => Array.from(randomBytes(10), (b) => ALPHABET[b % 32]).join("");
/** What a person typed, to the stored form: "abcde-fghjk" becomes "ABCDEFGHJK". */
export const normalizeCode = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const formatCode = (c: string): string => `${c.slice(0, 5)}-${c.slice(5)}`;
const CODE = /^[A-HJ-NP-Z2-9]{10}$/;

// ---------- the form ----------
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const joinSchema = z.object({
  code: z.string().transform(normalizeCode).refine((c) => CODE.test(c), "Enter the company code, 10 letters and digits"),
  full_name: z.string().trim().min(2, "Enter your full name").max(120),
  email: z.email("Enter a valid email").max(200).transform((s) => s.toLowerCase()),
  /** the WhatsApp number the confirmation is sent to (ADR-055) */
  phone: z.string().trim().min(1, "Enter your WhatsApp number").max(30, "That number is too long"),
  licence_type: z.preprocess(blank, z.enum(["full", "learner"], "Choose the type of licence").default("full")),
  licence_no: z.string().trim().min(3, "Enter your driving licence number").max(40, "That number is too long"),
  licence_expires_on: z.iso.date("Enter the licence expiry date"),
  workshop_name: z.preprocess(blank, z.string().trim().min(2, "Enter the workshop name").max(120).optional()),
  note: z.preprocess(blank, z.string().trim().max(500, "Keep it under 500 characters").optional()),
  terms: z.literal(true, "Accept the terms to continue"),
});
export type JoinInput = z.output<typeof joinSchema>;

export function parseJoin(raw: Record<string, unknown>, kind: JoinKind): JoinInput {
  const r = joinSchema.safeParse({ ...raw, terms: raw.terms === "on" || raw.terms === true });
  const fields = r.success ? {} : fieldErrors(r.error);
  if (kind === "workshop" && !(r.success ? r.data.workshop_name : String(raw.workshop_name ?? "").trim())) fields.workshop_name ??= "Enter the workshop name";
  if (Object.keys(fields).length) throw new UserError("Fix the highlighted fields.", fields);
  const d = (r as { data: JoinInput }).data;
  return kind === "staff" ? { ...d, workshop_name: undefined } : d;
}

// ---------- the company's side: code and requests ----------
export async function getJoinCode(driver: Driver, m: Membership): Promise<string | null> {
  await authorized(driver, m, "admin.users", async () => undefined);
  return withPlatform(driver, async (q) => (await q.query<{ join_code: string | null }>("select join_code from public.tenants where id = $1", [m.tenantId])).rows[0]?.join_code ?? null);
}

/** "on" makes a code if there is none, "regenerate" replaces it (the old one stops working at once), "off" removes it. */
export async function setJoinCode(driver: Driver, m: Membership, action: "on" | "regenerate" | "off"): Promise<string | null> {
  await authorized(driver, m, "admin.users", async () => undefined);
  return withPlatform(driver, async (q) => {
    if (action === "off") { await q.query("update public.tenants set join_code = null where id = $1", [m.tenantId]); return null; }
    if (action === "on") {
      const have = (await q.query<{ join_code: string | null }>("select join_code from public.tenants where id = $1", [m.tenantId])).rows[0]?.join_code;
      if (have) return have;
    }
    for (let i = 0; i < 5; i++) {
      const code = newJoinCode();
      const done = await q.query("update public.tenants set join_code = $2 where id = $1 and not exists (select 1 from public.tenants where join_code = $2) returning id", [m.tenantId, code]);
      if (done.rows.length) return code;
    }
    throw new UserError("A code could not be made. Try again.");
  });
}

export type JoinRequest = {
  id: string; kind: JoinKind; full_name: string; email: string; phone: string | null; workshop_name: string | null; note: string | null; created_at: string;
  /** the licence they gave, with the number cut to its last four characters; null on a request made before licences were asked for */
  licence: { type: "full" | "learner"; ends: string; expires_on: string } | null;
  /** they opened the confirmation sent to their own phone */
  phone_confirmed: boolean;
};

export function listJoinRequests(driver: Driver, m: Membership): Promise<JoinRequest[]> {
  return authorized(driver, m, "admin.users", async (q) =>
    (await q.query<JoinRequest & { l_type: "full" | "learner" | null; l_end: string | null; l_exp: string | null }>(
      `select id, kind, full_name, email, phone, workshop_name, note, created_at::text, (phone_confirmed_at is not null) as phone_confirmed,
              licence_type as l_type, right(licence_no, 4) as l_end, licence_expires_on::text as l_exp
         from public.join_requests where tenant_id = $1 and status = 'pending' order by created_at`, [m.tenantId])).rows
      .map(({ l_type, l_end, l_exp, ...r }) => ({ ...r, licence: l_type && l_end && l_exp ? { type: l_type, ends: l_end, expires_on: l_exp } : null })));
}

/** How long a request may wait for its code to be typed before it is dropped. */
export const CONFIRM_DAYS = 3;
/** The code works for 10 minutes, five wrong tries end it, a new one may be asked for once a minute, and at most five are sent for one request: the same limits as an invitation's code. */
/** The name of the cookie that holds a browser's reference to its own waiting request. */
export const JOIN_REF_COOKIE = "join_ref";
export const OTP_MINUTES = 10;
export const OTP_MAX_TRIES = 5;
export const OTP_MAX_SENDS = 5;
export const OTP_RESEND_SECONDS = 60;
const REF_RE = /^[A-Za-z0-9_-]{43}$/;
const hashCode = (requestId: string, code: string) => createHash("sha256").update(`join:${requestId}:${code}`).digest("hex");

/** Sends the code in the approved authentication template (the one the invitation code uses). Replaceable so tests need no network. */
export type JoinCodeSender = (e164: string, m: { code: string; company: string }) => Promise<void>;
export const sendJoinCode: JoinCodeSender = (e164, m) => sendWhatsApp(e164, {
  body: `Fleet OTG code ${m.code} to join ${m.company}. It works for ${OTP_MINUTES} minutes. Enter it only if you asked to join.`,
  template: process.env.WHATSAPP_OTP_TEMPLATE || undefined, code: m.code,
});

export const MAX_WAITING = 50;

/** The company a code belongs to, if it is open for new people: active, set up, and not locked for non-payment. */
export async function findTenantByJoinCode(driver: Driver, code: string): Promise<TenantRef | null> {
  if (!CODE.test(code)) return null;
  const t = await withPlatform(driver, async (q) => {
    const r = (await q.query<{ id: string; schema_name: string; slug: string; name: string }>(
      "select id, schema_name, slug, name from public.tenants where join_code = $1 and status = 'active' and provision_state = 'ready'", [code])).rows[0];
    return r ? { id: r.id, schema: r.schema_name, slug: r.slug, name: r.name } : null;
  });
  return t && (await loadAccess(driver, t.id)).full ? t : null;
}

/**
 * Called by the public form. Checks the licence and the phone, saves the request as "unconfirmed" (the administrator cannot see it yet), sends a 6-digit code to the WhatsApp number from the
 * Fleet OTG number, and returns a reference the person's browser keeps so that the code they type finds this request. Without WhatsApp set up nobody can join with a code, on purpose: an
 * unconfirmed request is exactly what this closes. Asking again replaces the request.
 */
export async function submitJoinRequest(driver: Driver, kind: JoinKind, input: JoinInput, send: JoinCodeSender = sendJoinCode): Promise<{ company: string; phoneEnds: string; ref: string }> {
  const t = await findTenantByJoinCode(driver, input.code);
  if (!t) throw new UserError("That company code is not recognised. Check it with your administrator.", { code: "Not recognised" });
  const phone = normalizePhone(input.phone);
  if (!phone.ok) throw new UserError(phone.message, { phone: phone.message });
  if (!whatsappCodeConfigured()) throw new UserError("Joining with a company code needs a confirmation on WhatsApp, which is not set up yet. Ask your administrator.");
  const allowLearner = await withTenant(driver, { schema: t.schema, userId: SYSTEM_USER, role: "system" }, (q) => learnerAllowed(q));
  const bad = licenceProblem({ type: input.licence_type, expires_on: input.licence_expires_on }, allowLearner);
  if (bad) throw new UserError(bad.message, { [bad.field]: bad.message });

  const ref = newToken(), refHash = hashToken(ref);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expires = new Date(Date.now() + CONFIRM_DAYS * 864e5).toISOString();
  const id = await withOrgPlatform(driver, t.schema, async (q) => {
    const waiting = (await q.query<{ c: number }>("select count(*)::int c from public.join_requests where tenant_id = $1 and status in ('unconfirmed', 'pending')", [t.id])).rows[0].c;
    const again = (await q.query("select 1 from public.join_requests where tenant_id = $1 and lower(email) = $2 and status in ('unconfirmed', 'pending')", [t.id, input.email])).rows.length > 0;
    if (waiting >= MAX_WAITING && !again) throw new UserError("This company has too many requests waiting. Ask its administrator to clear them.");
    const rid = (await q.query<{ id: string }>(
      `insert into public.join_requests(tenant_id, kind, full_name, email, phone, workshop_name, note, status, confirm_token_hash, confirm_expires_at, licence_type, licence_no, licence_expires_on)
       values ($1, $2, $3, $4, $5, $6, $7, 'unconfirmed', $8, $9, $10, $11, $12)
       on conflict (tenant_id, (lower(email))) where status in ('unconfirmed', 'pending')
       do update set kind = excluded.kind, full_name = excluded.full_name, phone = excluded.phone, workshop_name = excluded.workshop_name, note = excluded.note, status = 'unconfirmed',
                     phone_confirmed_at = null, confirm_token_hash = excluded.confirm_token_hash, confirm_expires_at = excluded.confirm_expires_at,
                     licence_type = excluded.licence_type, licence_no = excluded.licence_no, licence_expires_on = excluded.licence_expires_on
       returning id`,
      [t.id, kind, input.full_name, input.email, phone.e164, input.workshop_name ?? null, input.note ?? null, refHash, expires, input.licence_type, input.licence_no, input.licence_expires_on])).rows[0].id;
    await q.query("update public.join_requests set otp_hash = $2, otp_expires_at = now() + ($3 || ' minutes')::interval, otp_attempts = 0, otp_sends = 1, otp_sent_at = now() where id = $1", [rid, hashCode(rid, code), String(OTP_MINUTES)]);
    return rid;
  });
  const undo = async () => {
    await withOrgPlatform(driver, t.schema, (q) => q.query("delete from public.join_requests where id = $1 and status = 'unconfirmed'", [id])).catch(() => undefined);
    await unrouteToken(driver, refHash).catch(() => undefined);
  };
  try {
    await routeToken(driver, "joinconfirm", t.id, refHash, expires);          // the code the person types finds its organization through this
    await send(phone.e164, { code, company: t.name });
  } catch (e) {
    await undo();          // nothing is left waiting that could never be confirmed, and no licence number is kept
    console.error(`join code not sent: ${e instanceof Error ? e.message.slice(0, 140) : "unknown"}`);          // never the number or the code
    throw new UserError("We could not send the code to your WhatsApp number. Check the number is on WhatsApp and try again.", { phone: "Check this number" });
  }
  return { company: t.name, phoneEnds: phone.digits.slice(-4), ref };
}

type Waiting = { schema: string; tenant: TenantRef; row: { id: string; full_name: string; email: string; kind: JoinKind; workshop_name: string | null; phone: string; otp_hash: string | null; otp_expires_at: string | null; otp_attempts: number; otp_sends: number; seconds_since_send: number | null } };

/** The unconfirmed request this browser reference belongs to, if it is still waiting for its code. */
async function loadWaiting(driver: Driver, ref: string): Promise<Waiting | null> {
  if (!REF_RE.test(ref)) return null;
  const hash = hashToken(ref);
  const tenant = await findTenantByToken(driver, "joinconfirm", hash);
  if (!tenant) return null;
  const row = (await withOrgPlatform(driver, tenant.schema, (q) => q.query<Waiting["row"]>(
    `select id, full_name, email, kind, workshop_name, phone, otp_hash, otp_expires_at::text, otp_attempts, otp_sends, extract(epoch from now() - otp_sent_at)::int as seconds_since_send
       from public.join_requests where confirm_token_hash = $1 and tenant_id = $2 and status = 'unconfirmed' and confirm_expires_at > now()`, [hash, tenant.id]))).rows[0];
  return row ? { schema: tenant.schema, tenant, row } : null;
}

const NOT_WAITING = "This request is not waiting for a code any more. Ask to join again from the join page.";

/** What the page shows while a code is awaited: the company and the end of the number it went to. Null when there is nothing to confirm. Changes nothing. */
export async function joinCodeState(driver: Driver, ref: string): Promise<{ company: string; phoneEnds: string } | null> {
  const w = await loadWaiting(driver, ref);
  return w ? { company: w.tenant.name, phoneEnds: w.row.phone.replace(/\D/g, "").slice(-4) } : null;
}

/** The person typed the code they were sent: the request becomes visible to the administrator, who is told. A wrong code counts against five tries; the right one works once. */
export async function confirmJoinWithCode(driver: Driver, ref: string, typed: string): Promise<{ company: string }> {
  const w = await loadWaiting(driver, ref);
  if (!w) throw new UserError(NOT_WAITING);
  const code = typed.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) throw new UserError("Enter the 6-digit code we sent you.", { code: "Six digits" });
  const { row } = w;
  if (!row.otp_hash || !row.otp_expires_at) throw new UserError("Ask for a code first: press Send me a new code.");
  if (new Date(row.otp_expires_at).getTime() < Date.now()) throw new UserError("That code has run out. Press Send me a new code.");
  if (row.otp_attempts >= OTP_MAX_TRIES) throw new UserError("Too many wrong codes. Press Send me a new code.");
  const a = Buffer.from(hashCode(row.id, code)), b = Buffer.from(row.otp_hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await withOrgPlatform(driver, w.schema, (q) => q.query("update public.join_requests set otp_attempts = otp_attempts + 1 where id = $1", [row.id]));
    throw new UserError("That code is not right. Check the message and try again.", { code: "Not right" });
  }
  const done = await withOrgPlatform(driver, w.schema, (q) => q.query(
    "update public.join_requests set status = 'pending', phone_confirmed_at = now(), confirm_token_hash = null, otp_hash = null where id = $1 and status = 'unconfirmed' returning id", [row.id]));
  if (done.rows.length === 0) throw new UserError(NOT_WAITING);
  await unrouteToken(driver, hashToken(ref)).catch(() => undefined);
  await tellAdministrators(driver, w.tenant, row.id, row.kind === "workshop" ? `${row.workshop_name} asked to join as a workshop.` : `${row.full_name} asked to join.`);
  await withPlatform(driver, (q) => q.query(
    "insert into public.join_index(tenant_id, request_id, email) values ($1, $2, lower($3)) on conflict (tenant_id, request_id) do nothing", [w.tenant.id, row.id, row.email]));
  return { company: w.tenant.name };
}

/** A new code, once a minute, at most five for one request. The old one stops working. */
export async function resendJoinCode(driver: Driver, ref: string, send: JoinCodeSender = sendJoinCode): Promise<{ phoneEnds: string }> {
  const w = await loadWaiting(driver, ref);
  if (!w) throw new UserError(NOT_WAITING);
  const { row } = w;
  if (row.otp_sends >= OTP_MAX_SENDS) throw new UserError("Too many codes were sent for this request. Ask to join again.");
  if (row.seconds_since_send !== null && row.seconds_since_send < OTP_RESEND_SECONDS) throw new UserError(`A code was sent a moment ago. Wait ${OTP_RESEND_SECONDS - row.seconds_since_send} seconds before asking for another.`);
  if (!whatsappCodeConfigured()) throw new UserError("Sending on WhatsApp is not set up yet. Ask your administrator.");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // store first, then send: a code that was sent must always be one we can check
  await withOrgPlatform(driver, w.schema, (q) => q.query(
    "update public.join_requests set otp_hash = $2, otp_expires_at = now() + ($3 || ' minutes')::interval, otp_attempts = 0, otp_sends = otp_sends + 1, otp_sent_at = now() where id = $1", [row.id, hashCode(row.id, code), String(OTP_MINUTES)]));
  try { await send(row.phone, { code, company: w.tenant.name }); }
  catch (e) {
    console.error(`join code not sent: ${e instanceof Error ? e.message.slice(0, 140) : "unknown"}`);
    throw new UserError("We could not send the code. Try again in a minute.");
  }
  return { phoneEnds: row.phone.replace(/\D/g, "").slice(-4) };
}

/** Run daily: a request nobody confirmed is removed with its licence number once its link has been dead for a day. */
export async function purgeUnconfirmedJoinRequests(driver: Driver): Promise<number> {
  const tenants = await withPlatform(driver, async (q) => (await q.query<{ schema_name: string }>("select schema_name from public.tenants where status = 'active'")).rows);
  let n = 0;
  for (const t of tenants) {
    n += await withOrgPlatform(driver, t.schema_name, async (q) =>
      (await q.query("delete from public.join_requests where status = 'unconfirmed' and confirm_expires_at < now() - interval '1 day' returning id")).rows.length).catch(() => 0);
  }
  return n;
}

/**
 * Everyone in the company who can manage users gets an in-app notice, and the Users link in the sidebar shows a count. A failure
 * here never loses the request: it is already saved, and the sidebar count comes from the request itself.
 */
async function tellAdministrators(driver: Driver, t: TenantRef, requestId: string, text: string): Promise<void> {
  try {
    await withTenant(driver, { schema: t.schema, userId: SYSTEM_USER, role: "system" }, async (q) => {
      await notify(q, await usersWithPermission(q, t.id, "admin.users"), "join.requested", { text, request_id: requestId }, SYSTEM_USER);
    });
  } catch (e) { console.error("join notice not written:", e instanceof Error ? e.message : e); }
}

/** Companies this address has asked to join and not yet heard back from. */
export function waitingRequestsFor(driver: Driver, email: string): Promise<{ company: string }[]> {
  return withPlatform(driver, async (q) =>
    (await q.query<{ company: string }>(
      `select t.name as company from public.join_index j join public.tenants t on t.id = j.tenant_id
        where lower(j.email) = lower($1) and j.tenant_id = t.id and t.status = 'active' order by j.created_at`, [email])).rows);
}

const forget = (driver: Driver, tenantId: string, requestId: string) =>
  withPlatform(driver, (q) => q.query("delete from public.join_index where tenant_id = $1 and request_id = $2", [tenantId, requestId])).catch(() => undefined);

/**
 * Approving makes an invitation (the person then accepts it after signing in, as with any invitation). A workshop also gets a
 * workshop record, remembered on the request so a retry does not make a second one.
 */
export async function approveJoinRequest(driver: Driver, m: Membership, id: string, choice: { role?: string; vehicle_scope?: string; employee_no?: string } = {}): Promise<void> {
  const req = await authorized(driver, m, "admin.users", async (q) =>
    (await q.query<{ id: string; kind: JoinKind; full_name: string; email: string; phone: string | null; workshop_name: string | null; note: string | null; vendor_id: string | null; licence_type: "full" | "learner" | null; licence_no: string | null; licence_expires_on: string | null }>(
      `select id, kind, full_name, email, phone, workshop_name, note, vendor_id, created_at::text, licence_type, licence_no, licence_expires_on::text as licence_expires_on
         from public.join_requests where id = $1 and tenant_id = $2 and status = 'pending'`, [id, m.tenantId])).rows[0]);
  if (!req) throw new UserError("That request is no longer waiting.");
  // A person joining as staff needs a valid driving licence (ADR-055), checked again now: it may have expired since, or the company may no longer accept learner permits.
  if (req.kind === "staff") {
    if (!req.licence_no || !req.licence_type || !req.licence_expires_on) throw new UserError("This request has no driving licence. Decline it and ask the person to ask to join again.");
    const allow = await authorized(driver, m, "admin.users", (q) => learnerAllowed(q));
    const bad = licenceProblem({ type: req.licence_type, expires_on: req.licence_expires_on }, allow);
    if (bad) throw new UserError(`${bad.message}. Decline the request, or ask the person to join again with a licence that is accepted.`);
  }

  let invite: { id: string };
  const licence = req.licence_no && req.licence_type && req.licence_expires_on ? { no: req.licence_no, type: req.licence_type, expires_on: req.licence_expires_on } : null;
  if (req.kind === "workshop") {
    let vendorId = req.vendor_id;
    if (!vendorId) {
      vendorId = (await saveVendor(driver, m, { name: req.workshop_name, contact: req.full_name, phone: req.phone ?? undefined, email: req.email })).id;
      await authorized(driver, m, "admin.users", (q) => q.query("update public.join_requests set vendor_id = $2 where id = $1 and tenant_id = $3", [id, vendorId, m.tenantId]));
    }
    invite = await inviteUser(driver, m, { full_name: req.full_name, email: req.email, phone: req.phone ?? "", role: "vendor", vehicle_scope: "all", vendor_id: vendorId }, { phoneOptional: true });
  } else {
    const role = choice.role || "requester";
    if (role === "vendor") throw new UserError("Choose a staff role. Workshops join through the workshop form.", { role: "Choose a staff role" });
    // The employee record is made now if it does not exist yet (it would otherwise appear only when the invitation is accepted), so the licence can be saved with it.
    if (licence && choice.employee_no) {
      await authorized(driver, m, "admin.users", (q) => q.query(
        "insert into employees(full_name, employee_no, phone) select $1, $2, $3 where not exists (select 1 from employees where lower(employee_no) = lower($2))", [req.full_name, choice.employee_no, req.phone]));
    }
    // Every invitation is for one employee code (ADR-025), so whoever approves says which employee this person is.
    invite = await inviteUser(driver, m, { full_name: req.full_name, email: req.email, phone: req.phone ?? "", role, vehicle_scope: choice.vehicle_scope === "all" ? "all" : "own", employee_no: choice.employee_no ?? "" }, { phoneOptional: true });
  }
  // the licence becomes the employee's (ADR-044), and the number is dropped from the request
  if (licence && choice.employee_no) {
    await authorized(driver, m, "admin.users", (q) => q.query(
      `insert into driver_licences(employee_id, licence_no, expires_on, licence_type)
       select e.id, $2, $3, $4 from employees e where lower(e.employee_no) = lower($1)
       on conflict (employee_id) do update set licence_no = excluded.licence_no, expires_on = excluded.expires_on, licence_type = excluded.licence_type, updated_at = now()`,
      [choice.employee_no, licence.no, licence.expires_on, licence.type]));
  }
  await authorized(driver, m, "admin.users", (q) => q.query(
    "update public.join_requests set status = 'approved', decided_by = $2, decided_at = now(), invitation_id = $3, licence_no = null where id = $1 and tenant_id = $4", [id, m.userId, invite.id, m.tenantId]));
  await forget(driver, m.tenantId, id);
}

export async function declineJoinRequest(driver: Driver, m: Membership, id: string, reason?: string): Promise<void> {
  const done = await authorized(driver, m, "admin.users", (q) => q.query(
    "update public.join_requests set status = 'declined', decided_by = $2, decided_at = now(), decline_reason = $3, licence_no = null where id = $1 and tenant_id = $4 and status = 'pending' returning id",
    [id, m.userId, (reason ?? "").trim().slice(0, 300) || null, m.tenantId]));
  if (done.rows.length === 0) throw new UserError("That request is no longer waiting.");
  await forget(driver, m.tenantId, id);
}
