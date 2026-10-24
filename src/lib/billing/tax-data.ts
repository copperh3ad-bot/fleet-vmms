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
import { BILLING_PERMISSION } from "./payments";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** The seller and the customer as they were on the day, kept with the invoice because invoices never change. */
export type TaxSnapshot = {
  seller: { legal_name: string | null; ntn: string | null; tax_reg: string; pseb_no: string | null };
  buyer: { legal_name: string | null; ntn: string | null; strn: string | null; address: string | null; withholding_agent: boolean; authority_code: string; authority: string };
  wht: { income_pct: number; sales_share_pct: number; income_base: "subtotal" | "total" };
};

const SETTING_KEYS = ["pkr_per_usd", "seller_legal_name", "seller_ntn", "seller_tax_reg", "seller_pseb_no", "wht_income_pct_default", "wht_sales_share_pct_default", "wht_income_base"];

/**
 * The figures for a subscription price, or null when no tax applies: not in dollars, no exchange rate, the seller has no sales tax
 * registration, or the customer has not said which authority it falls under (or that authority is switched off).
 */
export async function taxFor(q: Queryable, tenantId: string, subtotalUsdCents: number, currency: string): Promise<{ result: TaxResult; snapshot: TaxSnapshot } | null> {
  if (currency !== "USD") return null;
  const st = Object.fromEntries((await q.query<{ key: string; value: string }>("select key, value from public.platform_settings where key = any($1::text[])", [SETTING_KEYS])).rows.map((r) => [r.key, r.value]));
  const rate = Number(st.pkr_per_usd);
  if (!(rate > 0) || !st.seller_tax_reg) return null;
  const p = (await q.query<{ legal_name: string | null; ntn: string | null; strn: string | null; address: string | null; withholding_agent: boolean; wht_income_pct: string | null; wht_sales_share_pct: string | null; code: string; label: string; sales_tax_pct: string }>(
    `select o.legal_name, o.ntn, o.strn, o.address, o.withholding_agent, o.wht_income_pct::text, o.wht_sales_share_pct::text, r.code, r.label, r.sales_tax_pct::text
       from public.org_tax o join public.tax_rules r on r.code = o.tax_rule_code and r.active where o.tenant_id = $1`, [tenantId])).rows[0];
  if (!p) return null;
  const income = Number(p.wht_income_pct ?? st.wht_income_pct_default ?? 0), share = Number(p.wht_sales_share_pct ?? st.wht_sales_share_pct_default ?? 0);
  const base = st.wht_income_base === "total" ? "total" : "subtotal";
  const result = computeTax({ subtotalUsdCents, pkrPerUsd: rate, salesTaxPct: Number(p.sales_tax_pct), withholdingAgent: p.withholding_agent, whtIncomePct: income, whtSalesSharePct: share, whtIncomeBase: base });
  return {
    result,
    snapshot: {
      seller: { legal_name: st.seller_legal_name ?? null, ntn: st.seller_ntn ?? null, tax_reg: st.seller_tax_reg, pseb_no: st.seller_pseb_no ?? null },
      buyer: { legal_name: p.legal_name, ntn: p.ntn, strn: p.strn, address: p.address, withholding_agent: p.withholding_agent, authority_code: p.code, authority: p.label },
      wht: { income_pct: income, sales_share_pct: share, income_base: base },
    },
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
    `select o.tax_rule_code, o.legal_name, o.ntn, o.strn, o.address, o.withholding_agent, o.wht_income_pct::text, o.wht_sales_share_pct::text, r.label as authority, r.sales_tax_pct::text
       from public.org_tax o left join public.tax_rules r on r.code = o.tax_rule_code where o.tenant_id = $1`, [tenantId])).rows[0] ?? null);
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
  tax_rule_code: string | null; legal_name: string | null; ntn: string | null; strn: string | null; address: string | null; withholding_agent: boolean;
  wht_income_pct: string | null; wht_sales_share_pct: string | null;
};
export type TaxProfileView = { profile: TaxProfile | null; rules: { code: string; label: string; sales_tax_pct: string }[] };

export function getTaxProfile(driver: Driver, m: Membership): Promise<TaxProfileView> {
  return authorized(driver, m, BILLING_PERMISSION, async () => undefined).then(() => withPlatform(driver, async (q) => ({
    profile: (await q.query<TaxProfile>(
      `select tax_rule_code, legal_name, ntn, strn, address, withholding_agent, wht_income_pct::text, wht_sales_share_pct::text from public.org_tax where tenant_id = $1`, [m.tenantId])).rows[0] ?? null,
    rules: (await q.query<{ code: string; label: string; sales_tax_pct: string }>("select code, label, sales_tax_pct::text from public.tax_rules where active order by label")).rows,
  })));
}

const profileSchema = z.object({
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
  if (d.tax_rule_code && !(d.legal_name && d.ntn)) {
    throw new UserError("To be charged sales tax we need your registered name and your NTN.", { legal_name: d.legal_name ? "" : "Enter your registered name", ntn: d.ntn ? "" : "Enter your NTN" });
  }
  await withPlatform(driver, async (q) => {
    await q.query("select set_config('app.user_id', $1, true)", [m.userId]);
    if (d.tax_rule_code && (await q.query("select 1 from public.tax_rules where code = $1 and active", [d.tax_rule_code])).rows.length === 0)
      throw new UserError("Choose where you are registered.", { tax_rule_code: "Choose from the list" });
    await q.query(
      `insert into public.org_tax(tenant_id, tax_rule_code, legal_name, ntn, strn, address, withholding_agent, updated_by) values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (tenant_id) do update set tax_rule_code = excluded.tax_rule_code, legal_name = excluded.legal_name, ntn = excluded.ntn, strn = excluded.strn,
         address = excluded.address, withholding_agent = excluded.withholding_agent, updated_at = now(), updated_by = excluded.updated_by`,
      [m.tenantId, d.tax_rule_code ?? null, d.legal_name ?? null, d.ntn ?? null, d.strn ?? null, d.address ?? null, d.withholding_agent, m.userId]);
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
