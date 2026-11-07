import { beforeAll, describe, expect, it } from "vitest";
import { confirmClaim, recordManualPayment } from "@/lib/billing/operator";
import { submitClaim } from "@/lib/billing/payments";
import { getTaxProfile, quoteTax, saveTaxProfile, saveTaxRule } from "@/lib/billing/tax-data";
import { OP, claim, harness, noStore } from "./billing-harness";

// ADR-053: no invoice without the customer's NTN; the one sales tax authority in force applies without the customer picking it; nobody withholds.
let h: Awaited<ReturnType<typeof harness>>;
const clearNtn = (tenantId: string) => h.control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.org_tax set ntn = null where tenant_id = $1", [tenantId]); });

beforeAll(async () => {
  h = await harness();
  await h.sellerReady();
});

describe("an invoice needs the customer's NTN", () => {
  it("refuses to confirm a payment until the customer has entered its NTN, and then issues the invoice", async () => {
    const o = await h.org("No Ntn Co", { country: "PK" });
    await clearNtn(o.tenantId);
    const filed = await submitClaim(h.router, noStore, o.admin, claim({ bank_reference: "NTN-1" }));
    await expect(confirmClaim(h.control, OP, filed.id)).rejects.toThrow(/has not entered its NTN/);
    await saveTaxProfile(h.router, o.admin, { country: "PK", legal_name: "No Ntn Co Pvt Ltd", ntn: "1234567-8", withholding_agent: false });
    await expect(confirmClaim(h.control, OP, filed.id)).resolves.toMatchObject({ number: expect.stringMatching(/^INV-/) });
  });

  it("applies to a payment recorded by hand too", async () => {
    const o = await h.org("Hand Pay Co", { country: "PK" });
    await clearNtn(o.tenantId);
    await expect(recordManualPayment(h.control, OP, o.tenantId, 1, "cash")).rejects.toThrow(/NTN/);
  });

  it("does not ask a customer abroad for one", async () => {
    const o = await h.org("Abroad Co", { country: "US" });
    await clearNtn(o.tenantId);
    await expect(recordManualPayment(h.control, OP, o.tenantId, 1, "wire")).resolves.toMatchObject({ number: expect.stringMatching(/^INV-/) });
  });

  it("asks for the name and the NTN together when a Pakistani customer saves its details", async () => {
    const o = await h.org("Form Co", { country: "PK" });
    await expect(saveTaxProfile(h.router, o.admin, { country: "PK", legal_name: "Form Co", ntn: "", withholding_agent: false })).rejects.toThrow(/NTN/);
    await expect(saveTaxProfile(h.router, o.admin, { legal_name: "", ntn: "1234567-8", withholding_agent: false })).rejects.toThrow(/registered company name/);
    await saveTaxProfile(h.router, o.admin, { country: "PK", legal_name: "Form Co Pvt Ltd", ntn: "1234567-8", address: "Karachi", withholding_agent: false });
    expect((await getTaxProfile(h.router, o.admin)).profile).toMatchObject({ legal_name: "Form Co Pvt Ltd", ntn: "1234567-8", withholding_agent: false });
  });
});

describe("a customer abroad", () => {
  it("saving its details without a country keeps its own country and asks for no NTN", async () => {
    const o = await h.org("Overseas Co", { country: "US" });
    await saveTaxProfile(h.router, o.admin, { legal_name: "Overseas Co LLC", withholding_agent: false });          // what the Billing form sends: no country
    const country = await h.control.transaction(async (q) => { await q.query("set local search_path = public"); return (await q.query<{ country: string }>("select country from public.org_tax where tenant_id = $1", [o.tenantId])).rows[0].country; });
    expect(country).toBe("US");
  });
});

describe("the one sales tax authority in force", () => {
  it("applies to a customer that picked none, at the rate the owner entered, and nothing is withheld", async () => {
    await saveTaxRule(h.control, OP, { code: "PRA", label: "Punjab", sales_tax_pct: "16", active: false });          // the set-up helper made one; only SRB is in force
    await saveTaxRule(h.control, OP, { code: "SRB", label: "Sindh Revenue Board", sales_tax_pct: "13", active: true });
    const o = await h.org("Sindh Co", { country: "PK", profile: { country: "PK", legal_name: "Sindh Co Pvt Ltd", ntn: "7654321-0", withholding_agent: false } });
    const q = await quoteTax(h.router, o.admin, 1000000, "PKR", 1);          // Rs 10,000
    expect(q?.result).toMatchObject({ salesTaxPct: 13, salesTaxMinor: 130000, totalMinor: 1130000, whtIncomeMinor: 0, whtSalesMinor: 0, netExpectedMinor: 1130000 });
    expect(q?.snapshot.buyer.authority).toBe("Sindh Revenue Board");
  });

  it("is not guessed when the owner has set up more than one", async () => {
    await saveTaxRule(h.control, OP, { code: "PRA", label: "Punjab", sales_tax_pct: "16", active: true });
    const o = await h.org("Undecided Co", { country: "PK", profile: { country: "PK", legal_name: "Undecided Co Pvt Ltd", ntn: "7654321-0", withholding_agent: false } });
    expect(await quoteTax(h.router, o.admin, 1000000, "PKR", 1)).toBeNull();
    await saveTaxRule(h.control, OP, { code: "PRA", label: "Punjab", sales_tax_pct: "16", active: false });
  });
});
