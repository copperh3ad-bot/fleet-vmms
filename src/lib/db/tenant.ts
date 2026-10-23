// THE database door. No other module sets search_path or opens a connection (see CLAUDE.md rule 1).
import type { Driver, Queryable } from "./types";

export type TenantContext = {
  schema: string;   // tenant_<id>, comes from public.tenants, never from user input
  userId: string;   // auth user id, recorded in the audit log
  role: string;     // role key inside the tenant
};

const SCHEMA_RE = /^tenant_[a-z0-9_]{1,50}$/;

export function assertSchemaName(schema: string): string {
  if (!SCHEMA_RE.test(schema)) throw new Error(`invalid tenant schema name: ${schema}`);
  return schema;
}

/**
 * One request = one transaction scoped to one tenant. SET LOCAL means nothing leaks to the next user of the connection.
 * The schema also tells the routing driver which database the organization lives in (ADR-014).
 */
export async function withTenant<T>(driver: Driver, ctx: TenantContext, fn: (q: Queryable) => Promise<T>): Promise<T> {
  const schema = assertSchemaName(ctx.schema);
  return driver.transaction(async (q) => {
    await q.query(`set local search_path = "${schema}", public`);
    await q.query(`select set_config('app.user_id', $1, true), set_config('app.role', $2, true)`, [ctx.userId, ctx.role]);
    return fn(q);
  }, { schema });
}

/**
 * The unauthenticated odometer link (ADR-006). Same schema rule as withTenant, but the context has no user and runs
 * as the database role odometer_link, which can do nothing except call link_submission_info and
 * submit_odometer_via_link. Anything else fails with "permission denied", whatever the calling code tries.
 */
export async function withLinkContext<T>(driver: Driver, schema: string, fn: (q: Queryable) => Promise<T>): Promise<T> {
  const name = assertSchemaName(schema);
  return driver.transaction(async (q) => {
    await q.query(`set local search_path = "${name}", public`);
    await q.query(`select set_config('app.user_id', '', true), set_config('app.role', 'odometer_link', true)`);
    // A real database role (migration 0011): no table access, EXECUTE on two functions only. Lasts until the transaction ends.
    await q.query(`set local role odometer_link`);
    return fn(q);
  }, { schema: name });
}

/** Control tables only (organization registry, billing, sign-ups, routes). No organization data is visible here. */
export async function withPlatform<T>(driver: Driver, fn: (q: Queryable) => Promise<T>): Promise<T> {
  return driver.transaction(async (q) => {
    await q.query(`set local search_path = public`);
    return fn(q);
  });
}

/**
 * One organization's own copy of the platform tables (its memberships, invitations, odometer links, plan), with none of
 * its business data in the search path. For a shared organization this is the same database as the control plane.
 */
export async function withOrgPlatform<T>(driver: Driver, schema: string, fn: (q: Queryable) => Promise<T>): Promise<T> {
  const name = assertSchemaName(schema);
  return driver.transaction(async (q) => {
    await q.query(`set local search_path = public`);
    return fn(q);
  }, { schema: name });
}
