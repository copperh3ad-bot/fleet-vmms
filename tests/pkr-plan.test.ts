import { beforeAll, describe, expect, it } from "vitest";
import { setPlanPrice } from "@/lib/billing/plans";
import { quoteTax } from "@/lib/billing/tax-data";
import { confirmClaim, previewClaimTax } from "@/lib/billing/operator";
import { listInvoices, submitClaim } from "@/lib/billing/payments";
import { formatPrice } from "@/lib/billing/offer";
import { OP, harness, noStore } from "./billing-harness";

// ADR-052: the plan can be priced in rupees. Tax is then worked out straight from the rupee price: no dollar rate is involved, and the invoice is in rupees.
let h: Awaited<ReturnType<typeof harness>>;

beforeAll(async () => {
  h = await harness();
  await h.sellerReady();
  await setPlanPrice(h.control, OP, "standard", { price: "41500", currency: "PKR" });
});

describe("a plan priced in rupees", () => {
  it("shows as rupees, not dollars", () => {
    expect(formatPrice(4150000, "PKR")).toBe("Rs 41,500");
  });

  it("is taxed directly: sales tax on the rupee price, no conversion", async () => {
    const o = await h.org("Rupee Fleet", { country: "PK", profile: h.pk() });
    const q = await quoteTax(h.router, o.admin, 4150000, "PKR", 1);
    expect(q?.result).toMatchObject({ pkrPerUsd: 1, subtotalMinor: 4150000, salesTaxPct: 16, salesTaxMinor: 664000, totalMinor: 4814000, netExpectedMinor: 4814000 });
    expect(q?.snapshot.currency).toBe("PKR");
    expect(q?.snapshot.fx).toBeNull();
    expect((await quoteTax(h.router, o.admin, 4150000 * 3, "PKR", 1))?.result.totalMinor).toBe(4814000 * 3);
  });

  it("a customer that withholds keeps tax back from the rupee price", async () => {
    const o = await h.org("Withholding Fleet", { country: "PK", profile: h.pk({ withholding_agent: true }) });
    await h.control.transaction(async (c) => { await c.query("set local search_path = public"); await c.query("update public.org_tax set wht_income_pct = 4.5, wht_sales_share_pct = 0 where tenant_id = $1", [o.tenantId]); });
    const q = await quoteTax(h.router, o.admin, 4150000, "PKR", 1);
    expect(q?.result.whtIncomeMinor).toBe(186750);
    expect(q?.result.netExpectedMinor).toBe(4814000 - 186750);
  });

  it("issues the invoice in rupees when the payment is confirmed, with no dollar rate", async () => {
    const o = await h.org("Paying Fleet", { country: "PK", profile: h.pk() });
    const filed = await submitClaim(h.router, noStore, o.admin, { amount: "48140", currency: "PKR", paid_on: new Date().toISOString().slice(0, 10), bank_reference: "PKR-1", months: "1" });
    const pre = await previewClaimTax(h.control, OP, filed.id);
    expect(pre).toMatchObject({ currency: "PKR", totalMinor: 4814000, fx: null, against: { state: "exact" } });
    await confirmClaim(h.control, OP, filed.id);
    const inv = (await listInvoices(h.router, o.admin))[0];
    expect(inv).toMatchObject({ currency: "PKR", amount_cents: "4150000" });
    const full = await h.lastInvoice(o);
    expect(full.tax?.total_minor).toBe("4814000");
    expect(Number(full.tax?.pkr_per_usd)).toBe(1);          // no dollar rate was used
  });
});
