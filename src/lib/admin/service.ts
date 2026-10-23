// People and access: members, invitations (invite-only onboarding), plan usage. Managing people needs admin.users
// (CLAUDE.md rule 3). Accepting an invitation is done by the invited person, so it checks the invitation itself instead:
// a live invitation, addressed to the confirmed email of the signed-in user.
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Driver } from "@/lib/db/types";
import { authorized, authorizedAny, type Membership } from "@/lib/auth/can";
import { withOrgPlatform, withTenant } from "@/lib/db/tenant";
import { findTenantByInvitation, findTenantByToken, indexInvitation, rememberMember, routeToken, tenantsInvitingEmail, unindexInvitation, unrouteToken } from "@/lib/orgs";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";

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

export function planUsage(driver: Driver, m: Membership): Promise<Usage> {
  return authorizedAny(driver, m, ["admin.users", "vehicle.read"], async (q) => {
    const lim = async (key: string) => (await q.query<{ l: number | null }>("select plan_limit($1) as l", [key])).rows[0].l;
    const vehicles = (await q.query<{ c: number }>("select count(*)::int c from vehicles where status <> 'disposed'")).rows[0].c;
    const users = (await q.query<{ c: number }>(
      "select count(*)::int c from public.tenant_memberships where tenant_id = $1 and status = 'active' and role <> 'vendor'", [m.tenantId])).rows[0].c;
    const ul = (await q.query<{ l: number | null }>(
      `select (p.limits->>'max_users')::int as l from public.tenant_subscriptions s join public.plans p on p.id = s.plan_id
        where s.tenant_id = $1 and s.status in ('trial','active')`, [m.tenantId])).rows[0]?.l ?? null;
    return { vehicles: { used: vehicles, limit: await lim("max_vehicles") }, users: { used: users, limit: ul } };
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
};

export function listMembers(driver: Driver, m: Membership): Promise<Member[]> {
  return authorized(driver, m, "admin.users", async (q) =>
    (await q.query<Member>(
      `select mm.user_id, mm.role, coalesce(r.name, mm.role) as role_name, mm.status, mm.vehicle_scope, mm.created_at::date::text as since,
              e.full_name, e.email, vn.name as vendor_name, (mm.user_id = $2) as is_me
         from public.tenant_memberships mm
         left join roles r on r.key = mm.role
         left join employees e on e.user_id = mm.user_id
         left join vendors vn on vn.user_id = mm.user_id
        where mm.tenant_id = $1 order by (mm.status = 'active') desc, mm.role, coalesce(e.full_name, vn.name), mm.user_id`, [m.tenantId, m.userId])).rows);
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
  });
}

// ============================ Invitations ============================

export type Invitation = { id: string; full_name: string; email: string | null; phone: string | null; role_key: string; role_name: string; vehicle_scope: string; vendor_name: string | null; expires_at: string; expired: boolean; created_at: string };

export function listInvitations(driver: Driver, m: Membership): Promise<Invitation[]> {
  return authorized(driver, m, "admin.users", async (q) =>
    (await q.query<Invitation>(
      `select i.id, i.full_name, i.email, i.phone, i.role_key, coalesce(r.name, i.role_key) as role_name, i.vehicle_scope, vn.name as vendor_name,
              i.expires_at::text, (i.expires_at <= now()) as expired, i.created_at::text
         from public.invitations i left join roles r on r.key = i.role_key left join vendors vn on vn.id = i.vendor_id
        where i.tenant_id = $1 and i.accepted_at is null and i.revoked_at is null order by i.created_at desc`, [m.tenantId])).rows);
}

export const inviteSchema = z.object({
  full_name: z.string().trim().min(2, "Enter the full name").max(120),
  email: z.email("Enter a valid email").transform((s) => s.toLowerCase()),
  phone: z.preprocess(blank, z.string().trim().max(30).optional()),
  role: z.string().min(1, "Choose a role").max(40),
  vehicle_scope: z.enum(["all", "own"]).default("all"),
  vendor_id: z.preprocess(blank, z.uuid().optional()),
});

export type NewInvite = { id: string; token: string; email: string; expires_at: string };

async function createInvite(q: Parameters<Parameters<typeof authorized>[3]>[0], m: Membership, d: z.output<typeof inviteSchema>): Promise<NewInvite & { hash: string }> {
  await q.query("select 1 from public.tenants where id = $1 for update", [m.tenantId]);
  if ((await q.query("select 1 from roles where key = $1", [d.role])).rows.length === 0) throw new UserError("Unknown role.", { role: "Choose a role" });
  if (d.role === "vendor") {
    if (!d.vendor_id) throw new UserError("Choose the workshop.", { vendor_id: "Choose the workshop" });
    const v = (await q.query<{ user_id: string | null; status: string }>("select user_id, status from vendors where id = $1", [d.vendor_id])).rows[0];
    if (!v) throw new UserError("Workshop not found.", { vendor_id: "Choose the workshop" });
    if (v.status !== "active") throw new UserError("That workshop is blocked.", { vendor_id: "Workshop is blocked" });
    if (v.user_id) throw new UserError("That workshop already has a login.", { vendor_id: "Already has a login" });
  } else if (d.vendor_id) throw new UserError("A workshop can only be chosen for the workshop role.", { vendor_id: "Only for the workshop role" });

  if (d.role !== "vendor") {
    const limit = (await q.query<{ l: number | null }>(
      `select (p.limits->>'max_users')::int as l from public.tenant_subscriptions s join public.plans p on p.id = s.plan_id where s.tenant_id = $1 and s.status in ('trial','active')`, [m.tenantId])).rows[0]?.l ?? null;
    if (limit !== null) {
      const used = (await q.query<{ c: number }>(
        `select (select count(*) from public.tenant_memberships where tenant_id = $1 and status = 'active' and role <> 'vendor')
              + (select count(*) from public.invitations where tenant_id = $1 and accepted_at is null and revoked_at is null and expires_at > now() and role_key <> 'vendor')  as c`, [m.tenantId])).rows[0].c;
      if (Number(used) >= limit) throw new UserError(`Your plan allows ${limit} users, counting people already invited. Cancel an invitation or disable someone first.`);
    }
  }
  const dup = await q.query("select 1 from employees e join public.tenant_memberships mm on mm.user_id = e.user_id and mm.tenant_id = $2 where lower(e.email) = $1 and mm.status = 'active'", [d.email, m.tenantId]);
  if (dup.rows.length) throw new UserError("Someone with this email is already in the workspace.", { email: "Already a member" });

  const scope = d.role === "requester" ? "own" : d.vehicle_scope;   // vehicle users raise cards for the vehicle they hold; managers and administrators for any
  const token = newInviteToken();
  try {
    const row = (await q.query<{ id: string; expires_at: string }>(
      `insert into public.invitations(tenant_id, full_name, email, phone, role_key, vehicle_scope, invited_by, token_hash, vendor_id, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + ($10 || ' days')::interval) returning id, expires_at::text`,
      [m.tenantId, d.full_name, d.email, d.phone ?? null, d.role, scope, m.userId, hashInviteToken(token), d.vendor_id ?? null, String(INVITE_DAYS)])).rows[0];
    return { id: row.id, token, email: d.email, expires_at: row.expires_at, hash: hashInviteToken(token) };
  } catch (e) {
    if (e instanceof Error && /invitations_live_email_uq/.test(e.message)) throw new UserError("This email already has an open invitation. Cancel it or send a new link from the list.", { email: "Already invited" });
    throw e;
  }
}

type CreatedInvite = NewInvite & { hash: string };

/** The control plane learns where the link and the address belong. If that fails the invitation is withdrawn, so no dead link is handed out. */
async function track(driver: Driver, m: Membership, inv: CreatedInvite): Promise<void> {
  try {
    await routeToken(driver, "invite", m.tenantId, inv.hash, inv.expires_at);
    await indexInvitation(driver, m.tenantId, inv.id, inv.email, inv.expires_at);
  } catch {
    await withTenant(driver, m, (q) => q.query("update public.invitations set revoked_at = now() where id = $1", [inv.id])).catch(() => undefined);
    throw new UserError("The invitation could not be created. Try again.");
  }
}

/** Index rows that are left behind are harmless (the organization's database decides); removing them is housekeeping. */
async function untrack(driver: Driver, tenantId: string, invitationId: string, hash: string | null): Promise<void> {
  await Promise.all([hash ? unrouteToken(driver, hash) : Promise.resolve(), unindexInvitation(driver, tenantId, invitationId)]).catch(() => undefined);
}

/** The link is shown once; only its hash is stored. */
export async function inviteUser(driver: Driver, m: Membership, input: Record<string, unknown>): Promise<NewInvite> {
  const r = inviteSchema.safeParse(input);
  if (!r.success) throw new UserError("Fix the highlighted fields.", fieldErrors(r.error));
  const inv = await authorized(driver, m, "admin.users", (q) => createInvite(q, m, r.data));
  await track(driver, m, inv);
  return { id: inv.id, token: inv.token, email: inv.email, expires_at: inv.expires_at };
}

export function revokeInvitation(driver: Driver, m: Membership, id: string): Promise<void> {
  return authorized(driver, m, "admin.users", async (q) => {
    const r = await q.query<{ token_hash: string }>("update public.invitations set revoked_at = now() where id = $1 and tenant_id = $2 and accepted_at is null and revoked_at is null returning token_hash", [id, m.tenantId]);
    if (r.rows.length === 0) throw new UserError("That invitation is no longer open.");
    return r.rows[0].token_hash;
  }).then((hash) => untrack(driver, m.tenantId, id, hash));
}

/** Cancels the old link and makes a new one with the same details. */
export async function resendInvitation(driver: Driver, m: Membership, id: string): Promise<NewInvite> {
  const { fresh, oldHash } = await authorized(driver, m, "admin.users", async (q) => {
    const old = (await q.query<{ full_name: string; email: string; phone: string | null; role_key: string; vehicle_scope: string; vendor_id: string | null; token_hash: string }>(
      "select full_name, email, phone, role_key, vehicle_scope, vendor_id, token_hash from public.invitations where id = $1 and tenant_id = $2 and accepted_at is null and revoked_at is null", [id, m.tenantId])).rows[0];
    if (!old) throw new UserError("That invitation is no longer open.");
    await q.query("update public.invitations set revoked_at = now() where id = $1", [id]);
    const fresh = await createInvite(q, m, { full_name: old.full_name, email: old.email, phone: old.phone ?? undefined, role: old.role_key, vehicle_scope: old.vehicle_scope as "all" | "own", vendor_id: old.vendor_id ?? undefined });
    return { fresh, oldHash: old.token_hash };
  });
  await track(driver, m, fresh);
  await untrack(driver, m.tenantId, id, oldHash);
  return { id: fresh.id, token: fresh.token, email: fresh.email, expires_at: fresh.expires_at };
}

// ============================ The invited person ============================

export type InvitePreview = { workspace: string; full_name: string; email: string };

/** What the invitation page may show: nothing for an unknown, used, revoked or expired link. */
export async function previewInvitation(driver: Driver, token: string): Promise<InvitePreview | null> {
  if (!TOKEN_RE.test(token)) return null;
  const hash = hashInviteToken(token);
  const t = await findTenantByToken(driver, "invite", hash);
  if (!t) return null;
  const r = (await withOrgPlatform(driver, t.schema, (q) => q.query<{ workspace: string; full_name: string; email: string }>(
    `select t.name as workspace, i.full_name, i.email from public.invitations i join public.tenants t on t.id = i.tenant_id
      where i.token_hash = $1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > now() and t.status = 'active' and i.email is not null`, [hash]))).rows[0];
  return r ?? null;
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

export type Acceptor = { id: string; email?: string | null; emailConfirmed: boolean };

/**
 * Joins the workspace. The invitation must be live and addressed to the signed-in person's confirmed email: holding
 * the link alone is not enough. Creates the membership and the employee record (linking an existing record with the
 * same email, if there is exactly one), links a workshop to its login, and marks the invitation used, all in one
 * transaction in the organization's own database. Then the control plane is told. Repeating a finished acceptance for
 * the same person is safe and only repeats that last step. Returns the workspace slug.
 */
export async function acceptInvitation(driver: Driver, by: { id: string } | { token: string }, user: Acceptor): Promise<{ slug: string }> {
  const refused = () => new UserError("This invitation is not valid for your account.");
  if (!user.email || !user.emailConfirmed) throw new UserError("Confirm your email address first, then accept the invitation.");
  if ("token" in by && !TOKEN_RE.test(by.token)) throw refused();
  const hash = "token" in by ? hashInviteToken(by.token) : null;
  const found = hash ? await findTenantByToken(driver, "invite", hash) : await findTenantByInvitation(driver, (by as { id: string }).id);
  if (!found) throw refused();
  const done = await withTenant(driver, { schema: found.schema, userId: user.id, role: "invitee" }, async (q) => {
    const inv = (await q.query<{ id: string; tenant_id: string; full_name: string; email: string; phone: string | null; role_key: string; vehicle_scope: string; vendor_id: string | null; token_hash: string; ok: boolean; accepted: boolean }>(
      `select id, tenant_id, full_name, email, phone, role_key, vehicle_scope, vendor_id, token_hash,
              (accepted_at is null and revoked_at is null and expires_at > now()) as ok, (accepted_at is not null) as accepted
         from public.invitations where ${hash ? "token_hash = $1" : "id = $1"} for update`, [hash ?? (by as { id: string }).id])).rows[0];
    if (!inv || !inv.email || inv.email.toLowerCase() !== user.email!.toLowerCase()) throw refused();
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
    } else if ((await q.query("select 1 from employees where user_id = $1", [user.id])).rows.length === 0) {
      const same = await q.query<{ id: string }>("select id from employees where lower(email) = lower($1) and user_id is null and active", [inv.email]);
      if (same.rows.length === 1) await q.query("update employees set user_id = $1 where id = $2", [user.id, same.rows[0].id]);
      else await q.query("insert into employees(user_id, full_name, email, phone) values ($1, $2, $3, $4)", [user.id, inv.full_name, inv.email, inv.phone]);
    }
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
