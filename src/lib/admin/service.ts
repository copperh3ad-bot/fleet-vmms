// People and access: members, invitations (invite-only onboarding), plan usage. Managing people needs admin.users
// (CLAUDE.md rule 3). Accepting an invitation is done by the invited person, so it checks the invitation itself instead:
// a live invitation, addressed to the confirmed email of the signed-in user.
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Driver } from "@/lib/db/types";
import { assertCan, authorized, authorizedAny, type Membership } from "@/lib/auth/can";
import { withOrgPlatform, withTenant } from "@/lib/db/tenant";
import { findTenantByInvitation, findTenantByToken, forgetMember, indexInvitation, rememberMember, routeToken, tenantsInvitingEmail, unindexInvitation, unrouteToken } from "@/lib/orgs";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";
import { checkRecoveryCode, checkUsername, deleteLoginName, hashRecoveryCode, loginNameByUserId, loginNameByUsername, loginNamesFor, newLoginEmail, recordLoginName, setRecoveryHash, usernameTaken, verifyRecoveryCode } from "@/lib/auth/login-names";
import { allowShared } from "@/lib/rate-limit";
import { trialCapFor } from "@/lib/billing/trial";
import { normalizePhone } from "@/lib/phone";
import { smsConfigured } from "@/lib/sms";
import { authAdminConfigured, createLoginUser, deleteLoginUser, putInboundFile, setLoginPassword } from "@/lib/supabase/admin";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
export const INVITE_DAYS = 7;
export const newInviteToken = () => randomBytes(32).toString("base64url");
export const hashInviteToken = (t: string) => createHash("sha256").update(t).digest("hex");
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Plan limit messages raised by the database triggers. */
function friendly(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  const hit = msg.match(/plan limit: (users|vehicles) \((\d+)\)/);
  if (hit) throw new UserError(`Your plan allows ${hit[2]} ${hit[1]}. Remove or disable some, or ask for a bigger plan.`);
  throw e;
}

// ============================ Usage ============================

export type Usage = { vehicles: { used: number; limit: number | null }; users: { used: number; limit: number | null } };

export async function planUsage(driver: Driver, m: Membership): Promise<Usage> {
  const trialCap = await trialCapFor(driver, m);                    // while a free trial runs, its vehicle limit is the one that applies (ADR-038)
  return authorizedAny(driver, m, ["admin.users", "vehicle.read"], async (q) => {
    const lim = async (key: string) => (await q.query<{ l: number | null }>("select plan_limit($1) as l", [key])).rows[0].l;
    const vehicles = (await q.query<{ c: number }>("select count(*)::int c from vehicles where status <> 'disposed'")).rows[0].c;
    const users = (await q.query<{ c: number }>(
      "select count(*)::int c from public.tenant_memberships where tenant_id = $1 and status = 'active' and role <> 'vendor'", [m.tenantId])).rows[0].c;
    const ul = (await q.query<{ l: number | null }>(
      `select (p.limits->>'max_users')::int as l from public.tenant_subscriptions s join public.plans p on p.id = s.plan_id
        where s.tenant_id = $1 and s.status in ('trial','active')`, [m.tenantId])).rows[0]?.l ?? null;
    const planLimit = await lim("max_vehicles");
    const limit = trialCap === null ? planLimit : planLimit === null ? trialCap : Math.min(planLimit, trialCap);
    return { vehicles: { used: vehicles, limit }, users: { used: users, limit: ul } };
  });
}

// ============================ What each role can do ============================

export type RoleMatrix = { roles: (RoleOption & { people: number })[]; grants: Record<string, string[]> };

/** Every role with its permissions and how many people hold it, for the read-only table on the Users screen. */
export function getRoleMatrix(driver: Driver, m: Membership): Promise<RoleMatrix> {
  return authorized(driver, m, "admin.users", async (q) => {
    const roles = (await q.query<RoleOption & { people: number }>(
      `select r.key, r.name, (select count(*)::int from public.tenant_memberships mm where mm.tenant_id = $1 and mm.role = r.key and mm.status = 'active') as people
         from roles r order by case r.key when 'tenant_admin' then 0 when 'fleet_manager' then 1 when 'finance' then 2 when 'requester' then 3 when 'auditor' then 4 else 5 end, r.name`, [m.tenantId])).rows;
    const grants: Record<string, string[]> = {};
    for (const g of (await q.query<{ role_key: string; permission_key: string }>("select role_key, permission_key from role_permissions")).rows) (grants[g.role_key] ??= []).push(g.permission_key);
    return { roles, grants };
  });
}

// ============================ Members ============================

export type Member = {
  user_id: string; role: string; role_name: string; status: "active" | "disabled"; vehicle_scope: "all" | "own"; since: string;
  full_name: string | null; email: string | null; vendor_name: string | null; is_me: boolean;
  employee_no: string | null; username: string | null;
};

export async function listMembers(driver: Driver, m: Membership): Promise<Member[]> {
  const rows = await authorized(driver, m, "admin.users", async (q) =>
    (await q.query<Omit<Member, "username">>(
      `select mm.user_id, mm.role, coalesce(r.name, mm.role) as role_name, mm.status, mm.vehicle_scope, mm.created_at::date::text as since,
              e.full_name, e.email, e.employee_no, vn.name as vendor_name, (mm.user_id = $2) as is_me
         from public.tenant_memberships mm
         left join roles r on r.key = mm.role
         left join employees e on e.user_id = mm.user_id
         left join vendors vn on vn.user_id = mm.user_id
        where mm.tenant_id = $1 order by (mm.status = 'active') desc, mm.role, coalesce(e.full_name, vn.name), mm.user_id`, [m.tenantId, m.userId])).rows);
  // The sign-in names live in the control plane, which is asked once for everyone on this list.
  const names = await loginNamesFor(driver, rows.map((r) => r.user_id));
  return rows.map((r) => ({ ...r, username: names.get(r.user_id) ?? null }));
}

export type RoleOption = { key: string; name: string };

export function listRoles(driver: Driver, m: Membership): Promise<RoleOption[]> {
  return authorized(driver, m, "admin.users", async (q) =>
    (await q.query<RoleOption>("select key, name from roles order by case key when 'tenant_admin' then 0 when 'fleet_manager' then 1 when 'finance' then 2 when 'requester' then 3 when 'auditor' then 4 else 5 end")).rows);
}

/** Change a member's role, vehicle scope or status. Never your own, and never the last administrator. */
export function changeMember(driver: Driver, m: Membership, userId: string, change: { role?: string; vehicle_scope?: string; status?: string }): Promise<void> {
  const r = z.object({
    role: z.preprocess(blank, z.string().max(40).optional()),
    vehicle_scope: z.preprocess(blank, z.enum(["all", "own"]).optional()),
    status: z.preprocess(blank, z.enum(["active", "disabled"]).optional()),
  }).safeParse(change);
  if (!r.success) return Promise.reject(new UserError("Fix the highlighted fields.", fieldErrors(r.error)));
  const c = r.data;
  return authorized(driver, m, "admin.users", async (q) => {
    if (userId === m.userId) throw new UserError("You cannot change your own access. Ask another administrator.");
    await q.query("select 1 from public.tenants where id = $1 for update", [m.tenantId]);   // one change at a time, so two admins cannot remove each other
    const cur = (await q.query<{ role: string; status: string }>("select role, status from public.tenant_memberships where tenant_id = $1 and user_id = $2", [m.tenantId, userId])).rows[0];
    if (!cur) throw new UserError("That person is not in this workspace.");
    if (c.role) {
      if (c.role === "vendor" && cur.role !== "vendor") throw new UserError("Workshop logins are made by inviting the workshop.");
      if (cur.role === "vendor" && c.role !== "vendor") throw new UserError("A workshop login cannot become an employee login. Invite the person instead.");
      if ((await q.query("select 1 from roles where key = $1", [c.role])).rows.length === 0) throw new UserError("Unknown role.", { role: "Choose a role" });
    }
    const losesAdmin = cur.role === "tenant_admin" && cur.status === "active" && ((c.role && c.role !== "tenant_admin") || c.status === "disabled");
    if (losesAdmin) {
      const others = (await q.query<{ c: number }>("select count(*)::int c from public.tenant_memberships where tenant_id = $1 and role = 'tenant_admin' and status = 'active' and user_id <> $2", [m.tenantId, userId])).rows[0].c;
      if (others === 0) throw new UserError("There must be at least one active administrator.");
    }
    const scope = (c.role ?? cur.role) === "requester" ? "own" : (c.vehicle_scope ?? null);   // a vehicle user is always limited to their own vehicle
    try {
      await q.query(
        "update public.tenant_memberships set role = coalesce($3, role), vehicle_scope = coalesce($4, vehicle_scope), status = coalesce($5, status) where tenant_id = $1 and user_id = $2",
        [m.tenantId, userId, c.role ?? null, scope, c.status ?? null]);
    } catch (e) { friendly(e); }
  }).then(async () => {
    // A disabled person also loses the organization's files (the file bucket asks the control plane's index); an enabled one gets them back.
    if (c.status === "disabled") await forgetMember(driver, userId, m.tenantId);
    else if (c.status === "active") await rememberMember(driver, userId, m.tenantId);
  });
}

// ============================ Invitations ============================
// Every invitation names a role and, except for a workshop, an employee code in the company (ADR-025). The person is either
// reached by email (they confirm it and sign in with it) or has no email and is given a sign-in name, in which case the app
// makes their login itself when they open the link (see acceptWithUsername).

export type Invitation = {
  id: string; full_name: string; email: string | null; phone: string | null; username: string | null; employee_no: string | null; reset: boolean;
  role_key: string; role_name: string; vehicle_scope: string; vendor_name: string | null; expires_at: string; expired: boolean; created_at: string;
};

export function listInvitations(driver: Driver, m: Membership): Promise<Invitation[]> {
  return authorized(driver, m, "admin.users", async (q) =>
    (await q.query<Invitation>(
      `select i.id, i.full_name, i.email, i.phone, i.username, i.employee_no, (i.reset_user_id is not null) as reset, i.role_key, coalesce(r.name, i.role_key) as role_name, i.vehicle_scope, vn.name as vendor_name,
              i.expires_at::text, (i.expires_at <= now()) as expired, i.created_at::text
         from public.invitations i left join roles r on r.key = i.role_key left join vendors vn on vn.id = i.vendor_id
        where i.tenant_id = $1 and i.accepted_at is null and i.revoked_at is null order by i.created_at desc`, [m.tenantId])).rows);
}

const lower = (s: string) => s.toLowerCase();
export const inviteSchema = z.object({
  full_name: z.preprocess(blank, z.string().trim().min(2, "Enter the full name").max(120).optional()),
  employee_no: z.preprocess(blank, z.string().trim().min(1).max(30, "That code is too long").regex(/^[A-Za-z0-9][A-Za-z0-9._/ -]*$/, "Use letters, numbers and - . / only").optional()),
  email: z.preprocess(blank, z.email("Enter a valid email").transform(lower).optional()),
  username: z.preprocess(blank, z.string().trim().max(40).optional()),
  phone: z.preprocess(blank, z.string().trim().max(30).optional()),
  role: z.string().min(1, "Choose a role").max(40),
  vehicle_scope: z.enum(["all", "own"]).default("all"),
  vendor_id: z.preprocess(blank, z.uuid().optional()),
});
type InviteData = z.output<typeof inviteSchema> & { username?: string };

export type NewInvite = { id: string; token: string; full_name: string; email: string | null; phone: string | null; username: string | null; employee_no: string | null; reset: boolean; expires_at: string };

/** `phoneOptional` is only for a request approved from the join-with-a-code page: that person is told on their own screen, so no link is sent anywhere. */
type InviteOptions = { phoneOptional?: boolean };

async function createInvite(q: Parameters<Parameters<typeof authorized>[3]>[0], m: Membership, d: InviteData, opts: InviteOptions = {}): Promise<NewInvite & { hash: string }> {
  await q.query("select 1 from public.tenants where id = $1 for update", [m.tenantId]);
  if ((await q.query("select 1 from roles where key = $1", [d.role])).rows.length === 0) throw new UserError("Unknown role.", { role: "Choose a role" });
  if (d.role === "vendor") {
    if (d.employee_no) throw new UserError("A workshop has no employee code.", { employee_no: "Leave this empty for a workshop" });
    if (!d.vendor_id) throw new UserError("Choose the workshop.", { vendor_id: "Choose the workshop" });
    const v = (await q.query<{ user_id: string | null; status: string }>("select user_id, status from vendors where id = $1", [d.vendor_id])).rows[0];
    if (!v) throw new UserError("Workshop not found.", { vendor_id: "Choose the workshop" });
    if (v.status !== "active") throw new UserError("That workshop is blocked.", { vendor_id: "Workshop is blocked" });
    if (v.user_id) throw new UserError("That workshop already has a login.", { vendor_id: "Already has a login" });
  } else if (d.vendor_id) throw new UserError("A workshop can only be chosen for the workshop role.", { vendor_id: "Only for the workshop role" });

  // Everyone who is not a workshop is a named employee of the company, found by employee code. A code with no record yet is fine: the
  // record is made when the person accepts, with this code and name. A record that already has a login cannot be invited again.
  let name = d.full_name, phone = d.phone;
  if (d.role !== "vendor") {
    if (!d.employee_no) throw new UserError("Enter the employee code.", { employee_no: "Enter the employee code" });
    const e = (await q.query<{ full_name: string; user_id: string | null; active: boolean; phone: string | null }>("select full_name, user_id, active, phone from employees where lower(employee_no) = lower($1)", [d.employee_no])).rows[0];
    if (e) {
      if (!e.active) throw new UserError("That employee is marked as no longer working here.", { employee_no: "Employee is inactive" });
      if (e.user_id) throw new UserError("That employee already has a login.", { employee_no: "Already has a login" });
      name ??= e.full_name; phone ??= e.phone ?? undefined;
    }
  }
  if (!name) throw new UserError("Enter the full name.", { full_name: "Enter the full name" });

  // The link is sent to the person's phone number and nowhere else (ADR-026), so every invitation needs a number a message can reach.
  if (phone) {
    const n = normalizePhone(phone);
    if (!n.ok) throw new UserError(n.message, { phone: n.message });
    phone = n.e164;
  } else if (!opts.phoneOptional) throw new UserError("Enter their phone number. The invitation link is sent to it.", { phone: "Enter their phone number" });

  if (d.role !== "vendor") {
    const limit = (await q.query<{ l: number | null }>(
      `select (p.limits->>'max_users')::int as l from public.tenant_subscriptions s join public.plans p on p.id = s.plan_id where s.tenant_id = $1 and s.status in ('trial','active')`, [m.tenantId])).rows[0]?.l ?? null;
    if (limit !== null) {
      const used = (await q.query<{ c: number }>(
        `select (select count(*) from public.tenant_memberships where tenant_id = $1 and status = 'active' and role <> 'vendor')
              + (select count(*) from public.invitations where tenant_id = $1 and accepted_at is null and revoked_at is null and expires_at > now() and role_key <> 'vendor' and reset_user_id is null)  as c`, [m.tenantId])).rows[0].c;
      if (Number(used) >= limit) throw new UserError(`Your plan allows ${limit} users, counting people already invited. Cancel an invitation or disable someone first.`);
    }
  }
  if (d.email) {
    const dup = await q.query("select 1 from employees e join public.tenant_memberships mm on mm.user_id = e.user_id and mm.tenant_id = $2 where lower(e.email) = $1 and mm.status = 'active'", [d.email, m.tenantId]);
    if (dup.rows.length) throw new UserError("Someone with this email is already in the workspace.", { email: "Already a member" });
  }

  const scope = d.role === "requester" ? "own" : d.vehicle_scope;   // vehicle users raise cards for the vehicle they hold; managers and administrators for any
  const token = newInviteToken();
  try {
    const row = (await q.query<{ id: string; expires_at: string }>(
      `insert into public.invitations(tenant_id, full_name, email, phone, username, employee_no, role_key, vehicle_scope, invited_by, token_hash, vendor_id, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now() + ($12 || ' days')::interval) returning id, expires_at::text`,
      [m.tenantId, name, d.email ?? null, phone ?? null, d.email ? null : d.username ?? null, d.employee_no ?? null, d.role, scope, m.userId, hashInviteToken(token), d.vendor_id ?? null, String(INVITE_DAYS)])).rows[0];
    return { id: row.id, token, full_name: name, email: d.email ?? null, phone: phone ?? null, username: d.email ? null : d.username ?? null, employee_no: d.employee_no ?? null, reset: false, expires_at: row.expires_at, hash: hashInviteToken(token) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/invitations_live_email_uq/.test(msg)) throw new UserError("This email already has an open invitation. Cancel it or send a new link from the list.", { email: "Already invited" });
    if (/invitations_live_username_uq/.test(msg)) throw new UserError("That sign-in name already has an open invitation.", { username: "Already invited" });
    if (/invitations_live_employee_uq/.test(msg)) throw new UserError("This employee already has an open invitation. Cancel it or send a new link from the list.", { employee_no: "Already invited" });
    throw e;
  }
}

type CreatedInvite = NewInvite & { hash: string };
const publicInvite = ({ hash: _h, ...rest }: CreatedInvite): NewInvite => { void _h; return rest; };

/** The control plane learns where the link and the address belong. If that fails the invitation is withdrawn, so no dead link is handed out. */
async function track(driver: Driver, m: Membership, inv: CreatedInvite): Promise<void> {
  try {
    await routeToken(driver, "invite", m.tenantId, inv.hash, inv.expires_at);
    if (inv.email) await indexInvitation(driver, m.tenantId, inv.id, inv.email, inv.expires_at);   // a person with no email is found by the link alone
  } catch {
    await withTenant(driver, m, (q) => q.query("update public.invitations set revoked_at = now() where id = $1", [inv.id])).catch(() => undefined);
    throw new UserError("The invitation could not be created. Try again.");
  }
}

/** Index rows that are left behind are harmless (the organization's database decides); removing them is housekeeping. */
async function untrack(driver: Driver, tenantId: string, invitationId: string, hash: string | null): Promise<void> {
  await Promise.all([hash ? unrouteToken(driver, hash) : Promise.resolve(), unindexInvitation(driver, tenantId, invitationId)]).catch(() => undefined);
}

/** Checks a sign-in name before it is put on an invitation. The control plane has the last word again when the person accepts. */
async function checkNewUsername(driver: Driver, raw: string | undefined): Promise<string> {
  const u = checkUsername(raw ?? "");
  if (!u.ok) throw new UserError(u.message, { username: u.message });
  if (await usernameTaken(driver, u.username)) throw new UserError("That sign-in name is already taken.", { username: "Already taken" });
  return u.username;
}

/** The link is shown once; only its hash is stored. */
export async function inviteUser(driver: Driver, m: Membership, input: Record<string, unknown>, opts: InviteOptions = {}): Promise<NewInvite> {
  const r = inviteSchema.safeParse(input);
  if (!r.success) throw new UserError("Fix the highlighted fields.", fieldErrors(r.error));
  const d: InviteData = { ...r.data };
  if (d.email) delete d.username;
  else {
    if (!authAdminConfigured()) throw new UserError("Inviting someone without an email is not switched on yet. Enter their email, or ask the platform owner to finish the set-up.", { email: "Enter an email" });
    d.username = await checkNewUsername(driver, d.username);
  }
  const inv = await authorized(driver, m, "admin.users", (q) => createInvite(q, m, d, opts));
  await track(driver, m, inv);
  return publicInvite(inv);
}

/** Every box is needed to add an employee: there is no half-filled record (ADR-040). The one choice is how they sign in: an email, or a sign-in name for someone with no email. */
export const newEmployeeSchema = z.object({
  full_name: z.string().trim().min(2, "Enter the full name").max(120, "That name is too long"),
  employee_no: z.string().trim().min(1, "Enter the employee number").max(30, "That code is too long").regex(/^[A-Za-z0-9][A-Za-z0-9._/ -]*$/, "Use letters, numbers and - . / only"),
  department: z.string().trim().min(1, "Enter the department").max(60, "That name is too long"),
  phone: z.string().trim().min(1, "Enter the phone number").max(30, "That number is too long"),
  /** the email, or (for someone with none) a sign-in name: one of the two is needed */
  email: z.preprocess(blank, z.email("Enter a valid email").transform(lower).optional()),
  username: z.preprocess(blank, z.string().trim().max(40).optional()),
  role: z.string().trim().min(1, "Choose a role").max(40).refine((r) => r !== "vendor", "A workshop is added on the Vendors page"),
  vehicle_scope: z.enum(["all", "own"]).default("all"),
});

/**
 * Adding an employee and inviting them are one step (ADR-040): an employee record is only ever made together with its invitation, in one
 * transaction, so a record with no way to sign in cannot be left behind. Needs both permissions, since it does both jobs. The link is shown once.
 */
export async function addEmployeeWithInvite(driver: Driver, m: Membership, input: Record<string, unknown>): Promise<NewInvite> {
  const r = newEmployeeSchema.safeParse(input);
  if (!r.success) throw new UserError("Fix the highlighted fields.", fieldErrors(r.error));
  const d = r.data;
  const phone = normalizePhone(d.phone);
  if (!phone.ok) throw new UserError(phone.message, { phone: phone.message });
  let username: string | undefined;
  if (!d.email) {
    if (!authAdminConfigured()) throw new UserError("Enter their email. Inviting someone without an email is not switched on yet; ask the platform owner to finish the set-up.", { email: "Enter the email" });
    username = await checkNewUsername(driver, d.username);
  }
  const inv = await authorized(driver, m, "admin.users", async (q) => {
    await assertCan(q, m.role, "employee.manage");
    if ((await q.query("select 1 from employees where lower(employee_no) = lower($1)", [d.employee_no])).rows.length) throw new UserError("Another employee already has this employee number.", { employee_no: "Already used" });
    if (d.email && (await q.query("select 1 from employees where lower(email) = lower($1)", [d.email])).rows.length) throw new UserError("Another employee already has this email.", { email: "Already used" });
    await q.query("insert into employees(full_name, employee_no, department, email, phone) values ($1, $2, $3, $4, $5)", [d.full_name, d.employee_no, d.department, d.email ?? null, phone.e164]);
    // the invitation finds the record just made by its employee number; any problem with it (plan limit, an open invitation for this email) rolls the record back too
    return createInvite(q, m, { full_name: d.full_name, employee_no: d.employee_no, email: d.email, username, phone: phone.e164, role: d.role, vehicle_scope: d.vehicle_scope });
  });
  await track(driver, m, inv);
  return publicInvite(inv);
}

export function revokeInvitation(driver: Driver, m: Membership, id: string): Promise<void> {
  return authorized(driver, m, "admin.users", async (q) => {
    const r = await q.query<{ token_hash: string }>("update public.invitations set revoked_at = now() where id = $1 and tenant_id = $2 and accepted_at is null and revoked_at is null returning token_hash", [id, m.tenantId]);
    if (r.rows.length === 0) throw new UserError("That invitation is no longer open.");
    return r.rows[0].token_hash;
  }).then((hash) => untrack(driver, m.tenantId, id, hash));
}

/** Cancels the old link and makes a new one with the same details. A reset link is made again for the same person. */
export async function resendInvitation(driver: Driver, m: Membership, id: string): Promise<NewInvite> {
  const old = await authorized(driver, m, "admin.users", async (q) =>
    (await q.query<{ reset_user_id: string | null }>("select reset_user_id from public.invitations where id = $1 and tenant_id = $2 and accepted_at is null and revoked_at is null", [id, m.tenantId])).rows[0]);
  if (!old) throw new UserError("That invitation is no longer open.");
  if (old.reset_user_id) return issueResetLink(driver, m, old.reset_user_id);
  const { fresh, oldHash } = await authorized(driver, m, "admin.users", async (q) => {
    const o = (await q.query<{ full_name: string; email: string | null; phone: string | null; username: string | null; employee_no: string | null; role_key: string; vehicle_scope: string; vendor_id: string | null; token_hash: string }>(
      "select full_name, email, phone, username, employee_no, role_key, vehicle_scope, vendor_id, token_hash from public.invitations where id = $1 and tenant_id = $2 and accepted_at is null and revoked_at is null", [id, m.tenantId])).rows[0];
    if (!o) throw new UserError("That invitation is no longer open.");
    await q.query("update public.invitations set revoked_at = now() where id = $1", [id]);
    const fresh = await createInvite(q, m, {
      full_name: o.full_name, email: o.email ?? undefined, phone: o.phone ?? undefined, username: o.username ?? undefined, employee_no: o.employee_no ?? undefined,
      role: o.role_key, vehicle_scope: o.vehicle_scope as "all" | "own", vendor_id: o.vendor_id ?? undefined,
    }, { phoneOptional: !o.phone });
    return { fresh, oldHash: o.token_hash };
  });
  await track(driver, m, fresh);
  await untrack(driver, m.tenantId, id, oldHash);
  return publicInvite(fresh);
}

const RESET_DAYS = 2;

/**
 * A person who signs in with a name has no email to send a reset to, so an administrator makes them a one-time link instead. They open
 * it, choose a new password, and sign in. Only for people with a sign-in name (everyone else uses "Forgot your password?"), never
 * for yourself, and any earlier reset link for the same person stops working.
 */
export async function issueResetLink(driver: Driver, m: Membership, userId: string): Promise<NewInvite> {
  if (userId === m.userId) throw new UserError("Ask another administrator to reset your password.");
  const ln = await loginNameByUserId(driver, userId);
  if (!ln) throw new UserError("This person signs in with an email, so they can choose a new password with \"Forgot your password?\".");
  const { inv, oldHashes } = await authorized(driver, m, "admin.users", async (q) => {
    const mem = (await q.query<{ role: string; vehicle_scope: string; status: string; full_name: string | null; employee_no: string | null; vendor_name: string | null; phone: string | null }>(
      `select mm.role, mm.vehicle_scope, mm.status, e.full_name, e.employee_no, e.phone, vn.name as vendor_name
         from public.tenant_memberships mm left join employees e on e.user_id = mm.user_id left join vendors vn on vn.user_id = mm.user_id
        where mm.tenant_id = $1 and mm.user_id = $2`, [m.tenantId, userId])).rows[0];
    if (!mem) throw new UserError("That person is not in this workspace.");
    if (mem.status !== "active") throw new UserError("That person's access is switched off. Switch it on first.");
    // Like every link, a reset link goes to the person's phone number only. So their employee record must have one.
    const phone = mem.phone ? normalizePhone(mem.phone) : null;
    if (!phone || !phone.ok) throw new UserError("This person has no phone number on their employee record. Add it under Employees first: the reset link is sent to it.");
    const olds = (await q.query<{ token_hash: string; id: string }>("update public.invitations set revoked_at = now() where reset_user_id = $1 and tenant_id = $2 and accepted_at is null and revoked_at is null returning token_hash, id", [userId, m.tenantId])).rows;
    const token = newInviteToken();
    const row = (await q.query<{ id: string; expires_at: string }>(
      `insert into public.invitations(tenant_id, full_name, phone, username, employee_no, role_key, vehicle_scope, invited_by, token_hash, reset_user_id, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + ($11 || ' days')::interval) returning id, expires_at::text`,
      [m.tenantId, mem.full_name ?? mem.vendor_name ?? ln.username, phone.e164, ln.username, mem.employee_no, mem.role, mem.vehicle_scope, m.userId, hashInviteToken(token), userId, String(RESET_DAYS)])).rows[0];
    return {
      inv: { id: row.id, token, full_name: mem.full_name ?? mem.vendor_name ?? ln.username, email: null, phone: phone.e164, username: ln.username, employee_no: mem.employee_no, reset: true, expires_at: row.expires_at, hash: hashInviteToken(token) } as CreatedInvite,
      oldHashes: olds,
    };
  });
  await track(driver, m, inv);
  for (const o of oldHashes) await untrack(driver, m.tenantId, o.id, o.token_hash);
  return publicInvite(inv);
}

// ============================ The invited person ============================

/** `codeRequired`: a one-time code is texted to the number ending `phoneHint` and must be typed before the account is made (ADR-041). */
export type InvitePreview = { workspace: string; full_name: string; email: string | null; username: string | null; reset: boolean; codeRequired: boolean; phoneHint: string | null };

/** What the invitation page may show: nothing for an unknown, used, revoked or expired link. */
export async function previewInvitation(driver: Driver, token: string): Promise<InvitePreview | null> {
  if (!TOKEN_RE.test(token)) return null;
  const hash = hashInviteToken(token);
  const t = await findTenantByToken(driver, "invite", hash);
  if (!t) return null;
  const r = (await withOrgPlatform(driver, t.schema, (q) => q.query<Omit<InvitePreview, "codeRequired" | "phoneHint"> & { phone: string | null }>(
    `select t.name as workspace, i.full_name, i.email, i.username, (i.reset_user_id is not null) as reset, i.phone from public.invitations i join public.tenants t on t.id = i.tenant_id
      where i.token_hash = $1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > now() and t.status = 'active' and (i.email is not null or i.username is not null)`, [hash]))).rows[0];
  if (!r) return null;
  const { phone, ...rest } = r;                                  // the full number never leaves the server
  const codeRequired = smsConfigured() && !!phone && !r.reset;
  return { ...rest, codeRequired, phoneHint: codeRequired ? `ending ${phone!.replace(/\D/g, "").slice(-4)}` : null };
}

export type PendingInvite = { id: string; workspace: string; role_name: string };

/** Invitations waiting for a signed-in person whose email is confirmed. */
export async function pendingInvitationsFor(driver: Driver, user: { email?: string | null; emailConfirmed: boolean }): Promise<PendingInvite[]> {
  if (!user.email || !user.emailConfirmed) return [];
  const email = user.email;
  const listed = await tenantsInvitingEmail(driver, email);
  const found = await Promise.all(listed.map((t) => withOrgPlatform(driver, t.schema, async (q) =>
    (await q.query<PendingInvite & { created_at: string }>(
      `select i.id, t.name as workspace, i.role_key as role_name, i.created_at::text from public.invitations i join public.tenants t on t.id = i.tenant_id
        where i.id = $1 and lower(i.email) = lower($2) and i.accepted_at is null and i.revoked_at is null and i.expires_at > now() and t.status = 'active'`, [t.invitation_id, email])).rows[0])));
  return found.filter((x): x is PendingInvite & { created_at: string } => !!x).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(({ id, workspace, role_name }) => ({ id, workspace, role_name }));
}

export type Acceptor = { id: string; email?: string | null; emailConfirmed: boolean; username?: string };

type InviteRow = { id: string; tenant_id: string; full_name: string; email: string | null; username: string | null; employee_no: string | null; phone: string | null; role_key: string; vehicle_scope: string; vendor_id: string | null; token_hash: string; reset_user_id: string | null; ok: boolean; accepted: boolean };

/** Links the new login to the employee the invitation names: the existing record with that code, or a new one with that code and name. */
async function linkEmployee(q: Parameters<Parameters<typeof withTenant>[2]>[0], inv: InviteRow, userId: string): Promise<void> {
  if ((await q.query("select 1 from employees where user_id = $1", [userId])).rows.length > 0) return;
  if (inv.employee_no) {
    const e = (await q.query<{ id: string; user_id: string | null }>("select id, user_id from employees where lower(employee_no) = lower($1)", [inv.employee_no])).rows[0];
    if (e) {
      if (e.user_id && e.user_id !== userId) throw new UserError("That employee already has a login. Ask for a new invitation.");
      await q.query("update employees set user_id = $1, phone = coalesce(phone, $3) where id = $2", [userId, e.id, inv.phone]);
    } else {
      await q.query("insert into employees(user_id, full_name, employee_no, email, phone) values ($1, $2, $3, $4, $5)", [userId, inv.full_name, inv.employee_no, inv.email, inv.phone]);
    }
    return;
  }
  // An invitation made before employee codes were asked for: match by email if there is exactly one such employee, else make a record.
  const same = inv.email ? await q.query<{ id: string }>("select id from employees where lower(email) = lower($1) and user_id is null and active", [inv.email]) : { rows: [] as { id: string }[] };
  if (same.rows.length === 1) await q.query("update employees set user_id = $1 where id = $2", [userId, same.rows[0].id]);
  else await q.query("insert into employees(user_id, full_name, email, phone) values ($1, $2, $3, $4)", [userId, inv.full_name, inv.email, inv.phone]);
}

/**
 * Joins the workspace. The invitation must be live and addressed to the signed-in person: by their confirmed email (holding the link
 * alone is not enough), or, for a person with a sign-in name, by that name (acceptWithUsername has just made the login). Creates the
 * membership, links the person to their employee record by employee code, links a workshop to its login, and marks the invitation used,
 * all in one transaction in the organization's own database. Then the control plane is told. Repeating a finished acceptance for the
 * same person is safe and only repeats that last step. Returns the workspace slug.
 */
export async function acceptInvitation(driver: Driver, by: { id: string } | { token: string }, user: Acceptor): Promise<{ slug: string }> {
  const refused = () => new UserError("This invitation is not valid for your account.");
  if (!user.username && (!user.email || !user.emailConfirmed)) throw new UserError("Confirm your email address first, then accept the invitation.");
  if (user.username && !("token" in by)) throw refused();
  if ("token" in by && !TOKEN_RE.test(by.token)) throw refused();
  const hash = "token" in by ? hashInviteToken(by.token) : null;
  const found = hash ? await findTenantByToken(driver, "invite", hash) : await findTenantByInvitation(driver, (by as { id: string }).id);
  if (!found) throw refused();
  const done = await withTenant(driver, { schema: found.schema, userId: user.id, role: "invitee" }, async (q) => {
    const inv = (await q.query<InviteRow>(
      `select id, tenant_id, full_name, email, username, employee_no, phone, role_key, vehicle_scope, vendor_id, token_hash, reset_user_id,
              (accepted_at is null and revoked_at is null and expires_at > now()) as ok, (accepted_at is not null) as accepted
         from public.invitations where ${hash ? "token_hash = $1" : "id = $1"} for update`, [hash ?? (by as { id: string }).id])).rows[0];
    if (!inv || inv.reset_user_id) throw refused();
    const mine = user.username ? !!inv.username && inv.username === user.username : !!inv.email && !!user.email && inv.email.toLowerCase() === user.email.toLowerCase();
    if (!mine) throw refused();
    if (!inv.ok) {
      // Already accepted by this same person: nothing to do here, the control plane step below may still be missing.
      const member = inv.accepted && (await q.query("select 1 from public.tenant_memberships where user_id = $1 and tenant_id = $2", [user.id, inv.tenant_id])).rows.length > 0;
      if (!member) throw refused();
      return { invitationId: inv.id, hash: inv.token_hash, tenantId: inv.tenant_id };
    }
    try {
      await q.query(
        `insert into public.tenant_memberships(user_id, tenant_id, role, vehicle_scope) values ($1, $2, $3, $4)
         on conflict (user_id, tenant_id) do update set role = excluded.role, vehicle_scope = excluded.vehicle_scope, status = 'active'`,
        [user.id, inv.tenant_id, inv.role_key, inv.vehicle_scope]);
    } catch (e) { friendly(e); }
    if (inv.role_key === "vendor") {
      const linked = await q.query("update vendors set user_id = $1 where id = $2 and user_id is null returning id", [user.id, inv.vendor_id]);
      if (linked.rows.length === 0) throw new UserError("That workshop already has a login. Ask for a new invitation.");
    } else await linkEmployee(q, inv, user.id);
    await q.query("update public.invitations set accepted_at = now() where id = $1", [inv.id]);
    return { invitationId: inv.id, hash: inv.token_hash, tenantId: inv.tenant_id };
  });
  // The person is a member now. Tell the control plane (retry once: a failure here would hide the workspace until repeated).
  for (let i = 0; ; i++) {
    try { await rememberMember(driver, user.id, done.tenantId); break; }
    catch { if (i >= 1) throw new UserError("You have joined, but the workspace could not be listed yet. Open the invitation link again to finish."); }
  }
  await untrack(driver, done.tenantId, done.invitationId, done.hash);
  return { slug: found.slug };
}

/**
 * The person with a sign-in name opens their link and chooses a password and a recovery code. This makes their login, then joins the
 * workspace. On a reset link, the link alone is not enough: it also needs the recovery code the person chose when they first set up,
 * which no administrator ever sees, so whoever merely holds the link cannot take the login over. Wrong codes are counted per person,
 * across every link, and stop after five in an hour. If the set-up stops half way, opening the same link again finishes it: the
 * half-made login is recognised by the invitation that made it. Returns what the page needs to sign them in.
 */
export async function acceptWithUsername(driver: Driver, token: string, password: string, recoveryCode: string): Promise<{ slug: string; loginEmail: string; reset: boolean }> {
  const refused = () => new UserError("This invitation is not working. Ask your administrator for a new one.");
  if (!TOKEN_RE.test(token)) throw refused();
  const hash = hashInviteToken(token);
  const found = await findTenantByToken(driver, "invite", hash);
  if (!found) throw refused();
  const inv = (await withOrgPlatform(driver, found.schema, (q) => q.query<InviteRow>(
    `select i.id, i.tenant_id, i.full_name, i.email, i.username, i.employee_no, i.phone, i.role_key, i.vehicle_scope, i.vendor_id, i.token_hash, i.reset_user_id, true as ok, false as accepted
       from public.invitations i join public.tenants t on t.id = i.tenant_id
      where i.token_hash = $1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > now() and t.status = 'active'`, [hash]))).rows[0];
  if (!inv || !inv.username) throw refused();
  const existing = await loginNameByUsername(driver, inv.username);

  if (inv.reset_user_id) {
    if (!existing || existing.userId !== inv.reset_user_id) throw refused();
    // The code proves it is the person and not whoever holds the link. Every try is counted before it is checked.
    if (!(await allowShared(driver, `reset-code:${existing.userId}`, 5, 3600))) throw new UserError("Too many wrong recovery codes. Try again in an hour, or ask your administrator to replace your login.");
    if (!verifyRecoveryCode(recoveryCode, existing.recoveryHash)) throw new UserError("That recovery code is not right. If you have forgotten it, ask your administrator to replace your login.");
    const active = await withTenant(driver, { schema: found.schema, userId: existing.userId, role: "invitee" }, async (q) =>
      (await q.query("select 1 from public.tenant_memberships where tenant_id = $1 and user_id = $2 and status = 'active'", [inv.tenant_id, existing.userId])).rows.length > 0);
    if (!active) throw new UserError("Your access is switched off. Ask your administrator.");
    await setLoginPassword(existing.userId, password);
    await withTenant(driver, { schema: found.schema, userId: existing.userId, role: "invitee" }, (q) => q.query("update public.invitations set accepted_at = now() where id = $1 and accepted_at is null", [inv.id]));
    await untrack(driver, inv.tenant_id, inv.id, inv.token_hash);
    return { slug: found.slug, loginEmail: existing.loginEmail, reset: true };
  }

  const rc = checkRecoveryCode(recoveryCode);
  if (!rc.ok) throw new UserError(rc.message);
  const recoveryHash = hashRecoveryCode(rc.code);
  let userId: string, loginEmail: string;
  if (existing) {
    // Only the invitation that made this login may finish it, and only while nobody has used it yet.
    const used = existing.invitationId === inv.id && (await withTenant(driver, { schema: found.schema, userId: existing.userId, role: "invitee" }, async (q) =>
      (await q.query("select 1 from public.tenant_memberships where tenant_id = $1 and user_id = $2", [inv.tenant_id, existing.userId])).rows.length > 0));
    if (existing.invitationId !== inv.id || used) throw new UserError("That sign-in name is already taken. Ask your administrator for a new invitation.");
    userId = existing.userId; loginEmail = existing.loginEmail;
    await setLoginPassword(userId, password);
    await setRecoveryHash(driver, userId, recoveryHash);
  } else {
    loginEmail = newLoginEmail();
    userId = await createLoginUser({ email: loginEmail, password, fullName: inv.full_name, username: inv.username });
    try { await recordLoginName(driver, { username: inv.username, userId, loginEmail, invitationId: inv.id, recoveryHash }); }
    catch (e) { await deleteLoginUser(userId); throw e; }
  }
  const { slug } = await acceptInvitation(driver, { token }, { id: userId, username: inv.username, emailConfirmed: true });
  return { slug, loginEmail, reset: false };
}

/**
 * For someone with a sign-in name who has forgotten both their password and their recovery code. Their login is switched off and
 * removed, and their employee record is freed, so they can be invited again with a new login. It is a visible event, not a quiet one:
 * the old login stops working at once, the change is written to the audit trail with the administrator's name, and whoever signs in
 * next is a new login on the same employee record. Never for yourself, never for the last administrator, only for sign-in-name logins.
 */
export async function replaceLogin(driver: Driver, m: Membership, userId: string): Promise<{ username: string; employee_no: string | null }> {
  if (userId === m.userId) throw new UserError("Ask another administrator to replace your login.");
  const ln = await loginNameByUserId(driver, userId);
  if (!ln) throw new UserError("This person signs in with an email. Switch off their access, or invite them again, instead.");
  const gone = await authorized(driver, m, "admin.users", async (q) => {
    await q.query("select 1 from public.tenants where id = $1 for update", [m.tenantId]);   // one change at a time, so two administrators cannot remove each other
    const mem = (await q.query<{ role: string; status: string; employee_no: string | null }>(
      `select mm.role, mm.status, e.employee_no from public.tenant_memberships mm left join employees e on e.user_id = mm.user_id where mm.tenant_id = $1 and mm.user_id = $2`, [m.tenantId, userId])).rows[0];
    if (!mem) throw new UserError("That person is not in this workspace.");
    if (mem.role === "vendor") throw new UserError("A workshop login is replaced by inviting the workshop again.");
    if (mem.role === "tenant_admin" && mem.status === "active") {
      const others = (await q.query<{ c: number }>("select count(*)::int c from public.tenant_memberships where tenant_id = $1 and role = 'tenant_admin' and status = 'active' and user_id <> $2", [m.tenantId, userId])).rows[0].c;
      if (others === 0) throw new UserError("There must be at least one active administrator.");
    }
    await q.query("update public.tenant_memberships set status = 'disabled' where tenant_id = $1 and user_id = $2", [m.tenantId, userId]);
    await q.query("update employees set user_id = null where user_id = $1", [userId]);
    const olds = (await q.query<{ token_hash: string; id: string }>("update public.invitations set revoked_at = now() where reset_user_id = $1 and tenant_id = $2 and accepted_at is null and revoked_at is null returning token_hash, id", [userId, m.tenantId])).rows;
    return { employee_no: mem.employee_no, olds };
  });
  await forgetMember(driver, userId, m.tenantId);
  await deleteLoginName(driver, userId);
  await deleteLoginUser(userId);
  for (const o of gone.olds) await untrack(driver, m.tenantId, o.id, o.token_hash);
  return { username: ln.username, employee_no: gone.employee_no };
}

/** The one way the rest of the app saves a file that arrived with no one signed in (a workshop's email, ADR-033). Everything else about the service key stays in supabase/admin.ts. */
export const storeInboundFile = putInboundFile;
