// Read-only. Says why "Hi" from one phone number gets no WhatsApp menu, by running the same checks as src/lib/wa-menu/identity.ts one at a time.
// Usage: npx tsx --env-file=.env.local scripts/wa-why-no-menu.mts 0300 1234567
// It writes nothing. Run it on your own machine; it prints names of your own organizations and employees to your own terminal only.
import pg from "pg";

const digits = process.argv.slice(2).join("").replace(/\D/g, "").slice(-10);
if (digits.length < 7) { console.error("Give the phone number, at least 7 digits."); process.exit(1); }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const ok = (b: boolean) => (b ? "OK  " : "FAIL");
try {
  const plans = (await c.query("select key, features from public.plans where key in ('standard','pro')")).rows as { key: string; features: Record<string, unknown> }[];
  const tenants = (await c.query("select id, name, schema_name, status, provision_state, wa_menu_enabled from public.tenants order by created_at")).rows as Record<string, any>[];
  let matched = 0;
  for (const t of tenants) {
    const emps = (await c.query(
      `select full_name, active, user_id is not null as has_login from "${t.schema_name}".employees where right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $1`, [digits])).rows as { full_name: string; active: boolean; has_login: boolean }[];
    if (emps.length === 0) continue;
    matched += emps.length;
    const b = (await c.query("select plan_key, status, pending_plan_key, pending_plan_from::text, pro_trial_ends_at::text from public.org_billing where tenant_id = $1", [t.id])).rows[0] as Record<string, any> | undefined;
    const trial = !!b?.pro_trial_ends_at && new Date(b.pro_trial_ends_at).getTime() > Date.now();
    const pending = b?.pending_plan_key && b?.pending_plan_from && new Date(b.pending_plan_from).getTime() <= Date.now();
    const key = pending ? b!.pending_plan_key : b?.plan_key;
    const feat = (trial ? plans.find((p) => p.key === "pro") : plans.find((p) => p.key === key))?.features ?? {};
    console.log(`\nOrganization: ${t.name}`);
    console.log(`  ${ok(t.status === "active")} organization status = ${t.status}`);
    console.log(`  ${ok(t.provision_state === "ready")} provision_state = ${t.provision_state}`);
    console.log(`  ${ok(t.wa_menu_enabled === true)} WhatsApp menu switched on (wa_menu_enabled) = ${t.wa_menu_enabled}`);
    console.log(`  ${ok(feat.whatsapp_menu === true)} plan "${key}"${trial ? " (Pro trial)" : ""} includes whatsapp_menu = ${feat.whatsapp_menu}`);
    console.log(`  ${ok(b?.status === "active" || b?.status === "trialing")} subscription status = ${b?.status} (must be a live one)`);
    console.log(`  ${ok(emps.length === 1)} people with this number in this organization = ${emps.length} (more than one is never guessed, unless beta testing mode is on)`);
    for (const e of emps) {
      console.log(`  - ${e.full_name}: ${ok(e.active)} active, ${ok(e.has_login)} has a login`);
    }
  }
  if (matched === 0) console.log(`\nFAIL no employee in any organization has a phone ending ${digits}. Add it to the employee's record (any format; only the last 10 digits are compared).`);
} finally {
  await c.end();
}
