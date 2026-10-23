import type { Driver } from "./types";
import { migrateTenantSchema, type Migration, type RunOptions } from "./migrate";

export type ProvisionInput = {
  name: string;
  slug: string;
  /** Leave out both to create an empty workspace; the first administrator then joins through an invitation. */
  ownerUserId?: string;
  ownerName?: string;
  ownerEmail?: string;
  planKey?: string;
};

/**
 * Creates a tenant: row, schema, all migrations, and (if given) the owner's employee record and membership.
 * One transaction. If anything fails, nothing exists afterwards.
 */
export async function provisionTenant(driver: Driver, input: ProvisionInput, migrations: Migration[], opts: RunOptions = {}) {
  return driver.transaction(async (q) => {
    await q.query("set local search_path = public");
    const t = (await q.query<{ id: string }>(
      `insert into public.tenants(name, slug, schema_name) values ($1, $2, 'tenant_' || replace(gen_random_uuid()::text, '-', '')) returning id, schema_name`,
      [input.name, input.slug])).rows[0] as unknown as { id: string; schema_name: string };
    await migrateTenantSchema(q, t.schema_name, migrations, opts);
    // An organization made by the operator's script is not on a trial: it is not billed until the operator says so.
    await q.query("insert into public.org_billing(tenant_id, plan_key, status, price_cents, currency, comped) values ($1, 'legacy', 'active', 0, 'USD', true) on conflict do nothing", [t.id]);
    if (input.planKey) {
      await q.query(`insert into public.tenant_subscriptions(tenant_id, plan_id, status)
                     select $1, id, 'active' from public.plans where key = $2`, [t.id, input.planKey]);
    }
    if (input.ownerUserId) {
      await q.query(`set local search_path = "${t.schema_name}", public`);
      await q.query("insert into employees(user_id, full_name, email) values ($1,$2,$3)", [input.ownerUserId, input.ownerName ?? "Owner", input.ownerEmail ?? null]);
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1,$2,'tenant_admin')", [input.ownerUserId, t.id]);
      await q.query("insert into public.user_orgs(user_id, tenant_id) values ($1,$2) on conflict do nothing", [input.ownerUserId, t.id]);
    }
    return { tenantId: t.id, schema: t.schema_name };
  });
}
