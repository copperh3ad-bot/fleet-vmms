// Keeping every organization's own database up to date (ADR-014). Each one runs the platform migrations (db/public) and
// its tenant migrations (db/tenant-template), exactly like a shared organization, in its own transaction, so one broken
// database never blocks or half-changes the others.
import type { Driver } from "@/lib/db/types";
import type { SecretBox } from "@/lib/crypto/secretbox";
import { migratePlatform, migrateTenantSchema, type Migration } from "@/lib/db/migrate";

type Closable = Driver & { end?(): Promise<void> };
export type FleetDeps = {
  control: Driver;
  openDb: (url: string) => Closable;
  box: SecretBox;
  platformMigrations: Migration[];
  tenantMigrations: Migration[];
  transform?: (sql: string) => string;
  /** How many databases to work on at once. */
  concurrency?: number;
};
export type OrgMigrationResult = { slug: string; schema: string; applied: string[]; error?: string };

type Org = { slug: string; schema_name: string; db_url_enc: string };

async function dedicatedOrgs(d: FleetDeps): Promise<Org[]> {
  return d.control.transaction(async (q) => {
    await q.query("set local search_path = public");
    return (await q.query<Org>(
      "select slug, schema_name, db_url_enc from public.tenants where db_kind = 'dedicated' and provision_state = 'ready' and status <> 'closed' and db_url_enc is not null order by created_at")).rows;
  });
}

async function each<T>(items: Org[], n: number, fn: (o: Org) => Promise<T>): Promise<T[]> {
  const out: T[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const clean = (e: unknown) => ((e as Error)?.message ?? "failed").replace(/postgres(ql)?:\/\/\S+/g, "[connection]").slice(0, 300);

/** Applies pending platform and tenant migrations to every ready dedicated organization. */
export async function migrateDedicated(d: FleetDeps): Promise<OrgMigrationResult[]> {
  return each(await dedicatedOrgs(d), d.concurrency ?? 4, async (o) => {
    let db: Closable | undefined;
    try {
      db = d.openDb(d.box.decrypt(o.db_url_enc));
      const applied = await db.transaction(async (q) => [
        ...(await migratePlatform(q, d.platformMigrations, { transform: d.transform })),
        ...(await migrateTenantSchema(q, o.schema_name, d.tenantMigrations, { transform: d.transform })),
      ]);
      return { slug: o.slug, schema: o.schema_name, applied };
    } catch (e) {
      return { slug: o.slug, schema: o.schema_name, applied: [], error: clean(e) };
    } finally { await db?.end?.().catch(() => undefined); }
  });
}

/** Dedicated organizations whose applied migrations differ from the repository, or that cannot be reached. */
export async function driftDedicated(d: FleetDeps): Promise<{ slug: string; reason: string }[]> {
  const sameSet = (want: Migration[], have: Map<string, string>) => want.length === have.size && want.every((m) => have.get(m.name) === m.checksum);
  const rows = await each(await dedicatedOrgs(d), d.concurrency ?? 4, async (o) => {
    let db: Closable | undefined;
    try {
      db = d.openDb(d.box.decrypt(o.db_url_enc));
      return await db.transaction(async (q) => {
        const read = async (sql: string) => new Map((await q.query<{ name: string; checksum: string }>(sql)).rows.map((r) => [r.name, r.checksum]));
        const platform = await read("select name, checksum from public.schema_migrations");
        const tenant = await read(`select name, checksum from "${o.schema_name}".schema_migrations`);
        const bad = [!sameSet(d.platformMigrations, platform) && "platform", !sameSet(d.tenantMigrations, tenant) && "tenant"].filter(Boolean);
        return bad.length ? { slug: o.slug, reason: `${bad.join(" and ")} migrations differ` } : null;
      });
    } catch (e) {
      return { slug: o.slug, reason: `unreachable: ${clean(e)}` };
    } finally { await db?.end?.().catch(() => undefined); }
  });
  return rows.filter((r): r is { slug: string; reason: string } => r !== null);
}
