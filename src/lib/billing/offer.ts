// What is on sale, read from the plan in the database (CLAUDE.md rule 7: a price lives in `plans`, never in code).
import type { Driver } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";
import { billedMonths } from "@/lib/billing/months";

export type Offer = {
  planKey: string; priceCents: number; currency: string; trialDays: number;
  /** "$149" */ amount: string;
  /** "per month" */ per: string;
  /** Price of 12 months paid at once (one month free), ADR-057. */ yearly: string;
  /** What public pages say instead of the figure: the owner prices against a wage, and the exact amount is shown inside Billing. */ headline: string;
  /** Plain statements for the price box. */ points: string[];
};

/** What every public page except /pricing says about Pro instead of its figure (ADR-065). Basic's line is `Offer.headline`. */
export const PRO_HEADLINE = "One price for every fleet size";

const SYMBOL: Record<string, string> = { USD: "$", PKR: "Rs ", EUR: "€", GBP: "£" };

export function formatPrice(cents: number, currency: string): string {
  const whole = cents % 100 === 0;
  const n = (cents / 100).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  return SYMBOL[currency] ? `${SYMBOL[currency]}${n}` : `${n} ${currency}`;
}

export function offerFrom(plan: { key: string; limits: Record<string, number | undefined>; price_cents: number; currency: string; trial_days: number }): Offer {
  const l = plan.limits ?? {};
  return {
    planKey: plan.key, priceCents: plan.price_cents, currency: plan.currency, trialDays: plan.trial_days,
    amount: formatPrice(plan.price_cents, plan.currency), per: "per month, per company",
    yearly: formatPrice(plan.price_cents * billedMonths(12), plan.currency),
    headline: "The monthly wage of an unskilled labourer",
    points: [
      "Every core feature included",
      l.max_vehicles ? `Up to ${l.max_vehicles} vehicles` : "Any number of vehicles",
      l.max_users ? `Up to ${l.max_users} users` : "Any number of users",
      "Your data kept apart from every other company's",
      plan.trial_days > 0 ? `${plan.trial_days}-day free trial, no card needed` : "No trial",
      "Cancel any time",
    ],
  };
}

/** The standard plan, or null if it has no price (then sign-up is closed, not free). */
export function loadOffer(driver: Driver): Promise<Offer | null> {
  return withPlatform(driver, async (q) => {
    const p = (await q.query<{ key: string; limits: Record<string, number>; price_cents: number | null; currency: string; trial_days: number }>(
      "select key, limits, price_cents, currency, trial_days from public.plans where key = 'standard'")).rows[0];
    return p && p.price_cents !== null ? offerFrom({ ...p, price_cents: p.price_cents }) : null;
  });
}
