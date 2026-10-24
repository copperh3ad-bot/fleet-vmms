// Tax scenarios the application owner configures (ADR-018): which tax a customer gets, chosen by the customer's country. The two
// that ship (customers in Pakistan, and everyone else with no tax) are rows like any other: the owner can change them and add more,
// for example a country with VAT. The first active scenario by priority whose country list contains the customer's country wins; a
// scenario with no country list matches every country, so it belongs last. A customer with no country is treated as before: no tax.
import { z } from "zod";
import type { Driver, Queryable } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";

export type SalesTaxMode = "none" | "authority" | "fixed";
export type Scenario = {
  code: string; label: string; priority: number; countries: string[] | null; sales_tax_mode: SalesTaxMode; sales_tax_pct: string | null; tax_name: string | null;
  currency: "USD" | "PKR"; withholding_allowed: boolean; seller_registration: string | null; document_title: string; note: string | null; active: boolean;
};

const COLS = "code, label, priority, countries, sales_tax_mode, sales_tax_pct::text, tax_name, currency, withholding_allowed, seller_registration, document_title, note, active";

export async function resolveScenario(q: Queryable, country: string | null | undefined): Promise<Scenario | null> {
  if (!country || !/^[A-Z]{2}$/.test(country)) return null;
  return (await q.query<Scenario>(`select ${COLS} from public.tax_scenarios where active and (countries is null or $1 = any(countries)) order by priority, code limit 1`, [country])).rows[0] ?? null;
}

async function asOperator<T>(driver: Driver, operatorId: string, fn: (q: Queryable) => Promise<T>): Promise<T> {
  return withPlatform(driver, async (q) => {
    if ((await q.query("select 1 from public.platform_admins where user_id = $1", [operatorId])).rows.length === 0) throw new UserError("Not allowed.");
    await q.query("select set_config('app.user_id', $1, true)", [operatorId]);
    return fn(q);
  });
}

export function listScenarios(driver: Driver, operatorId: string): Promise<Scenario[]> {
  return asOperator(driver, operatorId, async (q) => (await q.query<Scenario>(`select ${COLS} from public.tax_scenarios order by priority, code`)).rows);
}

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const countries = z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.split(/[\s,;]+/).filter(Boolean).map((c) => c.toUpperCase())) : v),
  z.array(z.string().regex(/^[A-Z]{2}$/, "Two-letter country codes, like PK or AE")).min(1).max(250).optional());

const schema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,19}$/, "2 to 20 capital letters, digits or underscores"),
  label: z.string().trim().min(2, "Enter a name").max(80),
  priority: z.coerce.number("Enter a number").int("Whole number").min(1).max(100000),
  countries,
  sales_tax_mode: z.enum(["none", "authority", "fixed"], "Choose none, authority or fixed"),
  sales_tax_pct: z.preprocess(blank, z.coerce.number("Enter a percent like 5").min(0).max(100).transform((n) => Math.round(n * 100) / 100).optional()),
  tax_name: z.preprocess(blank, z.string().trim().max(30).optional()),
  currency: z.enum(["USD", "PKR"], "Choose USD or PKR"),
  withholding_allowed: z.boolean(),
  seller_registration: z.preprocess(blank, z.string().trim().max(40).optional()),
  document_title: z.string().trim().min(2, "Enter the title").max(40),
  note: z.preprocess(blank, z.string().trim().max(300).optional()),
  active: z.boolean(),
}).superRefine((d, ctx) => {
  if (d.sales_tax_mode === "fixed" && d.sales_tax_pct === undefined) ctx.addIssue({ code: "custom", path: ["sales_tax_pct"], message: "Enter the rate for a fixed-rate scenario" });
  if (d.sales_tax_mode === "fixed" && !d.seller_registration) ctx.addIssue({ code: "custom", path: ["seller_registration"], message: "Enter your registration number for this tax" });
  if (d.sales_tax_mode === "authority" && d.currency !== "PKR") ctx.addIssue({ code: "custom", path: ["currency"], message: "Authority rates are in rupees: choose PKR" });
  if (d.sales_tax_mode === "none" && d.withholding_allowed) ctx.addIssue({ code: "custom", path: ["withholding_allowed"], message: "There is nothing to withhold when no tax is charged" });
});

export async function saveScenario(driver: Driver, operatorId: string, input: Record<string, unknown>): Promise<void> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const fields = Object.fromEntries(Object.entries(fieldErrors(r.error)).map(([k, v]) => [k.startsWith("countries.") ? "countries" : k, v]));   // one message for the whole list
    throw new UserError("Fix the highlighted fields.", fields);
  }
  const d = r.data;
  await asOperator(driver, operatorId, async (q) => {
    await q.query(
      `insert into public.tax_scenarios(code, label, priority, countries, sales_tax_mode, sales_tax_pct, tax_name, currency, withholding_allowed, seller_registration, document_title, note, active, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (code) do update set label = excluded.label, priority = excluded.priority, countries = excluded.countries, sales_tax_mode = excluded.sales_tax_mode,
         sales_tax_pct = excluded.sales_tax_pct, tax_name = excluded.tax_name, currency = excluded.currency, withholding_allowed = excluded.withholding_allowed,
         seller_registration = excluded.seller_registration, document_title = excluded.document_title, note = excluded.note, active = excluded.active, updated_at = now(), updated_by = excluded.updated_by`,
      [d.code, d.label, d.priority, d.countries ?? null, d.sales_tax_mode, d.sales_tax_pct ?? null, d.tax_name ?? null, d.currency, d.withholding_allowed, d.seller_registration ?? null, d.document_title, d.note ?? null, d.active, operatorId]);
  });
}
