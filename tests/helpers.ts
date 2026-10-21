import { PGlite } from "@electric-sql/pglite";
import type { Driver, Queryable } from "@/lib/db/types";
import { loadMigrations, migratePlatform } from "@/lib/db/migrate";
import { pgDriver } from "@/lib/db/pg-driver";

export const tenantMigrations = () => loadMigrations("db/tenant-template");
export const platformMigrations = () => loadMigrations("db/public");
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
  return driver;
}
