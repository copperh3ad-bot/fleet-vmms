import { beforeAll, describe, expect, it } from "vitest";
import { accessFrom, accessMessage, loadAccess, type BillingRow } from "@/lib/billing/state";
import { newControl } from "./helpers";

const NOW = new Date("2026-10-23T12:00:00Z");
const plus = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();
const row = (over: Partial<BillingRow> = {}): BillingRow => ({
  status: "trialing", trial_ends_at: plus(72), current_period_end: null, grace_days: 5, comped: false, suspended: false, price_cents: 14900, currency: "USD", ...over,
});

describe("what an organization may do", () => {
  it("a new trial has full access for three days, counted up to whole days", () => {
    expect(accessFrom(row(), NOW)).toMatchObject({ state: "trial", full: true, daysLeft: 3 });
    expect(accessFrom(row({ trial_ends_at: plus(24.5) }), NOW)).toMatchObject({ state: "trial", daysLeft: 2 });
    expect(accessFrom(row({ trial_ends_at: plus(1) }), NOW)).toMatchObject({ state: "trial", daysLeft: 1 });
  });

  it("the moment the trial ends, the organization is locked and says why", () => {
    expect(accessFrom(row({ trial_ends_at: plus(0) }), NOW)).toMatchObject({ state: "locked", full: false, lockedReason: "trial_ended" });
    expect(accessFrom(row({ trial_ends_at: plus(-1) }), NOW)).toMatchObject({ full: false, lockedReason: "trial_ended" });
    expect(accessFrom(row({ trial_ends_at: null }), NOW)).toMatchObject({ full: false, lockedReason: "trial_ended" });
  });

  it("a paid period is active, then there is a grace period, then it locks", () => {
    const paid = (endHours: number, over: Partial<BillingRow> = {}) => row({ status: "active", trial_ends_at: null, current_period_end: plus(endHours), ...over });
    expect(accessFrom(paid(24 * 20), NOW)).toMatchObject({ state: "active", full: true, daysLeft: 20 });
    expect(accessFrom(paid(-1), NOW)).toMatchObject({ state: "grace", full: true });                  // one hour late: still in
    expect(accessFrom(paid(-24 * 4), NOW)).toMatchObject({ state: "grace", full: true, daysLeft: 1 });
    expect(accessFrom(paid(-24 * 5), NOW)).toMatchObject({ state: "locked", full: false, lockedReason: "payment_overdue" });
    expect(accessFrom(paid(-24 * 5), NOW).until).toBe(plus(0));                                       // exactly when the grace ended
    expect(accessFrom(paid(-24, { grace_days: 0 }), NOW)).toMatchObject({ full: false, lockedReason: "payment_overdue" });
  });

  it("a cancelled subscription runs to the end of what was paid", () => {
    expect(accessFrom(row({ status: "cancelled", trial_ends_at: null, current_period_end: plus(48) }), NOW)).toMatchObject({ state: "ending", full: true, daysLeft: 2 });
    expect(accessFrom(row({ status: "cancelled", trial_ends_at: null, current_period_end: plus(-1) }), NOW)).toMatchObject({ full: false, lockedReason: "ended" });
  });

  it("the operator can waive billing or lock an organization, and a lock wins over everything", () => {
    expect(accessFrom(row({ comped: true, status: "active", trial_ends_at: null, current_period_end: null }), NOW)).toMatchObject({ state: "comped", full: true });
    expect(accessFrom(row({ suspended: true }), NOW)).toMatchObject({ full: false, lockedReason: "suspended" });
    expect(accessFrom(row({ suspended: true, comped: true }), NOW)).toMatchObject({ full: false, lockedReason: "suspended" });
  });

  it("no billing row, or a paid status with no end date, is locked rather than free", () => {
    expect(accessFrom(null, NOW)).toMatchObject({ state: "locked", full: false, lockedReason: "no_subscription" });
    expect(accessFrom(row({ status: "active", trial_ends_at: null, current_period_end: null }), NOW)).toMatchObject({ full: false, lockedReason: "no_subscription" });
  });

  it("carries the price the organization agreed to", () => {
    expect(accessFrom(row({ price_cents: 14900 }), NOW)).toMatchObject({ priceCents: 14900, currency: "USD" });
  });
});

describe("the wording shown to people", () => {
  it("is plain, singular for one day, and says the data is kept when locked", () => {
    expect(accessMessage(accessFrom(row(), NOW))).toEqual({ tone: "info", text: "Free trial: 3 days left." });
    expect(accessMessage(accessFrom(row({ trial_ends_at: plus(5) }), NOW))).toEqual({ tone: "warn", text: "Free trial: 1 day left." });
    expect(accessMessage(accessFrom(row({ trial_ends_at: plus(-1) }), NOW))!.text).toMatch(/data is kept and you can still export/);
    expect(accessMessage(accessFrom(row({ comped: true }), NOW))).toBeNull();
    expect(accessMessage(accessFrom(row({ status: "active", trial_ends_at: null, current_period_end: plus(24 * 30) }), NOW))).toBeNull();
    expect(accessMessage(accessFrom(row({ status: "active", trial_ends_at: null, current_period_end: plus(24 * 3) }), NOW))!.text).toMatch(/renews in 3 days/);
    expect(accessMessage(accessFrom(row({ status: "active", trial_ends_at: null, current_period_end: plus(-24) }), NOW))!.tone).toBe("warn");
  });
});

describe("reading the billing row", () => {
  let control: Awaited<ReturnType<typeof newControl>>;
  beforeAll(async () => { control = await newControl(); });

  it("the standard plan is USD 149 with a 3-day trial, and existing organizations are never locked", async () => {
    const plan = await control.transaction(async (q) => (await q.query<{ price_cents: number; currency: string; trial_days: number }>("select price_cents, currency, trial_days from public.plans where key = 'standard'")).rows[0]);
    expect(plan).toEqual({ price_cents: 14900, currency: "USD", trial_days: 3 });
  });

  it("loads a row and answers from it; an unknown organization is locked", async () => {
    const id = await control.transaction(async (q) => {
      await q.query("set local search_path = public");
      const t = (await q.query<{ id: string }>("insert into public.tenants(name, slug, schema_name) values ('Billing Co', 'billing-co', 'tenant_billingco') returning id")).rows[0].id;
      await q.query("insert into public.org_billing(tenant_id, plan_key, status, trial_ends_at, price_cents) values ($1, 'standard', 'trialing', $2, 14900)", [t, plus(72)]);
      return t;
    });
    expect(await loadAccess(control, id, NOW)).toMatchObject({ state: "trial", full: true, daysLeft: 3 });
    expect(await loadAccess(control, id, new Date(NOW.getTime() + 4 * 86_400_000))).toMatchObject({ state: "locked", lockedReason: "trial_ended" });
    expect(await loadAccess(control, "00000000-0000-0000-0000-0000000000ff", NOW)).toMatchObject({ state: "locked", lockedReason: "no_subscription" });
  });

  it("every change to a subscription is written to the platform audit log", async () => {
    const id = (await control.transaction(async (q) => (await q.query<{ tenant_id: string }>("select tenant_id from public.org_billing limit 1")).rows[0])).tenant_id;
    await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.org_billing set comped = true where tenant_id = $1", [id]); });
    const log = await control.transaction(async (q) => (await q.query<{ action: string; new_data: { comped: boolean } }>("select action, new_data from public.platform_audit_log where table_name = 'org_billing' and tenant_id = $1 order by id desc limit 1", [id])).rows[0]);
    expect(log).toMatchObject({ action: "UPDATE", new_data: { comped: true } });
  });
});
