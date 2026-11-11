// Recording payment of checked invoices (ADR-086): workshop invoices (ADR-007) and logistics provider trip invoices (ADR-078).
// Every entry checks can() first (CLAUDE.md rule 3); the rules (verified only, never above the amount due, segregation of duties, append-only)
// live in the two database functions record_invoice_payment and void_invoice_payment (migration 0052).
import { z } from "zod";
import type { Driver } from "@/lib/db/types";
import { adminMayDecideOwn, authorized, authorizedAny, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";

import { PAY_METHODS, type InvoiceKind, type PaymentRow, type PaymentSummary } from "./types";
export { PAY_METHODS, type InvoiceKind, type PaymentRow, type PaymentSummary } from "./types";
const METHOD_KEYS = PAY_METHODS.map(([k]) => k) as [string, ...string[]];

const READERS = ["invoice.pay", "invoice.verify", "report.view"];

// The database says these in plain words already; anything else is a real fault and is rethrown.
const KNOWN = [
  /enter the amount paid/, /enter the date of payment/, /the payment date cannot be in the future/, /choose how it was paid/,
  /enter the payment reference[^"]*/, /invoice not found/, /this invoice is already paid in full/, /only a checked invoice can be paid/,
  /segregation of duties: [^"]*/, /this payment would take the total above the amount due[^"]*/,
  /payment not found/, /this payment is already void/, /a reason of at least 5 characters is required/, /unknown invoice kind/,
];
function friendlyPay(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  for (const re of KNOWN) { const hit = msg.match(re); if (hit) throw new UserError(hit[0].replace(/^./, (c) => c.toUpperCase()) + (hit[0].endsWith(".") ? "" : ".")); }
  throw e;
}

const paySchema = z.object({
  amount: z.string().trim().transform((s) => s.replace(/,/g, "")).pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter the amount, for example 9500 or 9500.50")).refine((s) => Number(s) > 0, "Enter an amount above zero"),
  paid_on: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date paid"),
  method: z.enum(METHOD_KEYS, { message: "Choose how it was paid" }),
  reference: z.string().trim().max(80, "At most 80 characters").optional(),
  note: z.string().trim().max(500, "At most 500 characters").optional(),
});
export type PaymentInput = z.input<typeof paySchema>;

const DUE_SQL: Record<InvoiceKind, string> = {
  workshop: `select case when i.status in ('verified','paid') then coalesce(i.payable_amount, i.amount) + i.tax_amount end as due, i.status = 'paid' as settled, i.verified_by
               from invoices i where i.id = $1`,
  trip: `select ti.payable as due, false as settled, ti.verified_by from trip_invoices ti where ti.id = $1 and ti.status = 'verified'`,
};
const FK: Record<InvoiceKind, string> = { workshop: "invoice_id", trip: "trip_invoice_id" };

/** What has been paid against one invoice, what is left, and whether this person may record the next payment. */
export async function getPayments(driver: Driver, m: Membership, kind: InvoiceKind, invoiceId: string): Promise<PaymentSummary> {
  const adminAlone = await adminMayDecideOwn(driver, m, "invoice.pay");
  return authorizedAny(driver, m, READERS, async (q, held) => {
    const inv = (await q.query<{ due: string | null; settled: boolean; verified_by: string | null }>(DUE_SQL[kind], [invoiceId])).rows[0];
    if (!inv) throw new UserError("Invoice not found.");
    const payments = (await q.query<PaymentRow>(
      `select p.id, p.payment_no, p.amount::text, p.paid_on::text, p.method, p.reference, p.note, pe.full_name as paid_by_name, p.created_at::text,
              p.voided_at::text, ve.full_name as voided_by_name, p.void_reason
         from invoice_payments p left join employees pe on pe.user_id = p.paid_by left join employees ve on ve.user_id = p.voided_by
        where p.${FK[kind]} = $1 order by p.created_at, p.payment_no`, [invoiceId])).rows;
    const paid = payments.filter((p) => !p.voided_at).reduce((s, p) => s + Number(p.amount), 0);
    const due = inv.due === null ? null : Number(inv.due);
    const remaining = due === null ? null : Math.max(0, Math.round((due - paid) * 100) / 100);
    const status: PaymentSummary["status"] = due === null ? "not_checked" : remaining === 0 ? "paid" : paid > 0 ? "part_paid" : "unpaid";
    let blocked: string | null = null;
    if (held.has("invoice.pay") && due !== null && remaining !== 0 && !adminAlone && inv.verified_by === m.userId) {
      blocked = "You checked this invoice, so someone else has to record its payment.";
    }
    return { kind, invoiceId, due, paid, remaining, canPay: held.has("invoice.pay"), blocked, status, payments };
  });
}

/** Records one payment (part or whole). Returns the new payment's id. */
export function recordPayment(driver: Driver, m: Membership, kind: InvoiceKind, invoiceId: string, input: PaymentInput): Promise<string> {
  const r = paySchema.safeParse(input);
  if (!r.success) return Promise.reject(new UserError("Fix the highlighted fields.", fieldErrors(r.error)));
  const v = r.data;
  return authorized(driver, m, "invoice.pay", async (q) => {
    try {
      const row = (await q.query<{ id: string }>("select record_invoice_payment($1, $2, $3, $4::numeric, $5::date, $6, $7, $8) as id",
        [kind, invoiceId, m.userId, v.amount, v.paid_on, v.method, v.reference || null, v.note || null])).rows[0];
      return row.id;
    } catch (e) { return friendlyPay(e); }
  });
}

/** Voids a payment entered by mistake; the row stays, with who voided it and why. */
export function voidPayment(driver: Driver, m: Membership, paymentId: string, reason: string): Promise<void> {
  return authorized(driver, m, "invoice.pay", async (q) => {
    try { await q.query("select void_invoice_payment($1, $2, $3)", [paymentId, m.userId, reason]); } catch (e) { friendlyPay(e); }
  });
}
