import { PGlite } from "@electric-sql/pglite";
import type { Driver, Queryable } from "@/lib/db/types";
import type { DbProvider } from "@/lib/orgs/db-provider";
import { loadMigrations, migrateControl, migratePlatform } from "@/lib/db/migrate";
import { pgDriver } from "@/lib/db/pg-driver";

export const tenantMigrations = () => loadMigrations("db/tenant-template");
export const platformMigrations = () => loadMigrations("db/public");
export const controlMigrations = () => loadMigrations("db/control");
// PGlite has no pgcrypto; gen_random_uuid() is built in.
export const stripExt = (sql: string) => sql.replace(/create extension if not exists pgcrypto;/g, "");

// With TEST_DATABASE_URL set, the same suite runs against a real Postgres instead of PGlite.
export async function testDriver(): Promise<Driver & { db?: PGlite }> {
  if (process.env.TEST_DATABASE_URL) {
    const real = pgDriver(process.env.TEST_DATABASE_URL);
    await real.transaction(async (q) => {
      const s = await q.query<{ schema_name: string }>("select schema_name from information_schema.schemata where schema_name like 'tenant\\_%'");
      for (const r of s.rows) await q.query(`drop schema "${r.schema_name}" cascade`);
      await q.query("drop schema public cascade; create schema public;");
    });
    await real.transaction((q) => migratePlatform(q, platformMigrations(), { transform: stripExt }));
    await real.transaction((q) => migrateControl(q, controlMigrations(), { transform: stripExt }));
    return real;
  }
  const db = new PGlite();
  const driver = {
    db,
    transaction: <T,>(fn: (q: Queryable) => Promise<T>) =>
      db.transaction((tx) => fn({
      // Like node-pg, a call without params may hold several statements (migration files do).
      query: async (sql, params) => {
        if (params) return tx.query(sql, params as unknown[]) as never;
        const res = await tx.exec(sql);
        return { rows: (res[res.length - 1]?.rows ?? []) as never[] };
      },
    })),
  };
  await driver.transaction((q) => migratePlatform(q, platformMigrations(), { transform: stripExt }));
  await driver.transaction((q) => migrateControl(q, controlMigrations(), { transform: stripExt }));   // the test database plays the control plane too
  return driver;
}

/** A plain PGlite database with nothing applied, wrapped as a driver. */
export function newPglite(): Driver & { db: PGlite } {
  const db = new PGlite();
  return {
    db,
    transaction: <T,>(fn: (q: Queryable) => Promise<T>) =>
      db.transaction((tx) => fn({
        query: async (sql, params) => {
          if (params) return tx.query(sql, params as unknown[]) as never;
          const res = await tx.exec(sql);
          return { rows: (res[res.length - 1]?.rows ?? []) as never[] };
        },
      })),
  };
}

/** A control database for the multi-database tests: platform tables plus control tables, on PGlite. */
export async function newControl(): Promise<Driver & { db: PGlite }> {
  const d = newPglite();
  await d.transaction((q) => migratePlatform(q, platformMigrations(), { transform: stripExt }));
  await d.transaction((q) => migrateControl(q, controlMigrations(), { transform: stripExt }));
  return d;
}

// A registry of in-memory databases standing in for separate servers.
export function farm() {
  const dbs = new Map<string, Driver & { db: ReturnType<typeof newPglite>["db"] }>();
  let n = 0;
  const open = (url: string) => {
    const d = dbs.get(url);
    if (!d) throw new Error(`connection refused: ${url}`);
    return { transaction: d.transaction.bind(d), end: async () => undefined };
  };
  const provider = (): DbProvider & { created: number; destroyed: string[] } => ({
    name: "fake", created: 0, destroyed: [],
    async create() { this.created++; const url = `postgresql://user:hidden@host${++n}/db`; dbs.set(url, newPglite()); return { ref: `fake-${n}`, url }; },
    async destroy(ref) { this.destroyed.push(ref); },
  });
  return { dbs, open, provider };
}

