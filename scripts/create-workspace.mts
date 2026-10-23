// Usage:
//   DATABASE_URL=... npx tsx scripts/create-workspace.mts --name "Acme Transport" --slug acme \
//     --owner-name "Sara Khan" --owner-email sara@acme.example [--plan small] [--base-url https://app.example.com]
// Creates an empty workspace and an invitation for its first administrator, then prints the invitation link once.
// This is the only way to create a workspace (invite-only): there is no sign-up page.
import { parseArgs } from "node:util";
import { pgDriver } from "../src/lib/db/pg-driver";
import { loadMigrations } from "../src/lib/db/migrate";
import { provisionTenant } from "../src/lib/db/provision";
import { hashInviteToken, newInviteToken, INVITE_DAYS } from "../src/lib/admin/service";
import { indexInvitation, routeToken } from "../src/lib/orgs";

const { values: a } = parseArgs({ options: {
  name: { type: "string" }, slug: { type: "string" }, "owner-name": { type: "string" }, "owner-email": { type: "string" },
  plan: { type: "string" }, "base-url": { type: "string", default: "http://localhost:3000" },
} });
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(2); }
for (const k of ["name", "slug", "owner-name", "owner-email"] as const) if (!a[k]) { console.error(`Missing --${k}`); process.exit(2); }
if (!/^[a-z0-9-]{2,40}$/.test(a.slug!)) { console.error("--slug: 2 to 40 lowercase letters, digits or hyphens"); process.exit(2); }
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a["owner-email"]!)) { console.error("--owner-email does not look like an email address"); process.exit(2); }

const driver = pgDriver(url);
try {
  if (a.plan) {
    const known = await driver.transaction((q) => q.query("select 1 from public.plans where key = $1", [a.plan]));
    if (known.rows.length === 0) { console.error(`Plan "${a.plan}" does not exist. Create it first with scripts/set-plan.mts.`); process.exit(2); }
  }
  const t = await provisionTenant(driver, { name: a.name!, slug: a.slug!, planKey: a.plan }, loadMigrations("db/tenant-template"));
  const token = newInviteToken();
  const inv = await driver.transaction(async (q) => {
    await q.query("set local search_path = public");
    return (await q.query<{ id: string; expires_at: string }>(
      `insert into public.invitations(tenant_id, full_name, email, role_key, invited_by, token_hash, expires_at)
       values ($1, $2, lower($3), 'tenant_admin', '00000000-0000-0000-0000-000000000000', $4, now() + ($5 || ' days')::interval) returning id, expires_at::text`,
      [t.tenantId, a["owner-name"], a["owner-email"], hashInviteToken(token), String(INVITE_DAYS)])).rows[0];
  });
  await routeToken(driver, "invite", t.tenantId, hashInviteToken(token), inv.expires_at);        // so the link opens
  await indexInvitation(driver, t.tenantId, inv.id, a["owner-email"]!, inv.expires_at);
  console.log(`Workspace "${a.name}" created (slug ${a.slug}${a.plan ? `, plan ${a.plan}` : ", no plan, so no limits"}).`);
  console.log(`Send this link to ${a["owner-email"]}. It is shown once, works once and expires in ${INVITE_DAYS} days:\n`);
  console.log(`  ${a["base-url"]!.replace(/\/$/, "")}/invite/${token}\n`);
} catch (e) {
  console.error("Failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally { await driver.end(); }
