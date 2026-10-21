// Migration runner for the platform schema and for every tenant schema. Called by scripts and by provisioning.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Driver, Queryable } from "./types";
import { assertSchemaName } from "./tenant";

export type Migration = { name: string; sql: string; checksum: string };
export type RunOptions = { transform?: (sql: string) => string };

export function loadMigrations(dir: string): Migration[] {
  return readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort().map((name) => {
    const sql = readFileSync(join(dir, name), "utf8");
    return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  });
}

const versionOf = (name: string) => parseInt(name.slice(0, 4), 10);

async function applyPending(q: Queryable, migrations: Migration[], opts: RunOptions): Promise<string[]> {
  await q.query(`create table if not exists schema_migrations (
    name text primary key, checksum text not null, applied_at timestamptz not null default now())`);
  const done = new Map((await q.query<{ name: string; checksum: string }>("select name, checksum from schema_migrations")).rows
    .map((r) => [r.name, r.checksum]));
  const applied: string[] = [];
  for (const m of migrations) {
    const prev = done.get(m.name);
    if (prev) {
      if (prev !== m.checksum) throw new Error(`migration ${m.name} was edited after it was applied. Add a new migration instead.`);
      continue;
    }
    await q.query(opts.transform ? opts.transform(m.sql) : m.sql);
    await q.query("insert into schema_migrations(name, checksum) values ($1,$2)", [m.name, m.checksum]);
    applied.push(m.name);
  }
  return applied;
}

/** Platform schema (public). */
export async function migratePlatform(q: Queryable, migrations: Migration[], opts: RunOptions = {}) {
  await q.query("set local search_path = public");
  return applyPending(q, migrations, opts);
}

/** One tenant schema. Safe to call repeatedly. Updates tenants.schema_version. */
export async function migrateTenantSchema(q: Queryable, schema: string, migrations: Migration[], opts: RunOptions = {}) {
  assertSchemaName(schema);
  await q.query(`create schema if not exists "${schema}"`);
  await q.query(`set local search_path = "${schema}", public`);
  const applied = await applyPending(q, migrations, opts);
  const latest = migrations.length ? versionOf(migrations[migrations.length - 1].name) : 0;
  await q.query("update public.tenants set schema_version = $1 where schema_name = $2", [latest, schema]);
  return applied;
}

export type TenantMigrationResult = { schema: string; applied: string[]; error?: string };

/** Every tenant in its own transaction, so one broken tenant does not block or half-apply the others. */
export async function migrateAllTenants(driver: Driver, migrations: Migration[], opts: RunOptions = {}): Promise<TenantMigrationResult[]> {
  const schemas = await driver.transaction(async (q) =>
    (await q.query<{ schema_name: string }>("select schema_name from public.tenants where status <> 'closed' order by created_at")).rows.map((r) => r.schema_name));
  const out: TenantMigrationResult[] = [];
  for (const schema of schemas) {
    try {
      out.push({ schema, applied: await driver.transaction((q) => migrateTenantSchema(q, schema, migrations, opts)) });
    } catch (e) {
      out.push({ schema, applied: [], error: (e as Error).message });
    }
  }
  return out;
}

/** Tenants whose applied set differs from the template. Empty means no drift. */
export async function findDrift(driver: Driver, migrations: Migration[]): Promise<string[]> {
  const want = new Map(migrations.map((m) => [m.name, m.checksum]));
  return driver.transaction(async (q) => {
    const schemas = (await q.query<{ schema_name: string }>("select schema_name from public.tenants where status <> 'closed'")).rows;
    const drift: string[] = [];
    for (const { schema_name } of schemas) {
      assertSchemaName(schema_name);
      const rows = (await q.query<{ name: string; checksum: string }>(`select name, checksum from "${schema_name}".schema_migrations`)).rows;
      const have = new Map(rows.map((r) => [r.name, r.checksum]));
      const same = want.size === have.size && [...want].every(([n, c]) => have.get(n) === c);
      if (!same) drift.push(schema_name);
    }
    return drift;
  });
}
