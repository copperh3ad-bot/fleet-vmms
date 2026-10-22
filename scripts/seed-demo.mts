// Usage: DATABASE_URL=... npx tsx scripts/seed-demo.mts --slug demo
// Fills an EMPTY workspace with sample data (vehicles, workshops, job cards at every stage, papers, budgets) so the
// system can be shown. Refuses to touch a workspace that already has vehicles. The sample people have no logins.
// Create a separate workspace for it first (scripts/create-workspace.mts); do not use a real customer's.
import { parseArgs } from "node:util";
import { pgDriver } from "../src/lib/db/pg-driver";
import { seedDemo } from "../src/lib/demo/seed";

const { values: a } = parseArgs({ options: { slug: { type: "string" } } });
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(2); }
if (!a.slug) { console.error("Missing --slug"); process.exit(2); }
const driver = pgDriver(url);
try {
  const t = (await driver.transaction((q) => q.query<{ id: string; schema_name: string }>("select id, schema_name from public.tenants where slug = $1 and status = 'active'", [a.slug]))).rows[0];
  if (!t) { console.error(`No active workspace with slug "${a.slug}".`); process.exit(2); }
  const s = await seedDemo(driver, { tenantId: t.id, schema: t.schema_name });
  console.log(`Demo data added to ${a.slug}:`, JSON.stringify(s));
} catch (e) {
  console.error("Failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally { await driver.end(); }
