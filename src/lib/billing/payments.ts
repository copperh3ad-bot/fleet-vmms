// Paying by bank transfer, from the customer's side (ADR-014). An administrator tells us a transfer was made and uploads
// the receipt; an operator checks the bank (see operator.ts). Every call checks the signed-in person's permission in
// their own organization first (CLAUDE.md rule 3); the billing records themselves live in the control database.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Driver } from "@/lib/db/types";
import { authorized, type Membership } from "@/lib/auth/can";
import { withPlatform } from "@/lib/db/tenant";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";
import { MAX_FILE_BYTES, logStorageFailure, safeName, sniff, type BlobStore } from "@/lib/jobcards/attachments";
import { BASIC, PRO, quoteIn, vehicleCount, type Quote } from "./quote";

/** Billing is run by whoever may change the workspace's settings: the administrator. */
export const BILLING_PERMISSION = "admin.settings";
export const PAYMENT_CURRENCIES = ["USD", "PKR"] as const;

/** What the customer writes in the bank transfer, so we can match it: FVM- and the first 8 characters of the organization id. */
export const paymentReference = (tenantId: string) => `FVM-${tenantId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

export const claimSchema = z.object({
  amount: z.coerce.number("Enter the amount you sent").positive("Enter the amount you sent").max(1_000_000_000, "That amount is too large"),
  currency: z.enum(PAYMENT_CURRENCIES, "Choose the currency"),
  paid_on: z.iso.date("Enter the date of the transfer").refine((d) => d <= today(), "That date is in the future").refine((d) => d >= daysAgo(120), "That date is too long ago"),
  bank_reference: z.string().trim().min(1, "Enter the bank's transaction reference").max(80, "That reference is too long"),
  months: z.preprocess(blank, z.coerce.number().int("Whole months").min(1, "At least 1").max(12, "At most 12").default(1)),
  plan: z.preprocess(blank, z.enum([BASIC, PRO], "Choose Basic or Pro").optional()),
  note: z.preprocess(blank, z.string().trim().max(500, "Keep the note under 500 characters").optional()),
});
export type ClaimInput = Record<string, unknown>;

export type ClaimRow = {
  id: string; amount_minor: string; currency: string; paid_on: string; bank_reference: string; months: number; note: string | null;
  status: "pending" | "confirmed" | "rejected"; decision_note: string | null; created_at: string; decided_at: string | null; has_proof: boolean; invoice_id: string | null; plan_key: string | null;
};
export type InvoiceRow = { id: string; number: string; period_start: string; period_end: string; months: number; amount_cents: string; currency: string; issued_at: string };

/** Records that the organization says it has paid. One claim waits at a time. */
export async function submitClaim(driver: Driver, store: BlobStore, m: Membership, input: ClaimInput, proof?: { name: string; bytes: Uint8Array }, opts: { submitterEmail?: string } = {}): Promise<{ id: string }> {
  await authorized(driver, m, BILLING_PERMISSION, async () => undefined);
  const r = claimSchema.safeParse(input);
  if (!r.success) throw new UserError("Fix the highlighted fields.", fieldErrors(r.error));
  const c = r.data;
  // The plan this payment is for, and the price it was filed at (ADR-068). A claim without a plan is for the plan the organization is on, at its own price.
  let quote: Quote | null = null;
  if (c.plan) {
    const vehicles = c.plan === PRO ? await vehicleCount(driver, m.tenantId, m.schema) : 0;
    quote = await withPlatform(driver, (q) => quoteIn(q, c.plan!, vehicles));
    if (!quote) throw new UserError(c.plan === PRO ? "Pro is not on sale yet." : "Basic has no price yet.", { plan: "Not on sale" });
    const b = (await withPlatform(driver, (q) => q.query<{ pending_plan_key: string | null; pending_plan_from: string | null }>("select pending_plan_key, pending_plan_from::text from public.org_billing where tenant_id = $1", [m.tenantId]))).rows[0];
    if (b?.pending_plan_key === PRO && c.plan === BASIC) throw new UserError("Your move to Pro is already paid for and starts when your current period ends. To change it, contact us.", { plan: "Move to Pro is paid for" });
  }
  let path: string | null = null;
  if (proof && proof.bytes.length > 0) {
    if (proof.bytes.length > MAX_FILE_BYTES) throw new UserError("That receipt is larger than 4 MB. Send a smaller photo or a shorter PDF.", { proof: "Larger than 4 MB" });
    const mime = sniff(proof.name, proof.bytes);
    if (!mime) throw new UserError("The receipt must be a photo (JPG, PNG, WebP, HEIC) or a PDF.", { proof: "Photo or PDF only" });
    path = `${m.schema}/billing/${randomUUID()}-${safeName(proof.name)}`;
    try { await store.put(path, proof.bytes, mime); } catch (e) { await logStorageFailure("save a payment receipt", e, m.userId, m.tenantId); throw new UserError("The receipt could not be uploaded. Try again."); }
  }
  try {
    return await withPlatform(driver, async (q) => {
      await q.query("select set_config('app.user_id', $1, true)", [m.userId]);
      return (await q.query<{ id: string }>(
        `insert into public.payment_claims(tenant_id, submitted_by, amount_minor, currency, paid_on, bank_reference, months, note, proof_path, submitter_email, plan_key, quoted_price_cents, quoted_currency, quoted_ai_reads_per_day)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
        [m.tenantId, m.userId, Math.round(c.amount * 100), c.currency, c.paid_on, c.bank_reference, c.months, c.note ?? null, path, opts.submitterEmail?.trim().slice(0, 200) || null,
         quote?.planKey ?? null, quote?.priceCents ?? null, quote?.currency ?? null, quote?.aiReadsPerDay ?? null])).rows[0];
    });
  } catch (e) {
    if (path) await store.remove(path).catch(() => undefined);      // no receipt without a claim
    if (e instanceof Error && /payment_claims_one_pending/.test(e.message)) throw new UserError("You already have a payment waiting to be confirmed. We will tell you when it is done.");
    throw e;
  }
}

export function listClaims(driver: Driver, m: Membership): Promise<ClaimRow[]> {
  return authorized(driver, m, BILLING_PERMISSION, async () => undefined).then(() => withPlatform(driver, async (q) =>
    (await q.query<ClaimRow>(
      `select id, amount_minor::text, currency, paid_on::text, bank_reference, months, note, status, decision_note, created_at::text, decided_at::text,
              (proof_path is not null) as has_proof, invoice_id, plan_key
         from public.payment_claims where tenant_id = $1 order by created_at desc limit 50`, [m.tenantId])).rows));
}

export function listInvoices(driver: Driver, m: Membership): Promise<InvoiceRow[]> {
  return authorized(driver, m, BILLING_PERMISSION, async () => undefined).then(() => withPlatform(driver, async (q) =>
    (await q.query<InvoiceRow>(
      `select id, number, period_start::text, period_end::text, months, amount_cents::text, currency, issued_at::text
         from public.invoices where tenant_id = $1 order by issued_at desc limit 100`, [m.tenantId])).rows));
}

export type InvoiceTax = {
  pkr_per_usd: string; subtotal_minor: string; sales_tax_pct: string; sales_tax_minor: string; total_minor: string; wht_income_minor: string; wht_sales_minor: string; net_expected_minor: string;
  snapshot: import("./tax-data").TaxSnapshot; certificate: { certificate_no: string; received_on: string } | null;
};
export type InvoiceDetail = InvoiceRow & { billed_to: string; received_minor: string | null; received_currency: string | null; note: string | null; tax: InvoiceTax | null };

export function getInvoice(driver: Driver, m: Membership, id: string): Promise<InvoiceDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Promise.resolve(null);
  return authorized(driver, m, BILLING_PERMISSION, async () => undefined).then(() => withPlatform(driver, async (q) => {
    const r = (await q.query<InvoiceDetail & { t_total: string | null; t_rate: string; t_sub: string; t_pct: string; t_tax: string; t_wi: string; t_ws: string; t_net: string; t_snap: InvoiceTax["snapshot"] | null; cert_no: string | null; cert_on: string | null }>(
      `select i.id, i.number, i.period_start::text, i.period_end::text, i.months, i.amount_cents::text, i.currency, i.issued_at::text, i.billed_to, i.received_minor::text, i.received_currency, i.note,
              i.total_minor::text as t_total, i.pkr_per_usd::text as t_rate, i.subtotal_minor::text as t_sub, i.sales_tax_pct::text as t_pct, i.sales_tax_minor::text as t_tax,
              coalesce(i.wht_income_minor, 0)::text as t_wi, coalesce(i.wht_sales_minor, 0)::text as t_ws, i.net_expected_minor::text as t_net, i.tax_snapshot as t_snap,
              c.certificate_no as cert_no, c.received_on::text as cert_on
         from public.invoices i left join public.invoice_certificates c on c.invoice_id = i.id where i.id = $1 and i.tenant_id = $2`, [id, m.tenantId])).rows[0];
    if (!r) return null;
    const tax: InvoiceTax | null = r.t_total && r.t_snap ? {
      pkr_per_usd: r.t_rate, subtotal_minor: r.t_sub, sales_tax_pct: r.t_pct, sales_tax_minor: r.t_tax, total_minor: r.t_total, wht_income_minor: r.t_wi, wht_sales_minor: r.t_ws, net_expected_minor: r.t_net,
      snapshot: r.t_snap, certificate: r.cert_no && r.cert_on ? { certificate_no: r.cert_no, received_on: r.cert_on } : null,
    } : null;
    return {
      id: r.id, number: r.number, period_start: r.period_start, period_end: r.period_end, months: r.months, amount_cents: r.amount_cents, currency: r.currency, issued_at: r.issued_at,
      billed_to: r.billed_to, received_minor: r.received_minor, received_currency: r.received_currency, note: r.note, tax,
    };
  }));
}
