// Usage: DATABASE_URL=... npx tsx --env-file=.env.local scripts/check-routing.mts
// Read-only check of the sign-in lookups against the real database, through the same routing driver the site uses:
// for every active organization, can its first administrator be resolved, and does the control index list it?
// Writes nothing. Prints names and counts only, never a connection string or a user id.
import { pgDriver } from "../src/lib/db/pg-driver";
import { envSecretBox } from "../src/lib/crypto/secretbox";
import { routingDriver } from "../src/lib/db/router";
import { listWorkspaces, resolveMembership } from "../src/lib/auth/can";
import { withOrgPlatform, withPlatform } from "../src/lib/db/tenant";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(2); }
const router = routingDriver({ control: pgDriver(url), makeDriver: (u) => pgDriver(u, { max: 2 }), decrypt: (b) => envSecretBox().decrypt(b) });
let bad = 0;
try {
  const orgs = await withPlatform(router, async (q) => (await q.query<{ id: string; slug: string; schema_name: string; db_kind: string }>(
    "select id, slug, schema_name, db_kind from public.tenants where status = 'active' order by created_at")).rows);
  for (const o of orgs) {
    const admin = await withOrgPlatform(router, o.schema_name, async (q) => (await q.query<{ user_id: string }>(
      "select user_id from public.tenant_memberships where tenant_id = $1 and status = 'active' order by created_at limit 1", [o.id])).rows[0]);
    if (!admin) { console.log(`${o.slug} (${o.db_kind}): no active member`); continue; }
    const m = await resolveMembership(router, admin.user_id, o.slug);
    const spaces = await listWorkspaces(router, admin.user_id);
    const ok = !!m && spaces.some((s) => s.slug === o.slug);
    if (!ok) bad++;
    console.log(`${o.slug} (${o.db_kind}): sign-in lookup ${m ? "ok" : "FAILED"}, listed in workspaces ${spaces.some((s) => s.slug === o.slug) ? "yes" : "NO"}`);
  }
  const routes = await withPlatform(router, async (q) => (await q.query<{ kind: string; c: number }>("select kind, count(*)::int c from public.link_routes group by kind")).rows);
  console.log(`token routes: ${routes.length ? routes.map((r) => `${r.kind} ${r.c}`).join(", ") : "none open"}`);
  process.exitCode = bad ? 1 : 0;
} finally { await router.end(); }
