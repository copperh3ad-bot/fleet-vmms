// Withholding certificates issued through the application, for customers in Pakistan (ADR-018). A customer that withholds tax can
// generate the certificate for an invoice here, from the figures on that invoice; the operator can issue one on a customer's behalf.
// Each has its own number (WHC-2026-000001), keeps the details as they were, and is fixed once issued: a mistake is voided and
// replaced. Issuing one also records, on the invoice, that the certificate is held, so the operator's "certificates owed" list clears.
//
// What it is NOT: the statutory statement the withholding agent files and deposits through the tax authority's own system. This is a
// document made by Fleet OTG from the figures on the invoice and the deposit details the issuer enters, and it says so on its face.
import type { Driver, Queryable } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";
import { authorized, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { BILLING_PERMISSION } from "./payments";
import type { TaxSnapshot } from "./tax-data";

export type Certificate = {
  id: string; number: string; invoice_id: string; invoice_number: string; tenant_id: string; org_name: string; issued_by_kind: "customer" | "operator";
  agent: { legal_name: string | null; ntn: string | null; strn: string | null; address: string | null }; payee: { legal_name: string | null; ntn: string | null; tax_reg: string | null; pseb_no: string | null };
  currency: string; gross_minor: string; income_tax_pct: string | null; income_tax_minor: string; sales_tax_minor: string; section: string | null;
  deposit_reference: string | null; deposit_date: string | null; note: string | null; status: "issued" | "void"; void_reason: string | null; issued_at: string; invoice_issued_at: string;
};

export const CERTIFICATE_DISCLAIMER =
  "This certificate was prepared through Fleet OTG from the figures on the invoice named above and the deposit details entered by the withholding agent. It does not replace any statement the withholding agent must file or issue through the tax authority's own system. The withholding agent remains responsible for deducting, depositing and reporting the tax as the law requires.";

const COLS = `c.id, c.number, c.invoice_id, i.number as invoice_number, c.tenant_id, i.billed_to as org_name, c.issued_by_kind, c.agent, c.payee, c.currency, c.gross_minor::text, c.income_tax_pct::text,
  c.income_tax_minor::text, c.sales_tax_minor::text, c.section, c.deposit_reference, c.deposit_date::text, c.note, c.status, c.void_reason, c.issued_at::text, i.issued_at::text as invoice_issued_at`;
const FROM = "from public.wht_certificates c join public.invoices i on i.id = c.invoice_id";

export type IssueInput = { deposit_reference?: string; deposit_date?: string; note?: string };
export type Issuer = { kind: "customer"; m: Membership } | { kind: "operator"; operatorId: string };

const today = () => new Date().toISOString().slice(0, 10);

async function issue(q: Queryable, by: { userId: string; kind: "customer" | "operator"; tenantId?: string }, invoiceId: string, v: IssueInput): Promise<{ id: string; number: string }> {
  const inv = (await q.query<{ id: string; tenant_id: string; number: string; subtotal_minor: string | null; total_minor: string | null; wht_income_minor: string | null; wht_sales_minor: string | null; snap: TaxSnapshot | null }>(
    `select id, tenant_id, number, subtotal_minor::text, total_minor::text, wht_income_minor::text, wht_sales_minor::text, tax_snapshot as snap from public.invoices where id = $1 ${by.tenantId ? "and tenant_id = $2" : ""} for update`,
    by.tenantId ? [invoiceId, by.tenantId] : [invoiceId])).rows[0];
  if (!inv) throw new UserError("Invoice not found.");
  const whtI = Number(inv.wht_income_minor ?? 0), whtS = Number(inv.wht_sales_minor ?? 0);
  if (!inv.snap || whtI + whtS <= 0) throw new UserError("No tax was withheld on that invoice, so there is nothing to certify.");
  const live = (await q.query<{ number: string }>("select number from public.wht_certificates where invoice_id = $1 and status = 'issued'", [invoiceId])).rows[0];
  if (live) throw new UserError(`Certificate ${live.number} has already been issued for this invoice.`);

  const ref = (v.deposit_reference ?? "").trim(), date = (v.deposit_date ?? "").trim();
  if (by.kind === "customer") {
    if (ref.length < 3) throw new UserError("Enter the challan or payment slip number the tax was deposited with.", { deposit_reference: "Enter the deposit reference" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) throw new UserError("Enter the date the tax was deposited.", { deposit_date: "Enter the deposit date" });
  } else if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today())) throw new UserError("Enter a valid deposit date.", { deposit_date: "Enter a valid date" });
  if (ref.length > 80) throw new UserError("That reference is too long.", { deposit_reference: "Too long" });

  const set = Object.fromEntries((await q.query<{ key: string; value: string }>("select key, value from public.platform_settings where key = 'wht_certificate_section'")).rows.map((r) => [r.key, r.value]));
  const gross = inv.snap.wht.income_base === "total" ? inv.total_minor : inv.subtotal_minor;
  const b = inv.snap.buyer, s = inv.snap.seller;
  const row = (await q.query<{ id: string; number: string }>(
    `insert into public.wht_certificates(number, invoice_id, tenant_id, issued_by, issued_by_kind, agent, payee, currency, gross_minor, income_tax_pct, income_tax_minor, sales_tax_minor, section, deposit_reference, deposit_date, note)
     values ('WHC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.wht_certificate_seq')::text, 6, '0'), $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id, number`,
    [invoiceId, inv.tenant_id, by.userId, by.kind, JSON.stringify({ legal_name: b.legal_name, ntn: b.ntn, strn: b.strn, address: b.address }), JSON.stringify({ legal_name: s.legal_name, ntn: s.ntn, tax_reg: s.tax_reg, pseb_no: s.pseb_no }),
     inv.snap.currency ?? "PKR", gross, inv.snap.wht.income_pct, whtI, whtS, set.wht_certificate_section ?? null, ref || null, date || null, (v.note ?? "").trim().slice(0, 300) || null])).rows[0];
  // the invoice now has its certificate: the operator's list of certificates still owed no longer shows it
  await q.query(
    `insert into public.invoice_certificates(invoice_id, certificate_no, received_on, note, recorded_by) values ($1, $2, current_date, 'Issued through Fleet OTG', $3)
     on conflict (invoice_id) do update set certificate_no = excluded.certificate_no, received_on = excluded.received_on, note = excluded.note, recorded_by = excluded.recorded_by`, [invoiceId, row.number, by.userId]);
  return row;
}

/** A customer's own certificate for one of its invoices. Needs the billing permission, and the invoice must be its own. */
export async function issueCertificate(driver: Driver, who: Issuer, invoiceId: string, v: IssueInput): Promise<{ number: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) throw new UserError("Invoice not found.");
  if (who.kind === "customer") {
    await authorized(driver, who.m, BILLING_PERMISSION, async () => undefined);
    return withPlatform(driver, async (q) => {
      await q.query("select set_config('app.user_id', $1, true)", [who.m.userId]);
      return issue(q, { userId: who.m.userId, kind: "customer", tenantId: who.m.tenantId }, invoiceId, v);
    });
  }
  return withPlatform(driver, async (q) => {
    if ((await q.query("select 1 from public.platform_admins where user_id = $1", [who.operatorId])).rows.length === 0) throw new UserError("Not allowed.");
    await q.query("select set_config('app.user_id', $1, true)", [who.operatorId]);
    return issue(q, { userId: who.operatorId, kind: "operator" }, invoiceId, v);
  });
}

/** The live certificate for an invoice, as its owner sees it. */
export function getCertificateForInvoice(driver: Driver, m: Membership, invoiceId: string): Promise<Certificate | null> {
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return Promise.resolve(null);
  return authorized(driver, m, BILLING_PERMISSION, async () => undefined).then(() => withPlatform(driver, async (q) =>
    (await q.query<Certificate>(`select ${COLS} ${FROM} where c.invoice_id = $1 and c.tenant_id = $2 and c.status = 'issued'`, [invoiceId, m.tenantId])).rows[0] ?? null));
}

async function asOperator<T>(driver: Driver, operatorId: string, fn: (q: Queryable) => Promise<T>): Promise<T> {
  return withPlatform(driver, async (q) => {
    if ((await q.query("select 1 from public.platform_admins where user_id = $1", [operatorId])).rows.length === 0) throw new UserError("Not allowed.");
    await q.query("select set_config('app.user_id', $1, true)", [operatorId]);
    return fn(q);
  });
}

export function getCertificateForOperator(driver: Driver, operatorId: string, id: string): Promise<Certificate | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Promise.resolve(null);
  return asOperator(driver, operatorId, async (q) => (await q.query<Certificate>(`select ${COLS} ${FROM} where c.id = $1`, [id])).rows[0] ?? null);
}

export function listCertificates(driver: Driver, operatorId: string, limit = 50): Promise<Certificate[]> {
  return asOperator(driver, operatorId, async (q) => (await q.query<Certificate>(`select ${COLS} ${FROM} order by c.issued_at desc limit $1`, [Math.min(Math.max(limit, 1), 500)])).rows);
}

export function voidCertificate(driver: Driver, operatorId: string, id: string, why: string): Promise<void> {
  if (why.trim().length < 3) return Promise.reject(new UserError("Say why it is being voided.", { reason: "Say why" }));
  return asOperator(driver, operatorId, async (q) => {
    const c = (await q.query<{ invoice_id: string; number: string }>("update public.wht_certificates set status = 'void', void_reason = $2, voided_at = now() where id = $1 and status = 'issued' returning invoice_id, number", [id, why.trim().slice(0, 300)])).rows[0];
    if (!c) throw new UserError("That certificate is not live.");
    await q.query("delete from public.invoice_certificates where invoice_id = $1 and certificate_no = $2", [c.invoice_id, c.number]);       // owed again until a new one is issued
  });
}
