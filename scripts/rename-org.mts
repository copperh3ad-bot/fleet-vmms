// Usage: DATABASE_URL=... npx tsx scripts/rename-org.mts <slug> "<new display name>" [<new slug>]
// Changes the name shown for one organization (public.tenants.name) and, if a third argument is given, its address
// (public.tenants.slug, so /w/<slug>). Its data, users and invoices are untouched: everything else refers to it by id.
// Prints the row before and after, and changes nothing if the slug is unknown or the new one is taken or malformed.
// After a slug change the old address stops working, so anyone with it bookmarked must use the new one.
import { pgDriver } from "../src/lib/db/pg-driver";

const [slug, name, newSlug] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(2); }
const usage = 'Usage: npx tsx scripts/rename-org.mts <slug> "<new display name>" [<new slug>]';
if (!slug || !name || name.trim().length < 2 || name.length > 120) { console.error(usage); process.exit(2); }
if (newSlug !== undefined && !/^[a-z0-9-]{2,40}$/.test(newSlug)) { console.error("The new address may use only a-z, 0-9 and hyphens, 2 to 40 characters."); process.exit(2); }
const driver = pgDriver(url);
try {
  const result = await driver.transaction(async (q) => {
    await q.query("set local search_path = public");
    const before = (await q.query<{ slug: string; name: string }>("select slug, name from public.tenants where slug = $1", [slug])).rows[0];
    if (!before) return { error: `no organization with the address "${slug}"; nothing changed` };
    const target = newSlug ?? slug;
    if (target !== slug && (await q.query("select 1 from public.tenants where slug = $1", [target])).rows.length) return { error: `the address "${target}" is already used; nothing changed` };
    const after = (await q.query<{ slug: string; name: string }>("update public.tenants set name = $3, slug = $2 where slug = $1 returning slug, name", [slug, target, name.trim()])).rows[0];
    return { before, after };
  });
  if ("error" in result) { console.log(result.error); process.exit(1); }
  console.log(`renamed: ${result.before.name} -> ${result.after.name}; address /w/${result.before.slug} -> /w/${result.after.slug}`);
} finally {
  await driver.end();
}
