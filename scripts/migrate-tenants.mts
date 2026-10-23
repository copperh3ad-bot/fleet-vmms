// Usage: DATABASE_URL=... [ORG_DB_KEY=...] npx tsx scripts/migrate-tenants.mts [--check]
// Brings every database up to date: the control database (platform and control migrations, and the shared
// organizations' schemas), then each organization's own database (ADR-014). With --check, only reports drift and
// exits 1 if any. ORG_DB_KEY is needed only when organizations have their own databases.
import { pgDriver } from "../src/lib/db/pg-driver";
import { envSecretBox } from "../src/lib/crypto/secretbox";
import { loadMigrations, migrateAllTenants, migrateControl, migratePlatform, findDrift } from "../src/lib/db/migrate";
import { driftDedicated, migrateDedicated, type FleetDeps } from "../src/lib/orgs/fleet";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(2); }
const driver = pgDriver(url);
const platform = loadMigrations("db/public"), control = loadMigrations("db/control"), tenant = loadMigrations("db/tenant-template");
try {
  const count = await driver.transaction(async (q) => {
    await q.query("set local search_path = public");
    const has = (await q.query<{ ok: boolean }>("select to_regclass('public.control_schema_migrations') is not null as ok")).rows[0].ok;
    return has ? (await q.query<{ c: number }>("select count(*)::int c from public.tenants where db_kind = 'dedicated' and status <> 'closed'")).rows[0].c : 0;
  });
  const fleet = (): FleetDeps => ({ control: driver, openDb: (u) => pgDriver(u, { max: 2 }), box: envSecretBox(), platformMigrations: platform, tenantMigrations: tenant });
  if (process.argv.includes("--check")) {
    const drift = await findDrift(driver, tenant).catch(() => ["control database (control migrations not applied yet?)"]);
    const dedicated = count ? await driftDedicated(fleet()) : [];
    console.log(drift.length ? `drift: ${drift.join(", ")}` : "shared: no drift");
    console.log(dedicated.length ? `dedicated: ${dedicated.map((d) => `${d.slug} (${d.reason})`).join(", ")}` : `dedicated: no drift (${count} organization${count === 1 ? "" : "s"})`);
    process.exitCode = drift.length || dedicated.length ? 1 : 0;
  } else {
    const p = await driver.transaction((q) => migratePlatform(q, platform));
    console.log(`platform: ${p.length ? p.join(", ") : "up to date"}`);
    const c = await driver.transaction((q) => migrateControl(q, control));
    console.log(`control: ${c.length ? c.join(", ") : "up to date"}`);
    for (const r of await migrateAllTenants(driver, tenant)) {
      console.log(`${r.schema}: ${r.error ? "FAILED " + r.error : r.applied.length ? r.applied.join(", ") : "up to date"}`);
      if (r.error) process.exitCode = 1;
    }
    if (count) for (const r of await migrateDedicated(fleet())) {
      console.log(`${r.slug} (own database): ${r.error ? "FAILED " + r.error : r.applied.length ? r.applied.join(", ") : "up to date"}`);
      if (r.error) process.exitCode = 1;
    }
  }
} finally { await driver.end(); }
