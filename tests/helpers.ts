import { PGlite } from "@electric-sql/pglite";
import type { Driver, Queryable } from "@/lib/db/types";
import { loadMigrations, migratePlatform } from "@/lib/db/migrate";

export const tenantMigrations = () => loadMigrations("db/tenant-template");
export const platformMigrations = () => loadMigrations("db/public");
// PGlite has no pgcrypto; gen_random_uuid() is built in.
export const stripExt = (sql: string) => sql.replace(/create extension if not exists pgcrypto;/g, "");

export async function testDriver(): Promise<Driver & { db: PGlite }> {
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
