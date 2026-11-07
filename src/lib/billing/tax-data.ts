// The tax side of billing (ADR-017): the authorities and their rates (the operator's), a customer's own tax details (the
// customer's), the figures an invoice is made with, and the certificates withholding customers owe us. The arithmetic is in
// tax.ts. Nothing here knows a rate: no rule, no registration number, no exchange rate means no tax is charged.
import { z } from "zod";
import type { Driver, Queryable } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";
import { authorized, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";
import { computeTax, type TaxResult } from "./tax";
import { rateFor } from "./fx";
import { resolveScenario } from "./tax-scenarios";
import { BILLING_PERMISSION } from "./payments";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** The seller and the customer as they were on the day, kept with the invoice because invoices never change. */
export type TaxSnapshot = {
  /** "PKR" (tax worked out in rupees at a dated rate) or "USD". Older invoices have none and are rupees. */
  currency?: "PKR" | "USD";
  country?: string | null;
  scenario?: { code: string; label: string; mode: "none" | "authority" | "fixed"; title: string; note: string | null; tax_name: string | null };
  /** The rate used to turn dollars into rupees, where it came from, and for which day. Null when no conversion was needed. */
  fx?: { rate: number; rate_date: string; payment_date: string; source: string; side: string } | null;
  seller: { legal_name: string | null; ntn: string | null; tax_reg: string | null; pseb_no: string | null };
  buyer: { legal_name: string | null; ntn: string | null; strn: string | null; address: string | null; withholding_agent: boolean; authority_code: string; authority: string };
  wht: { income_pct: number; sales_share_pct: number; income_base: "subtotal" | "total" };
};

const SETTING_KEYS = ["pkr_per_usd", "fx_side", "seller_legal_name", "seller_ntn", "seller_tax_reg", "seller_pseb_no", "wht_income_pct_default", "wht_sales_share_pct_default", "wht_income_base"];
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * The figures for a subscription price, or null when nothing is recorded: not a dollar plan, or the customer has no country
 * (as before this existed), or no scenario matches, or a taxed scenario is not fully set up yet (no registration number, no
 * exchange rate, no authority chosen). A scenario that charges no tax gives a result with zero tax, so the invoice can say so.
 * `paymentDate` is the day the customer paid: the exchange rate is the one for that day.
 */
export async function taxFor(q: Queryable, tenantId: string, subtotalUsdCents: number, currency: string, opts: { paymentDate?: string } = {}): Promise<{ result: TaxResult; snapshot: TaxSnapshot } | null> {
  // A plan priced in dollars is converted to rupees at the rate of the payment date; a plan priced in rupees (ADR-052) already is in rupees: the same arithmetic with a rate of 1.
  if (currency !== "USD" && currency !== "PKR") return null;
  const inRupees = currency === "PKR";
  const p = (await q.query<{ country: string | null; legal_name: string | null; ntn: string | null; strn: string | null; address: string | null; withholding_agent: boolean; wht_income_pct: string | null; wht_sales_share_pct: string | null; code: string | null; label: string | null; sales_tax_pct: string | null; chosen: string | null }>(
    `select o.country, o.legal_name, o.ntn, o.strn, o.address, o.withholding_agent, o.wht_income_pct::text, o.wht_sales_share_pct::text, r.code, r.label, r.sales_tax_pct::text, o.tax_rule_code as chosen
       from public.org_tax o left join public.tax_rules r on r.code = o.tax_rule_code and r.active where o.tenant_id = $1`, [tenantId])).rows[0];
  // One authority in force (ADR-053): a customer who has not picked one falls under it. With several, the customer still has to say which.
  if (p && !p.code && !p.chosen) {          // only for a customer who has not picked one: if its own authority was switched off it stays untaxed
    const only = (await q.query<{ code: string; label: string; sales_tax_pct: string }>("select code, label, sales_tax_pct::text from public.tax_rules where active order by code limit 2")).rows;
    if (only.length === 1) { p.code = only[0].code; p.label = only[0].label; p.sales_tax_pct = only[0].sales_tax_pct; }
  }
  const sc = await resolveScenario(q, p?.country);
  if (!p || !sc) return null;
  const st = Object.fromEntries((await q.query<{ key: string; value: string }>("select key, value from public.platform_settings where key = any($1::text[])", [SETTING_KEYS])).rows.map((r) => [r.key, r.value]));
  const side = (["buying", "selling", "average"] as const).find((x) => x === st.fx_side) ?? "buying";
  const paid = opts.paymentDate ?? todayIso();
  const seller = { legal_name: st.seller_legal_name ?? null, ntn: st.seller_ntn ?? null, pseb_no: st.seller_pseb_no ?? null };
  const base = st.wht_income_base === "total" ? "total" : "subtotal";
  const income = p.wht_income_pct ?? st.wht_income_pct_default ?? "0", share = p.wht_sales_share_pct ?? st.wht_sales_share_pct_default ?? "0";
  const meta = { code: sc.code, label: sc.label, mode: sc.sales_tax_mode, title: sc.document_title, note: sc.note, tax_name: sc.tax_name };
  const buyer = { legal_name: p.legal_name, ntn: p.ntn, strn: p.strn, address: p.address, withholding_agent: sc.withholding_allowed && p.withholding_agent };

  let salesTaxPct = 0, rate = 1, fx: TaxSnapshot["fx"] = null, taxReg: string | null = null, authorityCode = sc.code, authority = sc.label;
  if (sc.sales_tax_mode === "authority") {
    taxReg = st.seller_tax_reg ?? null;
    if (!taxReg || !p.code) return null;                                   // the seller is not registered, or the customer has not said where it is
    salesTaxPct = Number(p.sales_tax_pct); authorityCode = p.code; authority = p.label ?? p.code;
  } else if (sc.sales_tax_mode === "fixed") {
    taxReg = sc.seller_registration;
    if (!taxReg) return null;
    salesTaxPct = Number(sc.sales_tax_pct ?? 0); authority = sc.tax_name ?? sc.label;
  }
  if (sc.currency === "PKR" && !inRupees) {
    const dated = await rateFor(q, paid, side);
    const fallback = Number(st.pkr_per_usd);
    if (dated) { rate = dated.rate; fx = { rate, rate_date: dated.date, payment_date: paid, source: dated.source, side }; }
    else if (fallback > 0) { rate = fallback; fx = { rate, rate_date: paid, payment_date: paid, source: "settings", side }; }
    else return null;                                                      // no way to convert: no invoice with rupee amounts
  }
  const result = computeTax({ subtotalUsdCents, pkrPerUsd: rate, salesTaxPct, withholdingAgent: buyer.withholding_agent, whtIncomePct: Number(income), whtSalesSharePct: Number(share), whtIncomeBase: base });
  return {
    result,
    snapshot: { currency: inRupees ? "PKR" : sc.currency, country: p.country, scenario: meta, fx, seller: { ...seller, tax_reg: taxReg }, buyer: { ...buyer, authority_code: authorityCode, authority }, wht: { income_pct: Number(income), sales_share_pct: Number(share), income_base: base } },
  };
}

// ------------------------------------------------------------------------------------------ the operator's rules

export type TaxRule = { code: string; label: string; sales_tax_pct: string; active: boolean };

async function asOperator<T>(driver: Driver, operatorId: string, fn: (q: Queryable) => Promise<T>): Promise<T> {
  return withPlatform(driver, async (q) => {
    if ((await q.query("select 1 from public.platform_admins where user_id = $1", [operatorId])).rows.length === 0) throw new UserError("Not allowed.");
    await q.query("select set_config('app.user_id', $1, true)", [operatorId]);
    return fn(q);
  });
}

export function listTaxRules(driver: Driver, operatorId: string): Promise<TaxRule[]> {
  return asOperator(driver, operatorId, async (q) => (await q.query<TaxRule>("select code, label, sales_tax_pct::text, active from public.tax_rules order by label")).rows);
}

const ruleSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,11}$/, "2 to 12 capital letters or digits, like PRA or SRB"),
  label: z.string().trim().min(2, "Enter a name").max(80),
  sales_tax_pct: z.coerce.number("Enter a percent like 16").min(0, "Not below 0").max(100, "Not above 100").transform((n) => Math.round(n * 100) / 100),
  active: z.boolean(),
});

export async function saveTaxRule(driver: Driver, operatorId: string, input: Record<string, unknown>): Promise<void> {
  const r = ruleSchema.safeParse(input);
  if (!r.success) throw new UserError("Fix the highlighted fields.", fieldErrors(r.error));
  const d = r.data;
  await asOperator(driver, operatorId, (q) => q.query(
    `insert into public.tax_rules(code, label, sales_tax_pct, active, updated_by) values ($1, $2, $3, $4, $5)
     on conflict (code) do update set label = excluded.label, sales_tax_pct = excluded.sales_tax_pct, active = excluded.active, updated_at = now(), updated_by = excluded.updated_by`,
    [d.code, d.label, d.sales_tax_pct, d.active, operatorId]));
}

/** One customer's tax details as the operator sees them, with the authority's name and rate. Null if the customer has given none. */
export function getOrgTax(driver: Driver, operatorId: string, tenantId: string): Promise<(TaxProfile & { authority: string | null; sales_tax_pct: string | null }) | null> {
  return asOperator(driver, operatorId, async (q) => (await q.query<TaxProfile & { authority: string | null; sales_tax_pct: string | null }>(
    `select o.country, o.tax_rule_code, o.legal_name, o.ntn, o.strn, o.address, o.withholding_agent, o.wht_income_pct::text, o.wht_sales_share_pct::text, r.label as authority, r.sales_tax_pct::text
       from public.org_tax o left join public.tax_rules r on r.code = o.tax_rule_code where o.tenant_id = $1`, [tenantId])).rows[0] ?? null);
}

/** The customer chose its own country when it signed up. The operator can correct it: it decides which tax scenario applies. */
export async function setOrgCountry(driver: Driver, operatorId: string, tenantId: string, country: string): Promise<void> {
  const c = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) throw new UserError("Use a two-letter country code, like PK or AE.", { country: "Two-letter code" });
  await asOperator(driver, operatorId, async (q) => {
    if ((await q.query("select 1 from public.tenants where id = $1", [tenantId])).rows.length === 0) throw new UserError("Organization not found.");
    await q.query(
      `insert into public.org_tax(tenant_id, country, updated_by) values ($1, $2, $3) on conflict (tenant_id) do update set country = excluded.country, updated_at = now(), updated_by = excluded.updated_by`, [tenantId, c, operatorId]);
  });
}

/** For one customer whose withholding is not the platform default. Empty clears the override. */
export async function setOrgWithholding(driver: Driver, operatorId: string, tenantId: string, v: { income_pct?: string; sales_share_pct?: string }): Promise<void> {
  const pct = (raw: string | undefined, field: string): number | null => {
    const t = (raw ?? "").trim();
    if (t === "") return null;
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(t) || Number(t) > 100) throw new UserError("Enter a percent from 0 to 100.", { [field]: "Enter a percent from 0 to 100" });
    return Number(t);
  };
  const income = pct(v.income_pct, "income_pct"), share = pct(v.sales_share_pct, "sales_share_pct");
  await asOperator(driver, operatorId, async (q) => {
    const done = await q.query("update public.org_tax set wht_income_pct = $2, wht_sales_share_pct = $3, updated_at = now(), updated_by = $4 where tenant_id = $1 returning tenant_id", [tenantId, income, share, operatorId]);
    if (done.rows.length === 0) throw new UserError("That customer has not given its tax details yet.");
  });
}

// ------------------------------------------------------------------------------------------ the customer's own details

export type TaxProfile = {
  country: string | null; tax_rule_code: string | null; legal_name: string | null; ntn: string | null; strn: string | null; address: string | null; withholding_agent: boolean;
  wht_income_pct: string | null; wht_sales_share_pct: string | null;
};
export type TaxProfileView = { profile: TaxProfile | null; rules: { code: string; label: string; sales_tax_pct: string }[] };

export function getTaxProfile(driver: Driver, m: Membership): Promise<TaxProfileView> {
  return authorized(driver, m, BILLING_PERMISSION, async () => undefined).then(() => withPlatform(driver, async (q) => ({
    profile: (await q.query<TaxProfile>(
      `select country, tax_rule_code, legal_name, ntn, strn, address, withholding_agent, wht_income_pct::text, wht_sales_share_pct::text from public.org_tax where tenant_id = $1`, [m.tenantId])).rows[0] ?? null,
    rules: (await q.query<{ code: string; label: string; sales_tax_pct: string }>("select code, label, sales_tax_pct::text from public.tax_rules where active order by label")).rows,
  })));
}

const profileSchema = z.object({
  country: z.preprocess(blank, z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Choose your country").optional()),
  tax_rule_code: z.preprocess(blank, z.string().regex(/^[A-Z][A-Z0-9_]{1,11}$/, "Choose where you are registered").optional()),
  legal_name: z.preprocess(blank, z.string().trim().max(160).optional()),
  ntn: z.preprocess(blank, z.string().trim().regex(/^[0-9A-Za-z-]{5,20}$/, "Letters, digits and dashes, 5 to 20 characters").optional()),
  strn: z.preprocess(blank, z.string().trim().regex(/^[0-9A-Za-z-]{3,30}$/, "Letters, digits and dashes, 3 to 30 characters").optional()),
  address: z.preprocess(blank, z.string().trim().max(300, "Keep it under 300 characters").optional()),
  withholding_agent: z.boolean(),
});

/** The customer says who it is for the invoice. What it withholds is the operator's to set (setOrgWithholding), not the customer's. */
export async function saveTaxProfile(driver: Driver, m: Membership, input: Record<string, unknown>): Promise<void> {
  await authorized(driver, m, BILLING_PERMISSION, async () => undefined);
  const r = profileSchema.safeParse(input);
  if (!r.success) throw new UserError("Fix the highlighted fields.", fieldErrors(r.error));
  const d = r.data;
  await withPlatform(driver, async (q) => {
    await q.query("select set_config('app.user_id', $1, true)", [m.userId]);
    // An invoice cannot be issued without the customer's registered name and NTN (ADR-053), so they are asked for together. A customer abroad is not asked: its country is the one it
    // gave at sign-up (or this call's), never a default.
    const country = d.country ?? (await q.query<{ country: string | null }>("select country from public.org_tax where tenant_id = $1", [m.tenantId])).rows[0]?.country ?? null;
    if ((d.tax_rule_code || !country || country === "PK") && !(d.legal_name && d.ntn)) {
      throw new UserError("To get your invoice we need your registered company name and your NTN.", { legal_name: d.legal_name ? "" : "Enter your registered name", ntn: d.ntn ? "" : "Enter your NTN" });
    }
    if (d.tax_rule_code && (await q.query("select 1 from public.tax_rules where code = $1 and active", [d.tax_rule_code])).rows.length === 0)
      throw new UserError("Choose where you are registered.", { tax_rule_code: "Choose from the list" });
    await q.query(
      `insert into public.org_tax(tenant_id, country, tax_rule_code, legal_name, ntn, strn, address, withholding_agent, updated_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (tenant_id) do update set country = coalesce(excluded.country, public.org_tax.country), tax_rule_code = excluded.tax_rule_code, legal_name = excluded.legal_name, ntn = excluded.ntn, strn = excluded.strn,
         address = excluded.address, withholding_agent = excluded.withholding_agent, updated_at = now(), updated_by = excluded.updated_by`,
      [m.tenantId, d.country ?? null, d.tax_rule_code ?? null, d.legal_name ?? null, d.ntn ?? null, d.strn ?? null, d.address ?? null, d.withholding_agent, m.userId]);
  });
}

/** What the customer will be asked to pay for some months, before it pays: the same arithmetic the invoice will use. Null when no tax applies. */
export function quoteTax(driver: Driver, m: Membership, priceCents: number, currency: string, months: number): Promise<{ result: TaxResult; snapshot: TaxSnapshot } | null> {
  return authorized(driver, m, BILLING_PERMISSION, async () => undefined).then(() => withPlatform(driver, (q) => taxFor(q, m.tenantId, priceCents * months, currency)));
}

// ------------------------------------------------------------------------------------------ certificates

export type OwedCertificate = { invoice_id: string; number: string; org_name: string; issued_at: string; wht_income_minor: string; wht_sales_minor: string };

/** Invoices where the customer kept back tax and we do not yet hold the certificate for it. Oldest first. */
export function listCertificatesOwed(driver: Driver, operatorId: string): Promise<OwedCertificate[]> {
  return asOperator(driver, operatorId, async (q) =>
    (await q.query<OwedCertificate>(
      `select i.id as invoice_id, i.number, i.billed_to as org_name, i.issued_at::text, i.wht_income_minor::text, coalesce(i.wht_sales_minor, 0)::text as wht_sales_minor
         from public.invoices i left join public.invoice_certificates c on c.invoice_id = i.id
        where c.invoice_id is null and (coalesce(i.wht_income_minor, 0) > 0 or coalesce(i.wht_sales_minor, 0) > 0) order by i.issued_at`)).rows);
}

export async function recordCertificate(driver: Driver, operatorId: string, invoiceId: string, c: { certificate_no: string; received_on: string; note?: string }): Promise<void> {
  const no = c.certificate_no.trim();
  if (no.length < 1 || no.length > 80) throw new UserError("Enter the certificate number.", { certificate_no: "Enter the certificate number" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.received_on) || c.received_on > new Date().toISOString().slice(0, 10)) throw new UserError("Enter the date you received it.", { received_on: "Enter the date you received it" });
  await asOperator(driver, operatorId, async (q) => {
    const inv = (await q.query<{ w: boolean }>("select (coalesce(wht_income_minor, 0) > 0 or coalesce(wht_sales_minor, 0) > 0) as w from public.invoices where id = $1", [invoiceId])).rows[0];
    if (!inv) throw new UserError("Invoice not found.");
    if (!inv.w) throw new UserError("Nothing was withheld on that invoice.");
    await q.query(
      `insert into public.invoice_certificates(invoice_id, certificate_no, received_on, note, recorded_by) values ($1, $2, $3, $4, $5)
       on conflict (invoice_id) do update set certificate_no = excluded.certificate_no, received_on = excluded.received_on, note = excluded.note, recorded_by = excluded.recorded_by`,
      [invoiceId, no, c.received_on, (c.note ?? "").trim().slice(0, 300) || null, operatorId]);
  });
}
