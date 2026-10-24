// Usage: npx tsx --env-file=.env.local scripts/audit-system.mts
// A read-only health check of the live database. It changes nothing and prints no secret, no connection string and no customer data
// (only counts and names of tables, functions and settings). Exit code 1 if any check fails.
import { pgDriver } from "../src/lib/db/pg-driver";
import { withPlatform } from "../src/lib/db/tenant";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(2); }
const driver = pgDriver(url);
let failed = 0;
const line = (ok: boolean, what: string, detail = "") => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`); };

try {
  await withPlatform(driver, async (q) => {
    const one = async <T,>(sql: string) => (await q.query<T>(sql)).rows;

    // ---- access
    const noRls = await one<{ t: string }>("select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity");
    line(noRls.length === 0, "every table in the public schema has row security on", noRls.map((r) => r.t).join(", "));
    const grants = await one<{ t: string; r: string }>("select table_name as t, grantee as r from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated') limit 20");
    line(grants.length === 0, "the public API roles hold no table privileges", grants.map((g) => `${g.r}:${g.t}`).join(", "));
    const definer = await one<{ n: string }>("select p.proname as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')");
    line(definer.length === 0, "no elevated-rights function in public runs with a changeable search path", definer.map((d) => d.n).join(", "));
    const callable = await one<{ n: string }>("select p.proname as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.prosecdef and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))");
    line(callable.length === 0, "no elevated-rights function can be called through the public API", callable.map((d) => d.n).join(", "));

    // ---- organizations
    const notReady = await one<{ c: number }>("select count(*)::int as c from public.tenants where status = 'active' and provision_state <> 'ready'");
    line(notReady[0].c === 0, "every active organization is fully set up", `${notReady[0].c} are not`);
    const missing = await one<{ s: string }>("select t.schema_name as s from public.tenants t where t.db_kind = 'shared' and t.status = 'active' and not exists (select 1 from information_schema.schemata x where x.schema_name = t.schema_name)");
    line(missing.length === 0, "every shared organization has its schema", missing.map((m) => m.s).join(", "));
    const noBilling = await one<{ c: number }>("select count(*)::int as c from public.tenants t where status = 'active' and not exists (select 1 from public.org_billing b where b.tenant_id = t.id)");
    line(noBilling[0].c === 0, "every active organization has a billing record", `${noBilling[0].c} lack one`);
    const orphan = await one<{ c: number }>("select count(*)::int as c from public.tenant_memberships m where m.status = 'active' and not exists (select 1 from public.user_orgs u where u.user_id = m.user_id and u.tenant_id = m.tenant_id)");
    line(orphan[0].c === 0, "every active member is findable at sign-in (listed in user_orgs)", `${orphan[0].c} are not`);
    const dupCode = await one<{ c: number }>("select count(*)::int as c from (select join_code from public.tenants where join_code is not null group by 1 having count(*) > 1) x");
    line(dupCode[0].c === 0, "no two organizations share a company code");

    // ---- money
    const unposted = await one<{ c: number }>("select count(*)::int as c from public.invoices i where not exists (select 1 from public.acct_journals j where j.source_kind = 'invoice' and j.source_id = i.id)");
    line(unposted[0].c === 0, "every invoice has its ledger entry", `${unposted[0].c} do not (the Accounting page can post them)`);
    const unbalanced = await one<{ currency: string; d: string }>("select j.currency, (sum(l.debit_minor) - sum(l.credit_minor))::text as d from public.acct_lines l join public.acct_journals j on j.id = l.journal_id group by j.currency having sum(l.debit_minor) <> sum(l.credit_minor)");
    line(unbalanced.length === 0, "the ledger balances in every currency", unbalanced.map((u) => `${u.currency} off by ${u.d}`).join(", "));
    const certGap = await one<{ c: number }>("select count(*)::int as c from public.wht_certificates w where w.status = 'issued' and not exists (select 1 from public.invoice_certificates c where c.invoice_id = w.invoice_id and c.certificate_no = w.number)");
    line(certGap[0].c === 0, "every issued withholding certificate is recorded on its invoice");
    const noSnap = await one<{ c: number }>("select count(*)::int as c from public.invoices where tax_snapshot is not null and (total_minor is null or subtotal_minor is null)");
    line(noSnap[0].c === 0, "every taxed invoice has its figures");
    const scen = await one<{ c: number }>("select count(*)::int as c from public.tax_scenarios where active and countries is null");
    line(scen[0].c >= 1, "there is an active scenario for every country not named elsewhere", "");
    const roles = await one<{ n: string }>("select system_key as n from public.acct_accounts where system_key is not null and active");
    line(roles.length === 6, "the ledger has an active account for each of its six roles", `${roles.length} of 6`);

    // ---- settings that must be in place before real customers
    const set = Object.fromEntries((await one<{ key: string; value: string }>("select key, value from public.platform_settings")).map((r) => [r.key, r.value]));
    for (const [k, why] of [["bank_details", "customers cannot see where to pay"], ["seller_legal_name", "invoices have no seller name"], ["seller_ntn", "invoices have no seller NTN"], ["seller_tax_reg", "no sales tax can be charged"], ["pkr_per_usd", "no fallback exchange rate"], ["support_email", "customers have no billing contact"]] as const)
      console.log(`${set[k] ? "set " : "EMPTY"} ${k}${set[k] ? "" : `: ${why}`}`);
    const rules = await one<{ c: number }>("select count(*)::int as c from public.tax_rules where active");
    console.log(`${rules[0].c ? "set " : "EMPTY"} tax authorities switched on: ${rules[0].c}`);
    const rate = await one<{ d: string }>("select max(rate_date)::text as d from public.fx_rates");
    console.log(`${rate[0].d ? "set " : "EMPTY"} latest stored exchange rate: ${rate[0].d ?? "none"}`);
    console.log(`${set.fx_forexpk_consent ? "ON  " : "off "} automatic forex.pk rate (needs written consent on record)`);
  });
} finally { await driver.end(); }
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
