import { describe, it, expect } from "vitest";
import { billedMonths } from "@/lib/billing/months";

describe("yearly offer (ADR-057)", () => {
  it("charges the full price for fewer than 12 months", () => {
    for (let m = 1; m <= 11; m++) expect(billedMonths(m)).toBe(m);
  });
  it("gives one month free when 12 months are paid for", () => {
    expect(billedMonths(12)).toBe(11);
  });
  it("gives one free month per whole year", () => {
    expect(billedMonths(24)).toBe(22);
  });
});
