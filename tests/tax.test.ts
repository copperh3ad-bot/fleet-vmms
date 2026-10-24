import { describe, expect, it } from "vitest";
import { computeTax, roundHalfUp, rupees, shortfall, type TaxInput } from "@/lib/billing/tax";

const base: TaxInput = { subtotalUsdCents: 14900, pkrPerUsd: 280, salesTaxPct: 0, withholdingAgent: false, whtIncomePct: 0, whtSalesSharePct: 0, whtIncomeBase: "subtotal" };

describe("working out tax on a subscription", () => {
  it("with no rates set there is no tax: the total is just the price in rupees", () => {
    expect(computeTax(base)).toEqual({ pkrPerUsd: 280, subtotalMinor: 4_172_000, salesTaxPct: 0, salesTaxMinor: 0, totalMinor: 4_172_000, whtIncomeMinor: 0, whtSalesMinor: 0, netExpectedMinor: 4_172_000 });
    expect(rupees(4_172_000)).toBe("Rs 41,720.00");
  });

  it("sales tax goes on top of the rupee price", () => {
    const r = computeTax({ ...base, salesTaxPct: 16 });
    expect(r.subtotalMinor).toBe(4_172_000);
    expect(r.salesTaxMinor).toBe(667_520);                     // 16% of Rs 41,720.00 = Rs 6,675.20
    expect(r.totalMinor).toBe(4_839_520);
    expect(r.netExpectedMinor).toBe(r.totalMinor);             // not a withholding agent: nothing is kept back
  });

  it("a withholding customer keeps back income tax on the subtotal and a share of the sales tax", () => {
    const r = computeTax({ ...base, salesTaxPct: 16, withholdingAgent: true, whtIncomePct: 8, whtSalesSharePct: 50 });
    expect(r.whtIncomeMinor).toBe(333_760);                    // 8% of Rs 41,720.00
    expect(r.whtSalesMinor).toBe(333_760);                     // half of Rs 6,675.20
    expect(r.netExpectedMinor).toBe(r.totalMinor - 333_760 - 333_760);
    expect(r.netExpectedMinor).toBe(4_172_000);
  });

  it("income tax can be taken on the total instead, when the accountant says so", () => {
    const r = computeTax({ ...base, salesTaxPct: 16, withholdingAgent: true, whtIncomePct: 10, whtIncomeBase: "total" });
    expect(r.whtIncomeMinor).toBe(483_952);                    // 10% of Rs 48,395.20
    expect(r.whtSalesMinor).toBe(0);
  });

  it("nothing is kept back unless the customer is a withholding agent, whatever the percentages", () => {
    const r = computeTax({ ...base, salesTaxPct: 16, withholdingAgent: false, whtIncomePct: 8, whtSalesSharePct: 100 });
    expect(r.whtIncomeMinor + r.whtSalesMinor).toBe(0);
  });

  it("every figure is a whole paisa that adds up, even with awkward rates and exchange rates", () => {
    for (const [cents, rate, tax, wht, share] of [[14900, 281.37, 15.5, 4.5, 33.3], [14900 * 3, 277.915, 13, 8, 100], [1, 280, 16, 8, 50], [0, 280, 16, 8, 50]] as const) {
      const r = computeTax({ subtotalUsdCents: cents, pkrPerUsd: rate, salesTaxPct: tax, withholdingAgent: true, whtIncomePct: wht, whtSalesSharePct: share, whtIncomeBase: "subtotal" });
      for (const v of [r.subtotalMinor, r.salesTaxMinor, r.totalMinor, r.whtIncomeMinor, r.whtSalesMinor, r.netExpectedMinor]) expect(Number.isInteger(v)).toBe(true);
      expect(r.totalMinor).toBe(r.subtotalMinor + r.salesTaxMinor);
      expect(r.netExpectedMinor).toBe(r.totalMinor - r.whtIncomeMinor - r.whtSalesMinor);
      expect(r.netExpectedMinor).toBeGreaterThanOrEqual(0);
    }
  });

  it("rounds half up, not to even and not down", () => {
    expect([roundHalfUp(0.5), roundHalfUp(1.5), roundHalfUp(2.5), roundHalfUp(2.4999), roundHalfUp(1.005 * 100)]).toEqual([1, 2, 3, 2, 101]);
  });

  it("ignores nonsense rates instead of charging them, and refuses to work without an exchange rate", () => {
    const r = computeTax({ ...base, salesTaxPct: -5, withholdingAgent: true, whtIncomePct: Number.NaN, whtSalesSharePct: 400 });
    expect(r.salesTaxMinor).toBe(0);
    expect(r.whtIncomeMinor).toBe(0);
    expect(() => computeTax({ ...base, pkrPerUsd: 0 })).toThrow(/rupees-per-dollar/);
    expect(() => computeTax({ ...base, subtotalUsdCents: 149.5 })).toThrow(/whole cents/);
  });

  it("compares what arrived with what should have, allowing a rupee for bank rounding", () => {
    expect(shortfall(4_172_000, 4_172_000)).toEqual({ state: "exact", diffMinor: 0 });
    expect(shortfall(4_171_950, 4_172_000).state).toBe("exact");
    expect(shortfall(3_838_240, 4_172_000)).toEqual({ state: "short", diffMinor: -333_760 });
    expect(shortfall(4_500_000, 4_172_000).state).toBe("over");
  });
});
