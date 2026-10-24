// Tax scenarios the owner configures (ADR-018): customers outside Pakistan pay no tax, Pakistan gets Pakistani tax, and the owner can
// add a country with its own rate.
import { beforeAll, describe, expect, it } from "vitest";
import { UserError } from "@/lib/master/service";
import { countryOptions, isCountryCode } from "@/lib/orgs/countries";
import { parseSignup } from "@/lib/orgs/signup";
import { listScenarios, resolveScenario, saveScenario } from "@/lib/billing/tax-scenarios";
import { quoteTax, getOrgTax, setOrgCountry, saveTaxProfile } from "@/lib/billing/tax-data";
import { fmtMinor } from "@/lib/billing/tax";
import { harness, NOT_OP, OP } from "./billing-harness";

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => { h = await harness(); await h.sellerReady("280"); });

const scenario = (over: Record<string, unknown> = {}) => ({ code: "AE_VAT", label: "UAE customers", priority: 50, countries: "AE", sales_tax_mode: "fixed", sales_tax_pct: "5", tax_name: "VAT", currency: "USD", withholding_allowed: false, seller_registration: "TRN-100", document_title: "Tax invoice", note: "", active: true, ...over });

describe("country at sign-up", () => {
  it("is a real country code, optional in the library and asked for in the form", () => {
    const base = { org_name: "Acme", contact_name: "Sara Khan", email: "a@b.com", terms: "on" };
    expect(parseSignup({ ...base, country: "pk" }).country).toBe("PK");
    expect(parseSignup(base).country).toBeUndefined();
    expect(() => parseSignup({ ...base, country: "ZZ" })).toThrow(UserError);
    expect(isCountryCode("US") && isCountryCode("PK") && isCountryCode("AE")).toBe(true);
    expect(countryOptions()[0]).toEqual(["PK", "Pakistan"]);
    expect(countryOptions().length).toBeGreaterThan(240);
    expect(new Set(countryOptions().map(([c]) => c)).size).toBe(countryOptions().length);
  });

  it("is kept with the customer's own tax record from its first moment", async () => {
    const c = await h.org("Abroad Ltd", { country: "US" });
    expect((await getOrgTax(h.control, OP, c.tenantId))?.country).toBe("US");
  });
});

describe("the shipped scenarios", () => {
  it("Pakistan is taxed by authority, everyone else is not, and a customer with no country is left alone as before", async () => {
    const [pk, other] = await h.control.transaction(async (q) => [await resolveScenario(q, "PK"), await resolveScenario(q, "US")]);
    expect(pk).toMatchObject({ code: "PK_DOMESTIC", sales_tax_mode: "authority", currency: "PKR", withholding_allowed: true });
    expect(other).toMatchObject({ code: "OUTSIDE_PK", sales_tax_mode: "none", currency: "USD", withholding_allowed: false });
    expect(await h.control.transaction((q) => resolveScenario(q, null))).toBeNull();
    expect(await h.control.transaction((q) => resolveScenario(q, "xx"))).toBeNull();
  });

  it("a customer outside Pakistan gets an invoice with no tax, in dollars, saying so", async () => {
    const c = await h.org("Overseas Fleet", { country: "US", profile: h.pk({ country: "US", tax_rule_code: "", withholding_agent: true }) });
    const q = await quoteTax(h.router, c.admin, 14900, "USD", 1);
    expect(q?.result).toMatchObject({ subtotalMinor: 14900, salesTaxMinor: 0, totalMinor: 14900, whtIncomeMinor: 0, whtSalesMinor: 0, netExpectedMinor: 14900 });   // even a "withholding" box ticked: nothing to withhold
    expect(q?.snapshot).toMatchObject({ currency: "USD", country: "US", fx: null, scenario: { code: "OUTSIDE_PK", mode: "none", title: "Invoice" } });
    await h.pay(c);
    const inv = await h.lastInvoice(c);
    expect(inv.tax).toMatchObject({ subtotal_minor: "14900", sales_tax_minor: "0", total_minor: "14900", wht_income_minor: "0" });
    expect(fmtMinor(inv.tax!.total_minor, inv.tax!.snapshot.currency ?? "PKR")).toBe("$149.00");
  });

  it("a customer in Pakistan is taxed as before, in rupees", async () => {
    const c = await h.org("Lahore Fleet", { country: "PK", profile: h.pk() });
    const q = await quoteTax(h.router, c.admin, 14900, "USD", 1);
    expect(q?.result).toMatchObject({ subtotalMinor: 4_172_000, salesTaxMinor: 667_520, totalMinor: 4_839_520 });
    expect(q?.snapshot).toMatchObject({ currency: "PKR", scenario: { code: "PK_DOMESTIC", mode: "authority", title: "Tax invoice" } });
  });

  it("a customer with no country is invoiced as it always was: no tax lines at all", async () => {
    const c = await h.org("Unknown Land Co", { profile: h.pk({ country: "" }) });
    expect(await quoteTax(h.router, c.admin, 14900, "USD", 1)).toBeNull();
    await h.pay(c);
    expect((await h.lastInvoice(c)).tax).toBeNull();
  });

  it("the operator corrects a customer's country, and the scenario follows", async () => {
    const c = await h.org("Mislabelled Ltd", { country: "US", profile: h.pk({ country: "" }) });
    expect((await quoteTax(h.router, c.admin, 14900, "USD", 1))?.snapshot.scenario?.code).toBe("OUTSIDE_PK");
    await setOrgCountry(h.control, OP, c.tenantId, "pk");
    expect((await quoteTax(h.router, c.admin, 14900, "USD", 1))?.snapshot.scenario?.code).toBe("PK_DOMESTIC");
    await expect(setOrgCountry(h.control, OP, c.tenantId, "Pakistan")).rejects.toBeInstanceOf(UserError);
    await expect(setOrgCountry(h.control, NOT_OP, c.tenantId, "PK")).rejects.toThrow("Not allowed.");
    await saveTaxProfile(h.router, c.admin, h.pk({ country: "" }));                                                              // saving details without a country does not erase it
    expect((await getOrgTax(h.control, OP, c.tenantId))?.country).toBe("PK");
  });
});

describe("the owner's own scenarios", () => {
  it("adds a country with its own rate, in dollars, and customers there are charged it", async () => {
    await saveScenario(h.control, OP, scenario());
    const c = await h.org("Dubai Haulage", { country: "AE", profile: h.pk({ country: "AE", tax_rule_code: "" }) });
    const q = await quoteTax(h.router, c.admin, 14900, "USD", 1);
    expect(q?.result).toMatchObject({ subtotalMinor: 14900, salesTaxMinor: 745, totalMinor: 15645 });                                 // 5% of $149.00 = $7.45
    expect(q?.snapshot).toMatchObject({ currency: "USD", seller: { tax_reg: "TRN-100" }, buyer: { authority: "VAT" }, scenario: { code: "AE_VAT", mode: "fixed" } });
    await h.pay(c, { amount: "156.45" });
    expect((await h.lastInvoice(c)).tax).toMatchObject({ sales_tax_minor: "745", total_minor: "15645" });
    expect((await listScenarios(h.control, OP)).map((s) => s.code)).toEqual(["PK_DOMESTIC", "AE_VAT", "OUTSIDE_PK"]);                  // by priority
  });

  it("withholding is only for scenarios that allow it", async () => {
    await saveScenario(h.control, OP, scenario({ code: "AE_VAT", withholding_allowed: true }));
    const c = await h.org("Dubai Withholder", { country: "AE", profile: h.pk({ country: "AE", tax_rule_code: "", withholding_agent: true }) });
    await h.set("wht_income_pct_default", "10");
    expect((await quoteTax(h.router, c.admin, 14900, "USD", 1))?.result).toMatchObject({ whtIncomeMinor: 1490, netExpectedMinor: 14155 });
    await saveScenario(h.control, OP, scenario({ withholding_allowed: false }));
    expect((await quoteTax(h.router, c.admin, 14900, "USD", 1))?.result.whtIncomeMinor).toBe(0);
    await h.set("wht_income_pct_default", "");
  });

  it("a taxed scenario that is not fully set up charges nothing rather than guessing", async () => {
    await saveScenario(h.control, OP, scenario({ code: "SA_VAT", label: "Saudi", countries: "SA", sales_tax_pct: "15", seller_registration: "TRN-9" }));
    const c = await h.org("Riyadh Fleet", { country: "SA", profile: h.pk({ country: "SA", tax_rule_code: "" }) });
    expect((await quoteTax(h.router, c.admin, 14900, "USD", 1))?.result.salesTaxMinor).toBe(2235);
    await h.control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.tax_scenarios set seller_registration = null where code = 'SA_VAT'"); });
    expect(await quoteTax(h.router, c.admin, 14900, "USD", 1)).toBeNull();
    await h.control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.tax_scenarios set seller_registration = 'TRN-9' where code = 'SA_VAT'"); });
  });

  it("the lowest priority number wins, a switched-off scenario is skipped, and a customer falls back to the one that matches everyone", async () => {
    await saveScenario(h.control, OP, scenario({ code: "AE_SPECIAL", label: "UAE special", priority: 5, sales_tax_pct: "0" }));
    expect((await h.control.transaction((q) => resolveScenario(q, "AE")))?.code).toBe("AE_SPECIAL");
    await saveScenario(h.control, OP, scenario({ code: "AE_SPECIAL", label: "UAE special", priority: 5, sales_tax_pct: "0", active: false }));
    expect((await h.control.transaction((q) => resolveScenario(q, "AE")))?.code).toBe("AE_VAT");
    await saveScenario(h.control, OP, scenario({ active: false }));
    expect((await h.control.transaction((q) => resolveScenario(q, "AE")))?.code).toBe("OUTSIDE_PK");
    await saveScenario(h.control, OP, scenario());
  });

  it("checks what it is given, and only an operator may change a scenario", async () => {
    await expect(saveScenario(h.control, NOT_OP, scenario())).rejects.toThrow("Not allowed.");
    await expect(saveScenario(h.control, OP, scenario({ code: "bad code" }))).rejects.toBeInstanceOf(UserError);
    await expect(saveScenario(h.control, OP, scenario({ countries: "UAE" }))).rejects.toMatchObject({ fields: { countries: expect.any(String) } });
    await expect(saveScenario(h.control, OP, scenario({ sales_tax_pct: "" }))).rejects.toMatchObject({ fields: { sales_tax_pct: expect.any(String) } });
    await expect(saveScenario(h.control, OP, scenario({ seller_registration: "" }))).rejects.toMatchObject({ fields: { seller_registration: expect.any(String) } });
    await expect(saveScenario(h.control, OP, scenario({ sales_tax_pct: "120" }))).rejects.toBeInstanceOf(UserError);
    await expect(saveScenario(h.control, OP, scenario({ code: "X_NONE", sales_tax_mode: "none", withholding_allowed: true, countries: "FR" }))).rejects.toMatchObject({ fields: { withholding_allowed: expect.any(String) } });
    await expect(saveScenario(h.control, OP, scenario({ code: "X_AUTH", sales_tax_mode: "authority", currency: "USD" }))).rejects.toMatchObject({ fields: { currency: expect.any(String) } });
    await expect(saveScenario(h.control, OP, scenario({ code: "X_MODE", sales_tax_mode: "weird" }))).rejects.toBeInstanceOf(UserError);
  });
});
