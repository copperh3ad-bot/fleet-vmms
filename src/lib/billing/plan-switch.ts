// Moving between Basic and Pro by paying (ADR-068). The plan a customer pays for is the plan it gets when its current paid period ends (or at once when it has none);
// a downgrade is a pending switch to Basic that costs nothing and takes effect at the same moment. A Basic customer may take one free 7-day Pro trial. Every figure is a
// copy of what the owner entered in the plans tables (rule 7). The daily job applies due switches and closes finished trials; reads never write (`tenantPlan` works the
// plan in force out from the dates).
import type { Driver, Queryable } from "@/lib/db/types";
import { authorized, type Membership } from "@/lib/auth/can";
import { withPlatform } from "@/lib/db/tenant";
import { UserError } from "@/lib/master/service";
import { BILLING_PERMISSION } from "./payments";
import { BASIC, PRO, PRO_TRIAL_DAYS, quoteIn, vehicleCount, type Quote } from "./quote";

export type SwitchReason = "payment" | "downgrade" | "operator" | "pro_trial_end";

/** What Pro switches off when it ends: reading documents with AI and job cards by WhatsApp. They are off until an administrator switches them on again (ADR-034, ADR-061). */
async function shutOffPro(q: Queryable, tenantId: string): Promise<void> {
  await q.query(
    `update public.tenants set ai_documents_enabled = false, ai_consent_by = null, ai_consent_at = null,
            wa_jobcards_enabled = false, wa_jobcards_by = null, wa_jobcards_at = null where id = $1`, [tenantId]);
}

/** Puts the organization on the quoted plan now: plan, the price and allowance copies, no pending switch, a history row. Leaving Pro shuts its features off. */
export async function applySwitch(q: Queryable, tenantId: string, quote: Quote, reason: SwitchReason, ctx: { claimId?: string; invoiceId?: string; by?: string } = {}): Promise<void> {
  const b = (await q.query<{ plan_key: string }>("select plan_key from public.org_billing where tenant_id = $1 for update", [tenantId])).rows[0];
  if (!b) throw new UserError("That organization has no billing record.");
  await q.query(
    `update public.org_billing set plan_key = $2, price_cents = $3, currency = $4, ai_reads_per_day = $5,
            pending_plan_key = null, pending_plan_from = null, pending_price_cents = null, pending_currency = null, pending_ai_reads_per_day = null, updated_at = now()
      where tenant_id = $1`, [tenantId, quote.planKey, quote.priceCents, quote.currency, quote.aiReadsPerDay]);
  await q.query("insert into public.plan_changes(tenant_id, from_plan, to_plan, reason, claim_id, invoice_id, changed_by) values ($1, $2, $3, $4, $5, $6, $7)",
    [tenantId, b.plan_key, quote.planKey, reason, ctx.claimId ?? null, ctx.invoiceId ?? null, ctx.by ?? null]);
  if (b.plan_key === PRO && quote.planKey === BASIC) await shutOffPro(q, tenantId);
}

/** Remembers a switch that takes effect at `from`. */
async function schedule(q: Queryable, tenantId: string, quote: Quote | null, plan: string, from: string): Promise<void> {
  await q.query(
    `update public.org_billing set pending_plan_key = $2, pending_plan_from = $3::timestamptz, pending_price_cents = $4, pending_currency = $5, pending_ai_reads_per_day = $6, updated_at = now()
      where tenant_id = $1`, [tenantId, plan, from, quote?.priceCents ?? null, quote?.currency ?? null, quote?.aiReadsPerDay ?? null]);
}

type Before = { plan_key: string; pending_plan_key: string | null; status: string; current_period_end: string | null };
export const readBefore = async (q: Queryable, tenantId: string): Promise<Before | undefined> =>
  (await q.query<Before>("select plan_key, pending_plan_key, status, current_period_end::text from public.org_billing where tenant_id = $1", [tenantId])).rows[0];

/**
 * A claim has been confirmed and its invoice issued. If it was for the other plan, switch: at the end of the period that was running (so Basic time already paid stays
 * Basic), or at once when there was no paid period (a trial, or a lapsed organization). A claim for the plan already in force renews it and cancels a pending downgrade.
 */
export async function applyClaimPlan(q: Queryable, operatorId: string, tenantId: string, claimId: string, quote: Quote | null, before: Before, invoiceId: string): Promise<void> {
  if (!quote) return;
  if (quote.planKey === before.plan_key) {
    if (before.pending_plan_key) await q.query("update public.org_billing set pending_plan_key = null, pending_plan_from = null, pending_price_cents = null, pending_currency = null, pending_ai_reads_per_day = null where tenant_id = $1", [tenantId]);
    return;
  }
  const running = before.status === "active" && before.current_period_end !== null && new Date(before.current_period_end).getTime() > Date.now();
  if (before.pending_plan_key === quote.planKey) {                      // already waiting: the later payment only extends it, and its quote is the newest
    await q.query("update public.org_billing set pending_price_cents = $2, pending_currency = $3, pending_ai_reads_per_day = $4 where tenant_id = $1", [tenantId, quote.priceCents, quote.currency, quote.aiReadsPerDay]);
    return;
  }
  if (!running) { await applySwitch(q, tenantId, quote, "payment", { claimId, invoiceId, by: operatorId }); return; }
  await schedule(q, tenantId, quote, quote.planKey, before.current_period_end!);
}

/** The daily job: apply every switch whose time has come, and shut off the Pro features of a trial that has ended. Safe to run twice. */
export async function applyDueSwitches(driver: Driver): Promise<{ switched: number; trialsClosed: number }> {
  return withPlatform(driver, async (q) => {
    let switched = 0, trialsClosed = 0;
    const due = (await q.query<{ tenant_id: string; pending_plan_key: string; pending_price_cents: number | null; pending_currency: string | null; pending_ai_reads_per_day: number | null }>(
      `select tenant_id, pending_plan_key, pending_price_cents, pending_currency, pending_ai_reads_per_day from public.org_billing
        where pending_plan_key is not null and pending_plan_from <= now() for update skip locked`)).rows;
    for (const d of due) {
      const quote: Quote | null = d.pending_price_cents !== null && d.pending_currency
        ? { planKey: d.pending_plan_key, priceCents: d.pending_price_cents, currency: d.pending_currency, aiReadsPerDay: d.pending_ai_reads_per_day }
        : await quoteIn(q, d.pending_plan_key, 0);
      if (!quote) continue;                                              // a plan with no price cannot be put on; it stays pending and is reported by its age
      await applySwitch(q, d.tenant_id, quote, d.pending_plan_key === BASIC ? "downgrade" : "payment");
      switched += 1;
    }
    const ended = (await q.query<{ tenant_id: string; plan_key: string }>(
      `select tenant_id, plan_key from public.org_billing where pro_trial_ends_at is not null and pro_trial_ends_at <= now() and pro_trial_closed_at is null for update skip locked`)).rows;
    for (const e of ended) {
      await q.query("update public.org_billing set pro_trial_closed_at = now() where tenant_id = $1", [e.tenant_id]);
      if (e.plan_key !== PRO) {                                          // still on Basic: the trial's Pro features go off and stay off until it pays for Pro
        await shutOffPro(q, e.tenant_id);
        await q.query("insert into public.plan_changes(tenant_id, from_plan, to_plan, reason) values ($1, 'standard', 'standard', 'pro_trial_end')", [e.tenant_id]);
      }
      trialsClosed += 1;
    }
    return { switched, trialsClosed };
  });
}

// ------------------------------------------------------------------------------------------ the customer's side

export type PlanStatus = {
  planKey: string; pending: { key: string; from: string; paid: boolean } | null;
  proTrial: { endsAt: string; running: boolean } | null;
  canTryPro: boolean; canMoveToBasic: boolean;
  options: { key: string; priceCents: number; currency: string }[];
};

/** What the Billing page shows about plans: the plan in force, any switch waiting, the Pro trial, and what each plan would charge this organization now. */
export async function planStatus(driver: Driver, m: Membership): Promise<PlanStatus> {
  await authorized(driver, m, BILLING_PERMISSION, async () => undefined);
  const vehicles = await vehicleCount(driver, m.tenantId, m.schema);
  return withPlatform(driver, async (q) => {
    const b = (await q.query<{ plan_key: string; pending_plan_key: string | null; pending_plan_from: string | null; pro_trial_ends_at: string | null; status: string; current_period_end: string | null }>(
      "select plan_key, pending_plan_key, pending_plan_from::text, pro_trial_ends_at::text, status, current_period_end::text from public.org_billing where tenant_id = $1", [m.tenantId])).rows[0];
    const basic = await quoteIn(q, BASIC, vehicles), pro = await quoteIn(q, PRO, vehicles);
    const due = !!b?.pending_plan_key && !!b.pending_plan_from && new Date(b.pending_plan_from).getTime() <= Date.now();
    const planKey = due ? b!.pending_plan_key! : (b?.plan_key ?? BASIC);
    const trialRunning = !!b?.pro_trial_ends_at && new Date(b.pro_trial_ends_at).getTime() > Date.now();
    return {
      planKey,
      pending: b?.pending_plan_key && !due ? { key: b.pending_plan_key, from: b.pending_plan_from!, paid: b.pending_plan_key === PRO } : null,
      proTrial: b?.pro_trial_ends_at ? { endsAt: b.pro_trial_ends_at, running: trialRunning } : null,
      canTryPro: planKey === BASIC && !b?.pro_trial_ends_at && !!pro && !b?.pending_plan_key,
      canMoveToBasic: planKey === PRO && !b?.pending_plan_key,
      options: [basic, pro].filter((x): x is Quote => !!x).map((x) => ({ key: x.planKey, priceCents: x.priceCents, currency: x.currency })),
    };
  });
}

/** A Basic customer takes the free Pro trial, once. */
export async function startProTrial(driver: Driver, m: Membership): Promise<void> {
  await authorized(driver, m, BILLING_PERMISSION, async () => undefined);
  const vehicles = await vehicleCount(driver, m.tenantId, m.schema);
  return withPlatform(driver, async (q) => {
    await q.query("select set_config('app.user_id', $1, true)", [m.userId]);
    const b = (await q.query<{ plan_key: string; pending_plan_key: string | null; pending_plan_from: string | null; pro_trial_ends_at: string | null }>(
      "select plan_key, pending_plan_key, pending_plan_from::text, pro_trial_ends_at::text from public.org_billing where tenant_id = $1 for update", [m.tenantId])).rows[0];
    if (!b) throw new UserError("That organization has no billing record.");
    const due = !!b.pending_plan_key && !!b.pending_plan_from && new Date(b.pending_plan_from).getTime() <= Date.now();
    if ((due ? b.pending_plan_key : b.plan_key) !== BASIC) throw new UserError("The Pro trial is for companies on Basic.");
    if (b.pro_trial_ends_at) throw new UserError("Your company has already had its free Pro trial.");
    if (b.pending_plan_key) throw new UserError("A plan change is already waiting.");
    if (!(await quoteIn(q, PRO, vehicles))) throw new UserError("Pro is not on sale yet.");
    await q.query("update public.org_billing set pro_trial_ends_at = now() + ($2 || ' days')::interval, updated_at = now() where tenant_id = $1", [m.tenantId, String(PRO_TRIAL_DAYS)]);
    // A company that never paid and whose free trial has already ended is locked. Its Pro trial reopens the workspace for the same days, once (the trial is once per
    // company). A suspended company, or one that paid before and lapsed, is not reopened: it pays to continue.
    await q.query(
      `update public.org_billing set trial_ends_at = pro_trial_ends_at
        where tenant_id = $1 and status = 'trialing' and not suspended and not comped and (trial_ends_at is null or trial_ends_at <= now())`, [m.tenantId]);
  });
}

/** A Pro customer asks to move to Basic when its paid period ends. Nothing is refunded; Pro works until then. */
export async function requestBasic(driver: Driver, m: Membership): Promise<void> {
  await authorized(driver, m, BILLING_PERMISSION, async () => undefined);
  return withPlatform(driver, async (q) => {
    await q.query("select set_config('app.user_id', $1, true)", [m.userId]);
    const b = (await q.query<{ plan_key: string; pending_plan_key: string | null; status: string; current_period_end: string | null }>(
      "select plan_key, pending_plan_key, status, current_period_end::text from public.org_billing where tenant_id = $1 for update", [m.tenantId])).rows[0];
    if (!b) throw new UserError("That organization has no billing record.");
    if (b.plan_key !== PRO) throw new UserError("Your company is not on Pro.");
    if (b.pending_plan_key) throw new UserError("A plan change is already waiting.");
    const running = b.status === "active" && b.current_period_end !== null && new Date(b.current_period_end).getTime() > Date.now();
    const basic = await quoteIn(q, BASIC, 0);
    if (!basic) throw new UserError("Basic has no price yet.");
    if (!running) { await applySwitch(q, m.tenantId, basic, "downgrade", { by: m.userId }); return; }
    await schedule(q, m.tenantId, basic, BASIC, b.current_period_end!);
  });
}

/** Takes back a request to move to Basic. A switch to Pro that has been paid for cannot be taken back here. */
export async function cancelBasicRequest(driver: Driver, m: Membership): Promise<void> {
  await authorized(driver, m, BILLING_PERMISSION, async () => undefined);
  return withPlatform(driver, async (q) => {
    await q.query("select set_config('app.user_id', $1, true)", [m.userId]);
    const r = await q.query("update public.org_billing set pending_plan_key = null, pending_plan_from = null, pending_price_cents = null, pending_currency = null, pending_ai_reads_per_day = null, updated_at = now() where tenant_id = $1 and pending_plan_key = 'standard' returning tenant_id", [m.tenantId]);
    if (r.rows.length === 0) throw new UserError("There is no request to move to Basic to cancel.");
  });
}
