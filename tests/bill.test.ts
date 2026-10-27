// The bill emailed on "Request bill": amounts, reference, bank account, and everything from outside escaped.
import { describe, expect, it } from "vitest";
import { buildBillMail, billNumber } from "@/lib/billing/bill";
import { computeTax } from "@/lib/billing/tax";

const base = { to: "a@example.com", orgName: "Alpha <b>Fleet</b>", reference: "FVM-1234ABCD", date: "2026-10-28", priceText: "$149", seller: "Fleet OTG\nNTN 123", bankDetails: "HBL\nIBAN: PK00TEST", siteUrl: "https://www.fleetotg.com" };

describe("the bill", () => {
  it("has a number from the reference and the day", () => expect(billNumber("FVM-1234ABCD", "2026-10-28")).toBe("BILL-1234ABCD-20261028"));

  it("names the amount, the reference and the bank account, and escapes what a person typed", () => {
    const m = buildBillMail({ ...base, pkrEstimate: 41720 });
    expect(m.subject).toBe("Your Fleet OTG bill BILL-1234ABCD-20261028");
    expect(m.text).toContain("Payment reference: FVM-1234ABCD");
    expect(m.text).toContain("IBAN: PK00TEST");
    expect(m.text).toContain("Rs 41,720");
    expect(m.html).not.toContain("<b>Fleet</b>");
    expect(m.html).toContain("Alpha &lt;b&gt;Fleet&lt;/b&gt;");
  });

  it("with tax: subtotal, tax and the total to send", () => {
    const result = computeTax({ subtotalUsdCents: 14900, pkrPerUsd: 280, salesTaxPct: 16, whtIncomePct: 0, whtSalesSharePct: 0, whtIncomeBase: "subtotal", withholdingAgent: false });
    const m = buildBillMail({ ...base, tax: { result, currency: "PKR", authority: "PRA" } });
    expect(m.text).toContain("PRA 16%");
    expect(m.text).toContain("Total to send");
    expect(m.text).toContain("Send ");
  });
});
