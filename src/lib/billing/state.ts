// What an organization may do, worked out from dates (ADR-014). Nothing has to run for a trial to end or a payment to
// fall late: the answer is a pure function of the billing row and the clock. A missing row is a locked organization,
// never a free one.
import type { Driver } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";

export type BillingRow = {
  status: "trialing" | "active" | "cancelled";
  trial_ends_at: string | null;
  current_period_end: string | null;
  grace_days: number;
  comped: boolean;
  suspended: boolean;
  price_cents: number;
  currency: string;
};

export type AccessState = "comped" | "trial" | "active" | "grace" | "ending" | "locked";
export type LockReason = "trial_ended" | "payment_overdue" | "ended" | "suspended" | "no_subscription";

export type Access = {
  state: AccessState;
  /** True when the organization may use the product normally. */
  full: boolean;
  lockedReason?: LockReason;
  /** Whole days until the trial ends, the paid period ends, or the grace period ends. Null when it does not apply. */
  daysLeft: number | null;
  /** When that moment is, ISO. */
  until: string | null;
  /** Milliseconds from now until a running free trial ends (for the live countdown); null in every other state. */
  trialMsLeft?: number | null;
  priceCents: number;
  currency: string;
};

const DAY = 86_400_000;
const days = (ms: number) => Math.ceil(ms / DAY);

export function accessFrom(row: BillingRow | null, now: Date = new Date()): Access {
  if (!row) return { state: "locked", full: false, lockedReason: "no_subscription", daysLeft: null, until: null, priceCents: 0, currency: "USD" };
  const base = { priceCents: row.price_cents, currency: row.currency };
  const t = now.getTime();
  const at = (s: string | null) => (s ? new Date(s).getTime() : NaN);
  if (row.suspended) return { ...base, state: "locked", full: false, lockedReason: "suspended", daysLeft: null, until: null };
  if (row.comped) return { ...base, state: "comped", full: true, daysLeft: null, until: null };
  if (row.status === "trialing") {
    const end = at(row.trial_ends_at);
    if (Number.isFinite(end) && t < end) return { ...base, state: "trial", full: true, daysLeft: days(end - t), until: row.trial_ends_at, trialMsLeft: end - t };
    return { ...base, state: "locked", full: false, lockedReason: "trial_ended", daysLeft: null, until: row.trial_ends_at };
  }
  const end = at(row.current_period_end);
  if (!Number.isFinite(end)) return { ...base, state: "locked", full: false, lockedReason: "no_subscription", daysLeft: null, until: null };
  if (row.status === "cancelled") {
    return t < end
      ? { ...base, state: "ending", full: true, daysLeft: days(end - t), until: row.current_period_end }
      : { ...base, state: "locked", full: false, lockedReason: "ended", daysLeft: null, until: row.current_period_end };
  }
  if (t < end) return { ...base, state: "active", full: true, daysLeft: days(end - t), until: row.current_period_end };
  const graceEnd = end + row.grace_days * DAY;
  if (t < graceEnd) return { ...base, state: "grace", full: true, daysLeft: days(graceEnd - t), until: new Date(graceEnd).toISOString() };
  return { ...base, state: "locked", full: false, lockedReason: "payment_overdue", daysLeft: null, until: new Date(graceEnd).toISOString() };
}

const COLUMNS = `status, trial_ends_at::text, current_period_end::text, grace_days, comped, suspended, price_cents, currency`;

/** Reads the organization's billing row from the control database and works out its access. */
export function loadAccess(driver: Driver, tenantId: string, now: Date = new Date()): Promise<Access> {
  return withPlatform(driver, async (q) => {
    const row = (await q.query<BillingRow>(`select ${COLUMNS} from public.org_billing where tenant_id = $1`, [tenantId])).rows[0];
    return accessFrom(row ?? null, now);
  });
}

/** What the person sees about it: short, plain, and the same wording everywhere. */
export function accessMessage(a: Access): { tone: "info" | "warn" | "bad"; text: string } | null {
  const left = (n: number | null) => (n === 1 ? "1 day" : `${n} days`);
  switch (a.state) {
    case "trial": return { tone: a.daysLeft! <= 1 ? "warn" : "info", text: `Free trial: ${left(a.daysLeft)} left.` };
    case "grace": return { tone: "warn", text: `Your subscription payment is overdue. Pay within ${left(a.daysLeft)} to keep using Fleet OTG.` };
    case "ending": return { tone: "info", text: `Your subscription ends in ${left(a.daysLeft)}.` };
    case "active": return a.daysLeft !== null && a.daysLeft <= 5 ? { tone: "info", text: `Your subscription renews in ${left(a.daysLeft)}. Pay before then to avoid a lock.` } : null;
    case "locked": return { tone: "bad", text: LOCK_TEXT[a.lockedReason ?? "no_subscription"] };
    default: return null;
  }
}

export const LOCK_TEXT: Record<LockReason, string> = {
  trial_ended: "Your free trial has ended. Subscribe to carry on. Your data is kept and you can still export it.",
  payment_overdue: "Your subscription payment is overdue and the grace period has ended. Pay to unlock. Your data is kept and you can still export it.",
  ended: "Your subscription has ended. Subscribe again to unlock. Your data is kept and you can still export it.",
  suspended: "This workspace has been locked. Contact support. Your data is kept and you can still export it.",
  no_subscription: "This workspace has no subscription yet. Contact support.",
};
