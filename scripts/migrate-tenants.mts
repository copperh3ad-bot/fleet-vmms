// Usage: DATABASE_URL=... npx tsx scripts/migrate-tenants.mts [--check]
// Applies pending platform and tenant migrations. With --check, only reports drift and exits 1 if any.
import { pgDriver } from "../src/lib/db/pg-driver";
import { loadMigrations, migratePlatform, migrateAllTenants, findDrift } from "../src/lib/db/migrate";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(2); }
const driver = pgDriver(url);
const tenant = loadMigrations("db/tenant-template");
try {
  if (process.argv.includes("--check")) {
    const drift = await findDrift(driver, tenant);
    console.log(drift.length ? `drift: ${drift.join(", ")}` : "no drift");
    process.exitCode = drift.length ? 1 : 0;
  } else {
    const p = await driver.transaction((q) => migratePlatform(q, loadMigrations("db/public")));
    console.log(`platform: ${p.length ? p.join(", ") : "up to date"}`);
    for (const r of await migrateAllTenants(driver, tenant)) {
      console.log(`${r.schema}: ${r.error ? "FAILED " + r.error : r.applied.length ? r.applied.join(", ") : "up to date"}`);
      if (r.error) process.exitCode = 1;
    }
  }
} finally { await driver.end(); }
