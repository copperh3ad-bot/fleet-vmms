// Usage: DATABASE_URL=... npx tsx --env-file=.env.local scripts/make-operator.mts --email you@example.com [--remove]
// Makes an existing login an operator: someone who can use /admin (organizations, payments, billing settings). The person
// must already have signed up and confirmed their email. Prints only whether it worked.
import { parseArgs } from "node:util";
import { pgDriver } from "../src/lib/db/pg-driver";

const { values: a } = parseArgs({ options: { email: { type: "string" }, remove: { type: "boolean", default: false } } });
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(2); }
if (!a.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) { console.error("Missing or invalid --email"); process.exit(2); }
const driver = pgDriver(url);
try {
  const found = await driver.transaction(async (q) => {
    await q.query("set local search_path = public");
    const u = (await q.query<{ id: string; confirmed: boolean }>("select id, (email_confirmed_at is not null) as confirmed from auth.users where lower(email) = lower($1)", [a.email])).rows[0];
    if (!u) return "no such login";
    if (a.remove) { await q.query("delete from public.platform_admins where user_id = $1", [u.id]); return "removed"; }
    if (!u.confirmed) return "that email is not confirmed yet";
    await q.query("insert into public.platform_admins(user_id) values ($1) on conflict do nothing", [u.id]);
    return "ok";
  });
  console.log(found === "ok" ? `${a.email} is an operator now.` : found === "removed" ? `${a.email} is no longer an operator.` : `Not done: ${found}.`);
  process.exitCode = found === "ok" || found === "removed" ? 0 : 1;
} finally { await driver.end(); }
