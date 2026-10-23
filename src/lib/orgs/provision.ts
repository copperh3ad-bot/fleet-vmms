// Creating an organization with its own database (ADR-014), as a resumable state machine. Every step can be run again
// safely, and one call does as much as fits in a time budget, so a progress page can keep calling it until the
// organization is ready and no single request runs long.
//
//   creating_database -> migrating_platform -> migrating_tenant -> seeding -> ready
//
// The organization's database gets a complete copy of the system for one customer: the platform tables from db/public
// (with its own one-row `tenants`, memberships, invitations, odometer links, plan) and its tenant_<id> schema.
import type { Driver, Queryable } from "@/lib/db/types";
import { migratePlatform, migrateTenantSchema, type Migration } from "@/lib/db/migrate";
import type { SecretBox } from "@/lib/crypto/secretbox";
import { assertSchemaName } from "@/lib/db/tenant";
import type { DbProvider } from "./db-provider";

type Closable = Driver & { end?(): Promise<void> };

export type ProvisionDeps = {
  /** The control database itself (not the routing driver: a half-built organization must not be routed to). */
  control: Driver;
  provider: DbProvider;
  /** Opens a driver for one organization's database, straight from its connection string. */
  openDb: (url: string) => Closable;
  box: SecretBox;
  platformMigrations: Migration[];
  tenantMigrations: Migration[];
  /** Test helper: PGlite has no pgcrypto. */
  transform?: (sql: string) => string;
  /** Connecting to a database that was just created can take a few seconds. */
  connectRetries?: { tries: number; delayMs: number };
  now?: () => number;
};

/** "shared": the organization's own schema inside the control database (the default). "dedicated": its own database (ADR-014, optional). */
export type OrgKind = "shared" | "dedicated";
export type NewOrganization = { name: string; slug: string; ownerUserId: string; ownerName: string; ownerEmail: string; region?: string; kind?: OrgKind };
export type ProvisionState = "creating_database" | "migrating_platform" | "migrating_tenant" | "seeding" | "ready" | "failed";
export type ProvisionStatus = { tenantId: string; state: ProvisionState; error?: string };

const STEPS: ProvisionState[] = ["creating_database", "migrating_platform", "migrating_tenant", "seeding", "ready"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = { db_kind: OrgKind; id: string; name: string; slug: string; schema_name: string; db_ref: string | null; db_url_enc: string | null; db_region: string | null; provision_state: ProvisionState; provision_owner: { userId: string; name: string; email: string } | null };

/** Registers the organization inside a transaction the caller already has open. Nothing is created at the provider yet. */
export async function insertOrganization(q: Queryable, input: NewOrganization): Promise<{ tenantId: string; schema: string }> {
  await q.query("set local search_path = public");
  const t = (await q.query<{ id: string; schema_name: string }>(
    `insert into public.tenants(name, slug, schema_name, db_kind, provision_state, db_region, provision_owner)
     values ($1, $2, 'tenant_' || replace(gen_random_uuid()::text, '-', ''), $5, 'creating_database', $3, $4::jsonb)
     returning id, schema_name`,
    [input.name, input.slug, input.region ?? null, JSON.stringify({ userId: input.ownerUserId, name: input.ownerName, email: input.ownerEmail }), input.kind ?? "dedicated"])).rows[0];
  return { tenantId: t.id, schema: t.schema_name };
}

/** Registers the organization. Nothing is created at the provider yet; advanceProvisioning does that. */
export async function startOrganization(d: Pick<ProvisionDeps, "control">, input: NewOrganization): Promise<{ tenantId: string; schema: string }> {
  return d.control.transaction((q) => insertOrganization(q, input));
}

async function load(d: ProvisionDeps, tenantId: string): Promise<Row> {
  const r = (await d.control.transaction(async (q) => {
    await q.query("set local search_path = public");
    return (await q.query<Row>(
      "select db_kind, id, name, slug, schema_name, db_ref, db_url_enc, db_region, provision_state, provision_owner from public.tenants where id = $1", [tenantId])).rows[0];
  }));
  if (!r) throw new Error("Organization not found.");
  return r;
}

const setState = (d: ProvisionDeps, id: string, state: ProvisionState, extra: { error?: string | null } = {}) =>
  d.control.transaction(async (q) => {
    await q.query("set local search_path = public");
    await q.query("update public.tenants set provision_state = $2, provision_error = $3 where id = $1", [id, state, extra.error ?? null]);
  });

/** Opens the organization's database and waits until it answers. The connection string is never part of an error. */
async function connect(d: ProvisionDeps, url: string): Promise<Closable> {
  const { tries, delayMs } = d.connectRetries ?? { tries: 8, delayMs: 2000 };
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    let db: Closable | undefined;
    try { db = d.openDb(url); await db.transaction((q) => q.query("select 1")); return db; }
    catch (e) { last = e; await db?.end?.().catch(() => undefined); if (i < tries - 1) await sleep(delayMs); }
  }
  throw new Error(`The organization's database did not answer (${(last as Error)?.message?.replace(/postgres(ql)?:\/\/\S+/g, "[connection]").slice(0, 120) ?? "no detail"}).`);
}

async function withOrgDb<T>(d: ProvisionDeps, row: Row, fn: (db: Closable) => Promise<T>): Promise<T> {
  if (!row.db_url_enc) throw new Error("The organization has no database yet.");
  const db = await connect(d, d.box.decrypt(row.db_url_enc));
  try { return await fn(db); } finally { await db.end?.().catch(() => undefined); }
}


type Owner = { userId: string; name: string; email: string };

/** The last step, the same for both kinds, inside a control-database transaction: index the login, start the trial, mark ready. */
async function finish(q: Queryable, row: Row, owner: Owner): Promise<void> {
  await q.query("set local search_path = public");
  await q.query("insert into public.user_orgs(user_id, tenant_id) values ($1, $2) on conflict do nothing", [owner.userId, row.id]);
  // The trial starts when the organization is ready, not when the form was filled in. The price is the plan's, copied.
  const plan = await q.query(
    `insert into public.org_billing(tenant_id, plan_key, status, trial_ends_at, price_cents, currency)
     select $1, p.key, 'trialing', now() + (p.trial_days || ' days')::interval, p.price_cents, p.currency from public.plans p
      where p.key = 'standard' and p.price_cents is not null
     on conflict (tenant_id) do nothing returning tenant_id`, [row.id]);
  if (plan.rows.length === 0 && (await q.query("select 1 from public.org_billing where tenant_id = $1", [row.id])).rows.length === 0)
    throw new Error("The standard plan has no price set, so a trial cannot start.");
  await q.query("update public.tenants set provision_state = 'ready', provision_error = null, provision_owner = null, provisioned_at = now() where id = $1", [row.id]);
  await q.query("update public.signups set status = 'done', updated_at = now() where tenant_id = $1", [row.id]);   // that address has had its trial
}

/** A shared organization: nothing to create at a provider. Its tables go into its own schema in the control database. */
async function stepShared(d: ProvisionDeps, row: Row): Promise<void> {
  switch (row.provision_state) {
    case "creating_database":
    case "migrating_platform":
      return setState(d, row.id, "migrating_tenant");
    case "migrating_tenant":
      await d.control.transaction((q) => migrateTenantSchema(q, row.schema_name, d.tenantMigrations, { transform: d.transform }));
      return setState(d, row.id, "seeding");
    case "seeding": {
      const owner = row.provision_owner;
      if (!owner) throw new Error("The organization has no owner recorded.");
      await d.control.transaction(async (q) => {
        await q.query(`set local search_path = "${row.schema_name}", public`);
        await q.query(`insert into employees(user_id, full_name, email) select $1::uuid, $2, $3 where not exists (select 1 from employees where user_id = $1::uuid)`, [owner.userId, owner.name, owner.email]);
        await q.query(`insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'tenant_admin') on conflict (user_id, tenant_id) do nothing`, [owner.userId, row.id]);
        await finish(q, row, owner);
      });
      return;
    }
  }
}

async function step(d: ProvisionDeps, row: Row): Promise<void> {
  if (row.db_kind === "shared") return stepShared(d, row);
  switch (row.provision_state) {
    case "creating_database": {
      // Reuse a database already made by an earlier attempt (the provider call succeeded but the next step did not run).
      if (!row.db_ref) {
        const db = await d.provider.create({ name: `fleet-${row.slug}`, region: row.db_region ?? undefined });
        await d.control.transaction(async (q) => {
          await q.query("set local search_path = public");
          await q.query("update public.tenants set db_ref = $2, db_url_enc = $3 where id = $1", [row.id, db.ref, d.box.encrypt(db.url)]);
        });
      }
      return setState(d, row.id, "migrating_platform");
    }
    case "migrating_platform": {
      await withOrgDb(d, row, (db) => db.transaction((q) => migratePlatform(q, d.platformMigrations, { transform: d.transform })));
      return setState(d, row.id, "migrating_tenant");
    }
    case "migrating_tenant": {
      await withOrgDb(d, row, (db) => db.transaction(async (q) => {
        await q.query("set local search_path = public");
        await q.query(
          `insert into public.tenants(id, name, slug, schema_name) values ($1, $2, $3, $4) on conflict (id) do nothing`,
          [row.id, row.name, row.slug, row.schema_name]);
        await migrateTenantSchema(q, row.schema_name, d.tenantMigrations, { transform: d.transform });
      }));
      return setState(d, row.id, "seeding");
    }
    case "seeding": {
      const owner = row.provision_owner;
      if (!owner) throw new Error("The organization has no owner recorded.");
      await withOrgDb(d, row, (db) => db.transaction(async (q) => {
        await q.query("set local search_path = public");
        await q.query(`insert into public.plans(key, name, limits) values ('standard', 'Standard', '{}'::jsonb) on conflict (key) do nothing`);
        await q.query(`insert into public.tenant_subscriptions(tenant_id, plan_id, status)
                       select $1, id, 'active' from public.plans where key = 'standard' on conflict (tenant_id) do nothing`, [row.id]);
        await q.query(`set local search_path = "${row.schema_name}", public`);
        await q.query(`insert into employees(user_id, full_name, email) select $1::uuid, $2, $3 where not exists (select 1 from employees where user_id = $1::uuid)`,
          [owner.userId, owner.name, owner.email]);
        await q.query(`insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'tenant_admin') on conflict (user_id, tenant_id) do nothing`, [owner.userId, row.id]);
      }));
      await d.control.transaction((q) => finish(q, row, owner));
      return;
    }
  }
}

/**
 * Runs steps until the organization is ready, a step fails, or the time budget is spent. A failed step leaves the state
 * where it was, with a short message (no connection strings), so the next call retries the same step.
 */
export async function advanceProvisioning(d: ProvisionDeps, tenantId: string, opts: { budgetMs?: number } = {}): Promise<ProvisionStatus> {
  const now = d.now ?? Date.now;
  const start = now();
  for (;;) {
    const row = await load(d, tenantId);
    if (row.provision_state === "ready" || row.provision_state === "failed") return { tenantId, state: row.provision_state };
    if (now() - start > (opts.budgetMs ?? 20_000)) return { tenantId, state: row.provision_state };
    try {
      await step(d, row);
    } catch (e) {
      const message = ((e as Error).message ?? "Unknown error").replace(/postgres(ql)?:\/\/\S+/g, "[connection]").slice(0, 300);
      await d.control.transaction(async (q) => {
        await q.query("set local search_path = public");
        await q.query("update public.tenants set provision_error = $2 where id = $1", [tenantId, message]);
      });
      return { tenantId, state: row.provision_state, error: message };
    }
  }
}

/**
 * Gives up on an organization that never went live: removes its database at the provider and marks it closed.
 * Refuses anything that has become ready, because that holds a customer's data.
 */
export async function abandonProvisioning(d: ProvisionDeps, tenantId: string): Promise<void> {
  const row = await load(d, tenantId);
  if (row.provision_state === "ready") throw new Error("This organization is live. Use the operator screen to delete it.");
  if (row.db_kind === "shared") {
    const schema = assertSchemaName(row.schema_name);
    await d.control.transaction(async (q) => { await q.query(`drop schema if exists "${schema}" cascade`); });   // only ever a half-built one: it never went live
  }
  if (row.db_ref) await d.provider.destroy(row.db_ref);
  await d.control.transaction(async (q) => {
    await q.query("set local search_path = public");
    await q.query("update public.tenants set status = 'closed', provision_state = 'failed', db_url_enc = null, provision_owner = null where id = $1", [tenantId]);
  });
}

export const PROVISION_STEPS = STEPS;
