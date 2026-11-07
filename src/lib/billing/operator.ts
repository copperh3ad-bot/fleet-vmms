// What the operator (the person who runs the platform) can do about organizations and payments (ADR-014). Every function
// checks that the signed-in person is in platform_admins inside the same transaction that does the work, writes their
// id as the actor so the audit trail names them, and never returns a connection string or any business data.
import type { Driver, Queryable } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";
import { UserError } from "@/lib/master/service";
import { accessFrom, type Access, type BillingRow } from "./state";
import { taxFor } from "./tax-data";
import { postInvoiceJournal } from "./accounting";
import { shortfall } from "./tax";
import type { BlobStore } from "@/lib/jobcards/attachments";
import type { DbProvider } from "@/lib/orgs/db-provider";

export const isOperator = (driver: Driver, userId: string): Promise<boolean> =>
  withPlatform(driver, async (q) => (await q.query("select 1 from public.platform_admins where user_id = $1", [userId])).rows.length > 0);

/** Runs fn as the operator, or refuses. The actor is set first so triggers write the right name in the audit log. */
export async function asOperator<T>(driver: Driver, operatorId: string, fn: (q: Queryable) => Promise<T>): Promise<T> {
  return withPlatform(driver, async (q) => {
    if ((await q.query("select 1 from public.platform_admins where user_id = $1", [operatorId])).rows.length === 0) throw new UserError("Not allowed.");
    await q.query("select set_config('app.user_id', $1, true)", [operatorId]);
    return fn(q);
  });
}

// ------------------------------------------------------------------------------------------ organizations

export type OrgSummary = {
  id: string; name: string; slug: string; status: string; db_kind: string; provision_state: string; provision_error: string | null; created_at: string;
  billing: (BillingRow & { plan_key: string }) | null; access: Access; pending_claims: number; members: number;
};

type OrgRow = Omit<OrgSummary, "billing" | "access"> & {
  b_status: BillingRow["status"] | null; trial_ends_at: string | null; current_period_end: string | null; grace_days: number | null; comped: boolean | null; suspended: boolean | null;
  price_cents: number | null; currency: string | null; plan_key: string | null;
};

const ORG_SQL = `select t.id, t.name, t.slug, t.status, t.db_kind, t.provision_state, t.provision_error, t.created_at::text,
    b.status as b_status, b.trial_ends_at::text, b.current_period_end::text, b.grace_days, b.comped, b.suspended, b.price_cents, b.currency, b.plan_key,
    (select count(*)::int from public.payment_claims c where c.tenant_id = t.id and c.status = 'pending') as pending_claims,
    (select count(*)::int from public.user_orgs u where u.tenant_id = t.id) as members
  from public.tenants t left join public.org_billing b on b.tenant_id = t.id`;

function summary(r: OrgRow, now: Date): OrgSummary {
  const billing = r.b_status ? { status: r.b_status, trial_ends_at: r.trial_ends_at, current_period_end: r.current_period_end, grace_days: r.grace_days ?? 5, comped: !!r.comped, suspended: !!r.suspended, price_cents: r.price_cents ?? 0, currency: r.currency ?? "USD", plan_key: r.plan_key ?? "" } : null;
  const { b_status: _s, trial_ends_at: _t, current_period_end: _c, grace_days: _g, comped: _m, suspended: _x, price_cents: _p, currency: _u, plan_key: _k, ...rest } = r;
  void [_s, _t, _c, _g, _m, _x, _p, _u, _k];
  return { ...rest, billing, access: accessFrom(billing, now) };
}

export function listOrganizations(driver: Driver, operatorId: string, now = new Date()): Promise<OrgSummary[]> {
  return asOperator(driver, operatorId, async (q) => (await q.query<OrgRow>(`${ORG_SQL} order by t.created_at desc`)).rows.map((r) => summary(r, now)));
}

export function getOrganization(driver: Driver, operatorId: string, tenantId: string, now = new Date()): Promise<OrgSummary | null> {
  return asOperator(driver, operatorId, async (q) => {
    const r = (await q.query<OrgRow>(`${ORG_SQL} where t.id = $1`, [tenantId])).rows[0];
    return r ? summary(r, now) : null;
  });
}

const needBilling = async (q: Queryable, tenantId: string) => {
  const r = (await q.query<{ status: string }>("select status from public.org_billing where tenant_id = $1 for update", [tenantId])).rows[0];
  if (!r) throw new UserError("That organization has no billing record.");
};

/** Gives more trial days, counted from now if the trial is over. Only for an organization still on a trial. */
export function extendTrial(driver: Driver, operatorId: string, tenantId: string, days: number): Promise<void> {
  if (!Number.isInteger(days) || days < 1 || days > 60) return Promise.reject(new UserError("Choose between 1 and 60 days."));
  return asOperator(driver, operatorId, async (q) => {
    await needBilling(q, tenantId);
    const r = await q.query(
      `update public.org_billing set trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + ($2 || ' days')::interval, updated_at = now()
        where tenant_id = $1 and status = 'trialing' returning tenant_id`, [tenantId, String(days)]);
    if (r.rows.length === 0) throw new UserError("Only an organization on a trial can have its trial extended.");
  });
}

export function setSuspended(driver: Driver, operatorId: string, tenantId: string, suspended: boolean): Promise<void> {
  return asOperator(driver, operatorId, async (q) => { await needBilling(q, tenantId); await q.query("update public.org_billing set suspended = $2, updated_at = now() where tenant_id = $1", [tenantId, suspended]); });
}

/** Waives billing for an organization (a partner, a pilot). Turning it off puts the organization back under its trial or paid dates. */
export function setComped(driver: Driver, operatorId: string, tenantId: string, comped: boolean): Promise<void> {
  return asOperator(driver, operatorId, async (q) => { await needBilling(q, tenantId); await q.query("update public.org_billing set comped = $2, updated_at = now() where tenant_id = $1", [tenantId, comped]); });
}

// ------------------------------------------------------------------------------------------ payments

export type PendingClaim = {
  id: string; tenant_id: string; org_name: string; slug: string; amount_minor: string; currency: string; paid_on: string; bank_reference: string; months: number;
  note: string | null; has_proof: boolean; created_at: string; status: string; decision_note: string | null; price_cents: number; billing_currency: string; reference_code: string;
};

export function listClaimsForOperator(driver: Driver, operatorId: string, status: "pending" | "confirmed" | "rejected" = "pending"): Promise<PendingClaim[]> {
  return asOperator(driver, operatorId, async (q) =>
    (await q.query<PendingClaim>(
      `select c.id, c.tenant_id, t.name as org_name, t.slug, c.amount_minor::text, c.currency, c.paid_on::text, c.bank_reference, c.months, c.note, (c.proof_path is not null) as has_proof,
              c.created_at::text, c.status, c.decision_note, coalesce(b.price_cents, 0) as price_cents, coalesce(b.currency, 'USD') as billing_currency,
              'FVM-' || upper(substr(replace(t.id::text, '-', ''), 1, 8)) as reference_code
         from public.payment_claims c join public.tenants t on t.id = c.tenant_id left join public.org_billing b on b.tenant_id = t.id
        where c.status = $1 order by c.created_at ${status === "pending" ? "asc" : "desc"} limit 100`, [status])).rows);
}

/** A short-lived link to the receipt, for the operator only. */
export function proofLink(driver: Driver, store: BlobStore, operatorId: string, claimId: string): Promise<string | null> {
  return asOperator(driver, operatorId, async (q) => {
    const p = (await q.query<{ proof_path: string | null }>("select proof_path from public.payment_claims where id = $1", [claimId])).rows[0]?.proof_path;
    return p ? store.signedUrl(p, 300) : null;
  });
}

/** Moves the paid-until date forward and issues an invoice. Shared by "confirm a claim" and "record a payment by hand". */
async function settle(q: Queryable, operatorId: string, tenantId: string, months: number, opts: { claimId?: string; received?: { minor: string; currency: string }; note?: string; paymentDate?: string }): Promise<{ invoiceId: string; number: string; periodEnd: string }> {
  const b = (await q.query<{ price_cents: number; currency: string; current_period_end: string | null; name: string }>(
    `select b.price_cents, b.currency, b.current_period_end::text, t.name from public.org_billing b join public.tenants t on t.id = b.tenant_id where b.tenant_id = $1 for update of b`, [tenantId])).rows[0];
  if (!b) throw new UserError("That organization has no billing record.");
  // No invoice without the customer's NTN (ADR-053). A customer abroad is not asked for one.
  const t0 = (await q.query<{ country: string | null; ntn: string | null }>("select country, ntn from public.org_tax where tenant_id = $1", [tenantId])).rows[0];
  if ((!t0?.country || t0.country === "PK") && !t0?.ntn?.trim()) throw new UserError("This customer has not entered its NTN yet. An invoice cannot be issued until it does: ask it to fill in its tax details on the Billing page.");
  // A paid period runs on from where the last one ended, or from today if there was none or it has already run out.
  const period = (await q.query<{ start: string; end: string }>(
    `select greatest(coalesce($1::timestamptz, now()), now())::date::text as start,
            (greatest(coalesce($1::timestamptz, now()), now()) + ($2 || ' months')::interval)::text as end`, [b.current_period_end, String(months)])).rows[0];
  await q.query(
    `update public.org_billing set status = 'active', current_period_end = $2::timestamptz, updated_at = now() where tenant_id = $1`, [tenantId, period.end]);
  const tax = await taxFor(q, tenantId, b.price_cents * months, b.currency, { paymentDate: opts.paymentDate });
  const t = tax?.result;
  const inv = (await q.query<{ id: string; number: string }>(
    `insert into public.invoices(number, tenant_id, claim_id, billed_to, period_start, period_end, months, amount_cents, currency, received_minor, received_currency, issued_by, note,
                                 pkr_per_usd, subtotal_minor, sales_tax_pct, sales_tax_minor, total_minor, wht_income_minor, wht_sales_minor, net_expected_minor, tax_snapshot)
     values ('INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0'), $1, $2, $3, $4::date, $5::timestamptz::date, $6, $7, $8, $9, $10, $11, $12,
             $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb)
     returning id, number`,
    [tenantId, opts.claimId ?? null, b.name, period.start, period.end, months, b.price_cents * months, b.currency, opts.received?.minor ?? null, opts.received?.currency ?? null, operatorId, opts.note ?? null,
     t?.pkrPerUsd ?? null, t?.subtotalMinor ?? null, t?.salesTaxPct ?? null, t?.salesTaxMinor ?? null, t?.totalMinor ?? null, t?.whtIncomeMinor ?? null, t?.whtSalesMinor ?? null, t?.netExpectedMinor ?? null,
     tax ? JSON.stringify(tax.snapshot) : null])).rows[0];
  await postInvoiceJournal(q, inv.id, operatorId);                      // the ledger entry is part of the same transaction: no invoice without it
  return { invoiceId: inv.id, number: inv.number, periodEnd: period.end };
}

export type ClaimTaxPreview = {
  subtotalMinor: number; salesTaxPct: number; salesTaxMinor: number; totalMinor: number; whtIncomeMinor: number; whtSalesMinor: number; netExpectedMinor: number; authority: string;
  currency: string; scenario: string | null; country: string | null; fx: string | null;
  /** how what the customer said it sent compares with what should arrive; null if it was not sent in rupees */
  against: { state: "exact" | "short" | "over"; diffMinor: number } | null;
} | null;

/** The invoice the confirmation would make, worked out now, so a short payment or a missing withholding certificate is seen before confirming. */
export function previewClaimTax(driver: Driver, operatorId: string, claimId: string, months?: number): Promise<ClaimTaxPreview> {
  return asOperator(driver, operatorId, async (q) => {
    const c = (await q.query<{ tenant_id: string; months: number; amount_minor: string; currency: string; paid_on: string }>("select tenant_id, months, amount_minor::text, currency, paid_on::text from public.payment_claims where id = $1", [claimId])).rows[0];
    if (!c) throw new UserError("Payment not found.");
    const b = (await q.query<{ price_cents: number; currency: string }>("select price_cents, currency from public.org_billing where tenant_id = $1", [c.tenant_id])).rows[0];
    if (!b) return null;
    const tax = await taxFor(q, c.tenant_id, b.price_cents * (months ?? c.months), b.currency, { paymentDate: c.paid_on });
    if (!tax) return null;
    const r = tax.result;
    return {
      subtotalMinor: r.subtotalMinor, salesTaxPct: r.salesTaxPct, salesTaxMinor: r.salesTaxMinor, totalMinor: r.totalMinor, whtIncomeMinor: r.whtIncomeMinor, whtSalesMinor: r.whtSalesMinor,
      netExpectedMinor: r.netExpectedMinor, authority: tax.snapshot.buyer.authority, currency: tax.snapshot.currency ?? "PKR", scenario: tax.snapshot.scenario?.label ?? null, country: tax.snapshot.country ?? null,
      fx: tax.snapshot.fx ? `${tax.snapshot.fx.rate} (${tax.snapshot.fx.source}, ${tax.snapshot.fx.side}, rate of ${tax.snapshot.fx.rate_date}, payment of ${tax.snapshot.fx.payment_date})` : null,
      against: c.currency === (tax.snapshot.currency ?? "PKR") ? shortfall(Number(c.amount_minor), r.netExpectedMinor) : null,
    };
  });
}

/** The money has arrived: confirm the claim. The months can be corrected if the customer sent a different amount. */
export function confirmClaim(driver: Driver, operatorId: string, claimId: string, opts: { months?: number; note?: string } = {}): Promise<{ number: string; periodEnd: string }> {
  return asOperator(driver, operatorId, async (q) => {
    const c = (await q.query<{ tenant_id: string; months: number; amount_minor: string; currency: string; status: string; paid_on: string }>(
      "select tenant_id, months, amount_minor::text, currency, status, paid_on::text from public.payment_claims where id = $1 for update", [claimId])).rows[0];
    if (!c) throw new UserError("Payment not found.");
    if (c.status !== "pending") throw new UserError("That payment has already been decided.");
    const months = opts.months ?? c.months;
    if (!Number.isInteger(months) || months < 1 || months > 12) throw new UserError("Choose between 1 and 12 months.");
    const s = await settle(q, operatorId, c.tenant_id, months, { claimId, received: { minor: c.amount_minor, currency: c.currency }, note: opts.note?.slice(0, 500), paymentDate: c.paid_on });
    await q.query("update public.payment_claims set status = 'confirmed', decided_by = $2, decided_at = now(), decision_note = $3, invoice_id = $4, months = $5 where id = $1",
      [claimId, operatorId, opts.note?.slice(0, 500) ?? null, s.invoiceId, months]);
    return { number: s.number, periodEnd: s.periodEnd };
  });
}

export function rejectClaim(driver: Driver, operatorId: string, claimId: string, note: string): Promise<void> {
  const why = note.trim();
  if (why.length < 3) return Promise.reject(new UserError("Say why, so the customer knows what to fix."));
  return asOperator(driver, operatorId, async (q) => {
    const r = await q.query("update public.payment_claims set status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3 where id = $1 and status = 'pending' returning id", [claimId, operatorId, why.slice(0, 500)]);
    if (r.rows.length === 0) throw new UserError("That payment has already been decided.");
  });
}

/** A payment that arrived without the customer filing a claim (cash, a call). Issues an invoice like any other. */
export function recordManualPayment(driver: Driver, operatorId: string, tenantId: string, months: number, note: string): Promise<{ number: string; periodEnd: string }> {
  if (!Number.isInteger(months) || months < 1 || months > 12) return Promise.reject(new UserError("Choose between 1 and 12 months."));
  if (note.trim().length < 3) return Promise.reject(new UserError("Say how it was paid, for the record."));
  return asOperator(driver, operatorId, async (q) => {
    await needBilling(q, tenantId);
    const s = await settle(q, operatorId, tenantId, months, { note: note.trim().slice(0, 500) });
    return { number: s.number, periodEnd: s.periodEnd };
  });
}

// ------------------------------------------------------------------------------------------ deleting a database

/**
 * Removes an organization's database for good. Only when the organization has no access (locked or suspended), and only
 * with the typed phrase "DELETE <slug>". The provider's database is destroyed first; then the organization is closed
 * and its logins, routes and indexes are removed. The invoices and payment records stay.
 */
export async function deleteOrganization(driver: Driver, provider: DbProvider, operatorId: string, tenantId: string, typed: string, now = new Date()): Promise<void> {
  const org = await getOrganization(driver, operatorId, tenantId, now);
  if (!org) throw new UserError("Organization not found.");
  if (typed.trim() !== `DELETE ${org.slug}`) throw new UserError(`Type exactly: DELETE ${org.slug}`);
  if (org.status === "closed") throw new UserError("This organization is already deleted.");
  if (org.db_kind !== "dedicated") throw new UserError("This organization shares the main database, so its data cannot be removed from here. It has to be removed by hand.");
  if (org.access.full) throw new UserError("This organization still has access. Lock or suspend it first.");
  const ref = await asOperator(driver, operatorId, async (q) => (await q.query<{ db_ref: string | null }>("select db_ref from public.tenants where id = $1", [tenantId])).rows[0]?.db_ref ?? null);
  if (org.db_kind === "dedicated" && ref) await provider.destroy(ref);
  await asOperator(driver, operatorId, async (q) => {
    await q.query("update public.tenants set status = 'closed', db_url_enc = null, provision_state = case when db_kind = 'dedicated' then 'failed' else provision_state end where id = $1", [tenantId]);
    await q.query("delete from public.user_orgs where tenant_id = $1", [tenantId]);
    await q.query("delete from public.link_routes where tenant_id = $1", [tenantId]);
    await q.query("delete from public.invite_index where tenant_id = $1", [tenantId]);
  });
}
