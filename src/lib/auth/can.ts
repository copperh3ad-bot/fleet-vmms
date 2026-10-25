// Every server action calls this before touching data (CLAUDE.md rule 3).
import type { Driver, Queryable } from "@/lib/db/types";
import { withOrgPlatform, withPlatform, withTenant, type TenantContext } from "@/lib/db/tenant";
import type { Access } from "@/lib/billing/state";

export class ForbiddenError extends Error {
  /** Next.js shows app/forbidden.tsx (a plain "not allowed" page) for an error carrying this digest, the same as forbidden(). */
  readonly digest = "NEXT_HTTP_ERROR_FALLBACK;403";
  constructor(public permission: string) { super(`forbidden: ${permission}`); }
}

export type Membership = TenantContext & { tenantId: string; vehicleScope: "all" | "own"; /** for display only */ tenantName?: string; /** the workspace currency code, for labels (display only) */ currency?: string; /** set by requireMembership: trial, paid, grace or locked */ billing?: Access };

export type ActiveTenant = { id: string; schema: string; name: string; currency?: string };

/** The active, fully set-up organization behind a web address, from the control plane. Null if there is none. */
export async function findActiveTenant(driver: Driver, slug: string): Promise<ActiveTenant | null> {
  const t = await withPlatform(driver, async (q) =>
    (await q.query<{ id: string; schema_name: string; name: string; currency: string | null }>(
      "select id, schema_name, name, currency from public.tenants where slug = $1 and status = 'active' and provision_state = 'ready'", [slug])).rows[0]);
  return t ? { id: t.id, schema: t.schema_name, name: t.name, currency: t.currency || undefined } : null;
}

/** What this person is in that organization, read from the organization's own database (ADR-014). Null if not an active member. */
export async function membershipIn(driver: Driver, t: ActiveTenant, userId: string): Promise<Membership | null> {
  const r = await withOrgPlatform(driver, t.schema, async (q) =>
    (await q.query<{ role: string; vehicle_scope: "all" | "own" }>(
      "select role, vehicle_scope from public.tenant_memberships where tenant_id = $1 and user_id = $2 and status = 'active'", [t.id, userId])).rows[0]);
  return r ? { tenantId: t.id, schema: t.schema, userId, role: r.role, vehicleScope: r.vehicle_scope, tenantName: t.name, currency: t.currency } : null;
}

/** Who is this user in this workspace? Null if not a member, disabled, or the tenant is not active. */
export async function resolveMembership(driver: Driver, userId: string, slug: string): Promise<Membership | null> {
  const t = await findActiveTenant(driver, slug);
  return t ? membershipIn(driver, t, userId) : null;
}

/** Permission check inside an open tenant transaction. */
export async function can(q: Queryable, role: string, permission: string): Promise<boolean> {
  const r = await q.query("select 1 from role_permissions where role_key = $1 and permission_key = $2", [role, permission]);
  return r.rows.length > 0;
}

export async function assertCan(q: Queryable, role: string, permission: string): Promise<void> {
  if (!(await can(q, role, permission))) throw new ForbiddenError(permission);
}

/** The normal entry for a server action: check the permission, then run the work in the same transaction. */
export async function authorized<T>(driver: Driver, m: Membership, permission: string, fn: (q: Queryable) => Promise<T>): Promise<T> {
  return withTenant(driver, m, async (q) => {
    await assertCan(q, m.role, permission);
    return fn(q);
  });
}

/** Like authorized(), but any one of several permissions is enough. fn learns which ones the role holds. */
export async function authorizedAny<T>(driver: Driver, m: Membership, permissions: string[], fn: (q: Queryable, held: Set<string>) => Promise<T>): Promise<T> {
  return withTenant(driver, m, async (q) => {
    const rows = await q.query<{ permission_key: string }>(
      "select permission_key from role_permissions where role_key = $1 and permission_key = any($2::text[])", [m.role, permissions]);
    if (rows.rows.length === 0) throw new ForbiddenError(permissions.join(" or "));
    return fn(q, new Set(rows.rows.map((r) => r.permission_key)));
  });
}

/** Everything this role may do, for showing or hiding navigation. Hiding is cosmetic; every action still calls can(). */
export async function permissionsOf(driver: Driver, m: Membership): Promise<Set<string>> {
  return withTenant(driver, m, async (q) =>
    new Set((await q.query<{ permission_key: string }>("select permission_key from role_permissions where role_key = $1", [m.role])).rows.map((r) => r.permission_key)));
}

export type WorkspaceLink = { slug: string; name: string; role: string };

/** Workspaces a user can enter, for the post-login redirect and a workspace switcher. */
export async function listWorkspaces(driver: Driver, userId: string): Promise<WorkspaceLink[]> {
  const rows = await withPlatform(driver, async (q) =>
    (await q.query<{ id: string; slug: string; name: string; schema_name: string }>(
      `select t.id, t.slug, t.name, t.schema_name from public.tenants t join public.user_orgs u on u.tenant_id = t.id
        where u.user_id = $1 and t.status = 'active' and t.provision_state = 'ready' order by t.name`, [userId])).rows);
  // The role is read from each organization's own database; one with no active membership is not offered.
  const found = await Promise.all(rows.map(async (t) => {
    const r = await withOrgPlatform(driver, t.schema_name, async (q) =>
      (await q.query<{ role: string }>("select role from public.tenant_memberships where tenant_id = $1 and user_id = $2 and status = 'active'", [t.id, userId])).rows[0]);
    return r ? { slug: t.slug, name: t.name, role: r.role } : null;
  }));
  return found.filter((x): x is WorkspaceLink => x !== null);
}

/** The signed-in person's own name and role, for the corner of the screen. Reads only their own row. */
export async function whoAmI(driver: Driver, m: Membership): Promise<{ name: string; roleName: string }> {
  return withTenant(driver, m, async (q) => {
    const r = (await q.query<{ name: string | null; role_name: string | null }>(
      `select coalesce((select e.full_name from employees e where e.user_id = $1), (select v.name from vendors v where v.user_id = $1)) as name,
              (select r.name from roles r where r.key = $2) as role_name`, [m.userId, m.role])).rows[0];
    return { name: r?.name ?? "Signed in", roleName: r?.role_name ?? m.role };
  });
}
