// Usage:
//   DATABASE_URL=... npx tsx scripts/set-plan.mts --plan small [--name "Small"] [--max-vehicles 25] [--max-users 5] [--tenant acme]
// Creates or updates a plan's limits (use "none" to remove a limit) and, with --tenant, puts that workspace on it.
// Limits only; there are no prices anywhere in the system.
import { parseArgs } from "node:util";
import { pgDriver } from "../src/lib/db/pg-driver";

const { values: a } = parseArgs({ options: {
  plan: { type: "string" }, name: { type: "string" }, "max-vehicles": { type: "string" }, "max-users": { type: "string" }, tenant: { type: "string" },
} });
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(2); }
if (!a.plan || !/^[a-z0-9_-]{2,40}$/.test(a.plan)) { console.error("--plan: 2 to 40 lowercase letters, digits, hyphen or underscore"); process.exit(2); }
const limit = (v: string | undefined, label: string): number | null | undefined => {
  if (v === undefined) return undefined;
  if (v === "none") return null;
  if (!/^[1-9][0-9]{0,6}$/.test(v)) { console.error(`--${label}: a whole number above 0, or "none"`); process.exit(2); }
  return Number(v);
};
const changes: Record<string, number | null | undefined> = { max_vehicles: limit(a["max-vehicles"], "max-vehicles"), max_users: limit(a["max-users"], "max-users") };

const driver = pgDriver(url);
try {
  await driver.transaction(async (q) => {
    await q.query("set local search_path = public");
    const cur = (await q.query<{ limits: Record<string, number> }>("select limits from public.plans where key = $1", [a.plan]));
    const limits: Record<string, number> = { ...(cur.rows[0]?.limits ?? {}) };
    for (const [k, v] of Object.entries(changes)) { if (v === null) delete limits[k]; else if (v !== undefined) limits[k] = v; }
    await q.query(
      `insert into public.plans(key, name, limits) values ($1, $2, $3::jsonb)
       on conflict (key) do update set name = coalesce($4, public.plans.name), limits = excluded.limits`,
      [a.plan, a.name ?? a.plan, JSON.stringify(limits), a.name ?? null]);
    console.log(`Plan ${a.plan}: ${Object.keys(limits).length ? JSON.stringify(limits) : "no limits"}`);
    if (a.tenant) {
      const r = await q.query(
        `insert into public.tenant_subscriptions(tenant_id, plan_id) select t.id, p.id from public.tenants t, public.plans p where t.slug = $1 and p.key = $2
         on conflict (tenant_id) do update set plan_id = excluded.plan_id, status = 'active' returning tenant_id`, [a.tenant, a.plan]);
      if (r.rows.length === 0) throw new Error(`No workspace with slug "${a.tenant}"`);
      console.log(`Workspace ${a.tenant} is now on plan ${a.plan}.`);
    }
  });
} catch (e) {
  console.error("Failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally { await driver.end(); }
