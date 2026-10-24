// Usage: DATABASE_URL=... npx tsx scripts/rename-org.mts <slug> "<new display name>"
// Changes only the name shown for one organization (public.tenants.name). Its address (slug), data, users and invoices are
// untouched. Prints the row before and after, and changes nothing if the slug is unknown.
import { pgDriver } from "../src/lib/db/pg-driver";

const [slug, name] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(2); }
if (!slug || !name || name.trim().length < 2 || name.length > 120) { console.error('Usage: npx tsx scripts/rename-org.mts <slug> "<new display name>"'); process.exit(2); }
const driver = pgDriver(url);
try {
  const rows = await driver.transaction(async (q) => {
    await q.query("set local search_path = public");
    const before = (await q.query<{ slug: string; name: string }>("select slug, name from public.tenants where slug = $1", [slug])).rows[0];
    if (!before) return null;
    const after = (await q.query<{ slug: string; name: string }>("update public.tenants set name = $2 where slug = $1 returning slug, name", [slug, name.trim()])).rows[0];
    return { before, after };
  });
  console.log(rows ? `renamed: ${rows.before.name} -> ${rows.after.name} (address /w/${rows.after.slug} unchanged)` : `no organization with the address "${slug}"; nothing changed`);
  process.exit(rows ? 0 : 1);
} finally {
  await driver.end();
}
