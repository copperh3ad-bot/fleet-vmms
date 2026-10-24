// Asking to join a company (ADR-016). A company switches on a code. A member of its staff, or a workshop, who knows the code
// fills in a form; the request waits for an administrator. Approving it creates an ordinary invitation (admin/service.ts), so
// plan limits, roles and "the confirmed email must match" all apply as they do for any invitation. Nothing here gives access.
import { randomBytes } from "node:crypto";
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
import type { TenantRef } from "./index";

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
  phone: z.preprocess(blank, z.string().trim().max(30).optional()),
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

export type JoinRequest = { id: string; kind: JoinKind; full_name: string; email: string; phone: string | null; workshop_name: string | null; note: string | null; created_at: string };

export function listJoinRequests(driver: Driver, m: Membership): Promise<JoinRequest[]> {
  return authorized(driver, m, "admin.users", async (q) =>
    (await q.query<JoinRequest>(
      `select id, kind, full_name, email, phone, workshop_name, note, created_at::text from public.join_requests
        where tenant_id = $1 and status = 'pending' order by created_at`, [m.tenantId])).rows);
}

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

/** Called by the public form. Records the request with the company and in the control index. Asking twice just updates it. */
export async function submitJoinRequest(driver: Driver, kind: JoinKind, input: JoinInput): Promise<{ company: string }> {
  const t = await findTenantByJoinCode(driver, input.code);
  if (!t) throw new UserError("That company code is not recognised. Check it with your administrator.", { code: "Not recognised" });
  const { id, created } = await withOrgPlatform(driver, t.schema, async (q) => {
    const waiting = (await q.query<{ c: number }>("select count(*)::int c from public.join_requests where tenant_id = $1 and status = 'pending'", [t.id])).rows[0].c;
    const again = (await q.query("select 1 from public.join_requests where tenant_id = $1 and lower(email) = $2 and status = 'pending'", [t.id, input.email])).rows.length > 0;
    if (waiting >= MAX_WAITING && !again) throw new UserError("This company has too many requests waiting. Ask its administrator to clear them.");
    // xmax is 0 for a row that was just inserted, and not for one that was updated: only a new request needs a notice.
    const r = (await q.query<{ id: string; created: boolean }>(
      `insert into public.join_requests(tenant_id, kind, full_name, email, phone, workshop_name, note) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (tenant_id, (lower(email))) where status = 'pending'
       do update set kind = excluded.kind, full_name = excluded.full_name, phone = excluded.phone, workshop_name = excluded.workshop_name, note = excluded.note
       returning id, (xmax = 0) as created`, [t.id, kind, input.full_name, input.email, input.phone ?? null, input.workshop_name ?? null, input.note ?? null])).rows[0];
    return r;
  });
  if (created) await tellAdministrators(driver, t, id, kind === "workshop" ? `${input.workshop_name} asked to join as a workshop.` : `${input.full_name} asked to join.`);
  await withPlatform(driver, (q) => q.query(
    "insert into public.join_index(tenant_id, request_id, email) values ($1, $2, lower($3)) on conflict (tenant_id, request_id) do nothing", [t.id, id, input.email]));
  return { company: t.name };
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
    (await q.query<JoinRequest & { vendor_id: string | null }>(
      `select id, kind, full_name, email, phone, workshop_name, note, vendor_id, created_at::text from public.join_requests where id = $1 and tenant_id = $2 and status = 'pending'`, [id, m.tenantId])).rows[0]);
  if (!req) throw new UserError("That request is no longer waiting.");

  let invite: { id: string };
  if (req.kind === "workshop") {
    let vendorId = req.vendor_id;
    if (!vendorId) {
      vendorId = (await saveVendor(driver, m, { name: req.workshop_name, contact: req.full_name, phone: req.phone ?? undefined, email: req.email })).id;
      await authorized(driver, m, "admin.users", (q) => q.query("update public.join_requests set vendor_id = $2 where id = $1 and tenant_id = $3", [id, vendorId, m.tenantId]));
    }
    invite = await inviteUser(driver, m, { full_name: req.full_name, email: req.email, phone: req.phone ?? "", role: "vendor", vehicle_scope: "all", vendor_id: vendorId });
  } else {
    const role = choice.role || "requester";
    if (role === "vendor") throw new UserError("Choose a staff role. Workshops join through the workshop form.", { role: "Choose a staff role" });
    // Every invitation is for one employee code (ADR-025), so whoever approves says which employee this person is.
    invite = await inviteUser(driver, m, { full_name: req.full_name, email: req.email, phone: req.phone ?? "", role, vehicle_scope: choice.vehicle_scope === "all" ? "all" : "own", employee_no: choice.employee_no ?? "" });
  }
  await authorized(driver, m, "admin.users", (q) => q.query(
    "update public.join_requests set status = 'approved', decided_by = $2, decided_at = now(), invitation_id = $3 where id = $1 and tenant_id = $4", [id, m.userId, invite.id, m.tenantId]));
  await forget(driver, m.tenantId, id);
}

export async function declineJoinRequest(driver: Driver, m: Membership, id: string, reason?: string): Promise<void> {
  const done = await authorized(driver, m, "admin.users", (q) => q.query(
    "update public.join_requests set status = 'declined', decided_by = $2, decided_at = now(), decline_reason = $3 where id = $1 and tenant_id = $4 and status = 'pending' returning id",
    [id, m.userId, (reason ?? "").trim().slice(0, 300) || null, m.tenantId]));
  if (done.rows.length === 0) throw new UserError("That request is no longer waiting.");
  await forget(driver, m.tenantId, id);
}
