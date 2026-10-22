// Every server action calls this before touching data (CLAUDE.md rule 3).
import type { Driver, Queryable } from "@/lib/db/types";
import { withPlatform, withTenant, type TenantContext } from "@/lib/db/tenant";

export class ForbiddenError extends Error {
  constructor(public permission: string) { super(`forbidden: ${permission}`); }
}

export type Membership = TenantContext & { tenantId: string; vehicleScope: "all" | "own" };

/** Who is this user in this workspace? Null if not a member, disabled, or the tenant is not active. */
export async function resolveMembership(driver: Driver, userId: string, slug: string): Promise<Membership | null> {
  return withPlatform(driver, async (q) => {
    const r = (await q.query<{ tenant_id: string; schema_name: string; role: string; vehicle_scope: "all" | "own" }>(
      `select t.id as tenant_id, t.schema_name, m.role, m.vehicle_scope
         from public.tenants t join public.tenant_memberships m on m.tenant_id = t.id
        where t.slug = $1 and m.user_id = $2 and m.status = 'active' and t.status = 'active'`, [slug, userId])).rows[0];
    return r ? { tenantId: r.tenant_id, schema: r.schema_name, userId, role: r.role, vehicleScope: r.vehicle_scope } : null;
  });
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

/** Everything this role may do, for showing or hiding navigation. Hiding is cosmetic; every action still calls can(). */
export async function permissionsOf(driver: Driver, m: Membership): Promise<Set<string>> {
  return withTenant(driver, m, async (q) =>
    new Set((await q.query<{ permission_key: string }>("select permission_key from role_permissions where role_key = $1", [m.role])).rows.map((r) => r.permission_key)));
}

export type WorkspaceLink = { slug: string; name: string; role: string };

/** Workspaces a user can enter, for the post-login redirect and a workspace switcher. */
export async function listWorkspaces(driver: Driver, userId: string): Promise<WorkspaceLink[]> {
  return withPlatform(driver, async (q) =>
    (await q.query<WorkspaceLink>(
      `select t.slug, t.name, m.role from public.tenants t join public.tenant_memberships m on m.tenant_id = t.id
        where m.user_id = $1 and m.status = 'active' and t.status = 'active' order by t.name`, [userId])).rows);
}
