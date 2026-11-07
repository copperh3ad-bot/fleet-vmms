// Tax on subscriptions for customers in Pakistan (ADR-017): what makes tax apply, the figures an invoice keeps, the customer's
// own details, withholding certificates, and the rule that no rate is built in.
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { secretBox } from "@/lib/crypto/secretbox";
import { routingDriver, type RoutingDriver } from "@/lib/db/router";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { getInvoice, listInvoices, submitClaim } from "@/lib/billing/payments";
import { confirmClaim, listClaimsForOperator, previewClaimTax, recordManualPayment } from "@/lib/billing/operator";
import { checkPlatformSetting, savePlatformSetting } from "@/lib/billing/settings";
import { getOrgTax, getTaxProfile, listCertificatesOwed, listTaxRules, quoteTax, recordCertificate, saveTaxProfile, saveTaxRule, setOrgWithholding } from "@/lib/billing/tax-data";
import { advanceProvisioning, type ProvisionDeps } from "@/lib/orgs/provision";
import { claimSignup, parseSignup, recordSignup } from "@/lib/orgs/signup";
import type { BlobStore } from "@/lib/jobcards/attachments";
import { farm, newControl, platformMigrations, stripExt, tenantMigrations } from "./helpers";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
const box = secretBox(randomBytes(32));
const OP = U(900), NOT_OP = U(901);
const today = () => new Date().toISOString().slice(0, 10);
const claim = (over: Record<string, unknown> = {}) => ({ amount: "149", currency: "USD", paid_on: today(), bank_reference: "TRX-9001", months: "1", ...over });
const noStore: BlobStore = { async put() {}, async remove() {}, async signedUrl() { return null; } };

let control: Awaited<ReturnType<typeof newControl>>;
let router: RoutingDriver;
let deps: ProvisionDeps;
let f: ReturnType<typeof farm>;

async function makeOrg(n: number, name: string): Promise<{ tenantId: string; schema: string; admin: Membership; requester: Membership }> {
  const email = `taxowner${n}@example.com`;
  await recordSignup(control, parseSignup({ org_name: name, contact_name: `Owner ${n}`, email, terms: "on" }));
  const t = (await claimSignup(control, { id: U(n), email, emailConfirmed: true }))!;
  expect((await advanceProvisioning(deps, t.tenantId)).state).toBe("ready");
  const base = { tenantId: t.tenantId, schema: t.schema, vehicleScope: "all" as const };
  await saveTaxProfile(router, { ...base, userId: U(n), role: "tenant_admin" }, { legal_name: `${name} Pvt Ltd`, ntn: "9999999-9", withholding_agent: false });          // an invoice needs the NTN (ADR-053)
  return { ...t, admin: { ...base, userId: U(n), role: "tenant_admin" }, requester: { ...base, userId: U(n + 500), role: "requester" } };
}
const set = (k: string, v: string) => savePlatformSetting(control, OP, k, v);
const profile = (over: Record<string, unknown> = {}) => ({ country: "PK", tax_rule_code: "PRA", legal_name: "Alpha Textiles Pvt Ltd", ntn: "1234567-8", strn: "", address: "Lahore", withholding_agent: false, ...over });

let A: Awaited<ReturnType<typeof makeOrg>>, B: Awaited<ReturnType<typeof makeOrg>>;

beforeAll(async () => {
  control = await newControl();
  f = farm();
  deps = { control, provider: f.provider(), openDb: f.open, box, platformMigrations: platformMigrations(), tenantMigrations: tenantMigrations(), transform: stripExt, connectRetries: { tries: 1, delayMs: 1 } };
  router = routingDriver({ control, makeDriver: f.open, decrypt: box.decrypt });
  await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("insert into public.platform_admins(user_id) values ($1)", [OP]); });
  A = await makeOrg(1, "Alpha Textiles");
  B = await makeOrg(2, "Bravo Foods");
});

const payAndConfirm = async (o: typeof A, over: Record<string, unknown> = {}, months?: number) => {
  const id = (await submitClaim(router, noStore, o.admin, claim({ bank_reference: `TRX-${Math.random().toString(36).slice(2, 8)}`, ...over }))).id;
  return { id, ...(await confirmClaim(control, OP, id, { months })) };
};
const lastInvoice = async (o: typeof A) => (await getInvoice(router, o.admin, (await listInvoices(router, o.admin))[0].id))!;

describe("nothing is taxed until it is set up", () => {
  it("a new platform has no rates, no registration and no rules, and an invoice carries no tax", async () => {
    expect(await listTaxRules(control, OP)).toEqual([]);
    await set("pkr_per_usd", "280");
    const { number } = await payAndConfirm(A);
    expect(number).toMatch(/^INV-\d{4}-\d{6}$/);
    expect((await lastInvoice(A)).tax).toBeNull();
    expect(await quoteTax(router, A.admin, 14900, "USD", 1)).toBeNull();
  });

  it("each missing piece alone keeps tax off: no seller registration, no exchange rate, no authority chosen, authority switched off", async () => {
    await saveTaxRule(control, OP, { code: "PRA", label: "Punjab", sales_tax_pct: "16", active: true });
    await saveTaxProfile(router, A.admin, profile());
    expect(await quoteTax(router, A.admin, 14900, "USD", 1)).toBeNull();                         // no seller registration yet
    await set("seller_tax_reg", "PRA-0099");
    await set("pkr_per_usd", "");
    expect(await quoteTax(router, A.admin, 14900, "USD", 1)).toBeNull();                         // no exchange rate
    await set("pkr_per_usd", "280");
    await saveTaxProfile(router, A.admin, profile({ tax_rule_code: "" }));
    await saveTaxRule(control, OP, { code: "SRB", label: "Sindh", sales_tax_pct: "13", active: true });
    expect(await quoteTax(router, A.admin, 14900, "USD", 1)).toBeNull();                         // two authorities in force and the customer has not said which (with one, it falls under it: ADR-053)
    await saveTaxRule(control, OP, { code: "SRB", label: "Sindh", sales_tax_pct: "13", active: false });
    await saveTaxProfile(router, A.admin, profile());
    await saveTaxRule(control, OP, { code: "PRA", label: "Punjab", sales_tax_pct: "16", active: false });
    expect(await quoteTax(router, A.admin, 14900, "USD", 1)).toBeNull();                         // that authority is off
    await saveTaxRule(control, OP, { code: "PRA", label: "Punjab", sales_tax_pct: "16", active: true });
    expect(await quoteTax(router, A.admin, 14900, "USD", 1)).not.toBeNull();
    expect(await quoteTax(router, A.admin, 14900, "EUR", 1)).toBeNull();                         // only dollar and rupee plans are taxed this way (ADR-052)
  });
});

describe("the operator's settings", () => {
  it("checks percents, the income tax base, and who may change them", async () => {
    expect(checkPlatformSetting("wht_income_pct_default", "4.5")).toBe("4.5");
    expect(checkPlatformSetting("wht_sales_share_pct_default", "0")).toBe("0");
    expect(() => checkPlatformSetting("wht_income_pct_default", "101")).toThrow(UserError);
    expect(() => checkPlatformSetting("wht_income_pct_default", "-3")).toThrow(UserError);
    expect(() => checkPlatformSetting("wht_income_base", "gross")).toThrow(UserError);
    expect(checkPlatformSetting("wht_income_base", "total")).toBe("total");
    await expect(listTaxRules(control, NOT_OP)).rejects.toThrow("Not allowed.");
    await expect(saveTaxRule(control, NOT_OP, { code: "XXX", label: "x y", sales_tax_pct: "5", active: true })).rejects.toThrow("Not allowed.");
    await expect(saveTaxRule(control, OP, { code: "bad code", label: "Nope", sales_tax_pct: "5", active: true })).rejects.toBeInstanceOf(UserError);
    await expect(saveTaxRule(control, OP, { code: "NEG", label: "Negative", sales_tax_pct: "-1", active: true })).rejects.toBeInstanceOf(UserError);
    await expect(saveTaxRule(control, OP, { code: "BIG", label: "Too big", sales_tax_pct: "101", active: true })).rejects.toBeInstanceOf(UserError);
  });
});

describe("the customer's own tax details", () => {
  it("only someone who manages billing may see or save them, and a registration needs a name and an NTN", async () => {
    await expect(getTaxProfile(router, A.requester)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveTaxProfile(router, A.requester, profile())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveTaxProfile(router, A.admin, profile({ legal_name: "", ntn: "" }))).rejects.toMatchObject({ fields: { legal_name: expect.any(String), ntn: expect.any(String) } });
    await expect(saveTaxProfile(router, A.admin, profile({ ntn: "12" }))).rejects.toBeInstanceOf(UserError);
    await expect(saveTaxProfile(router, A.admin, profile({ tax_rule_code: "NOPE" }))).rejects.toMatchObject({ fields: { tax_rule_code: expect.any(String) } });
    await saveTaxProfile(router, A.admin, profile());
    expect((await getTaxProfile(router, A.admin)).profile).toMatchObject({ tax_rule_code: "PRA", legal_name: "Alpha Textiles Pvt Ltd", ntn: "1234567-8", withholding_agent: false });
    expect((await getTaxProfile(router, A.admin)).rules.map((r) => r.code)).toEqual(["PRA"]);
  });

  it("one customer never sees or changes another's details", async () => {
    expect(JSON.stringify(await getTaxProfile(router, B.admin))).not.toContain("Alpha");          // B has its own details (a name and NTN from set-up), none of A's
    await saveTaxProfile(router, B.admin, profile({ tax_rule_code: "PRA", legal_name: "Bravo Foods Ltd", ntn: "7654321-0" }));
    expect((await getTaxProfile(router, A.admin)).profile?.legal_name).toBe("Alpha Textiles Pvt Ltd");
    expect(JSON.stringify(await getTaxProfile(router, A.admin))).not.toContain("Bravo");
    expect((await getOrgTax(control, OP, A.tenantId))?.legal_name).toBe("Alpha Textiles Pvt Ltd");
    await expect(getOrgTax(control, NOT_OP, A.tenantId)).rejects.toThrow("Not allowed.");
  });
});

describe("a tax invoice", () => {
  it("adds sales tax on top of the rupee price, keeps every figure and the details as they were, and later changes do not touch it", async () => {
    const q = await quoteTax(router, A.admin, 14900, "USD", 1);
    expect(q?.result).toMatchObject({ subtotalMinor: 4_172_000, salesTaxPct: 16, salesTaxMinor: 667_520, totalMinor: 4_839_520, netExpectedMinor: 4_839_520 });
    await payAndConfirm(A, { amount: "48395.2", currency: "PKR" });
    const inv = await lastInvoice(A);
    expect(inv.tax).toMatchObject({ pkr_per_usd: "280.0000", subtotal_minor: "4172000", sales_tax_pct: "16.00", sales_tax_minor: "667520", total_minor: "4839520", wht_income_minor: "0", wht_sales_minor: "0", certificate: null });
    expect(inv.tax?.snapshot).toMatchObject({ seller: { tax_reg: "PRA-0099" }, buyer: { legal_name: "Alpha Textiles Pvt Ltd", ntn: "1234567-8", authority_code: "PRA", withholding_agent: false } });
    // the law and the customer's details change; the invoice already issued does not
    await saveTaxRule(control, OP, { code: "PRA", label: "Punjab", sales_tax_pct: "5", active: true });
    await set("pkr_per_usd", "300");
    await saveTaxProfile(router, A.admin, profile({ legal_name: "Alpha Textiles (Renamed)" }));
    const again = await lastInvoice(A);
    expect(again.tax).toEqual(inv.tax);
    await expect(control.transaction(async (c) => { await c.query("set local search_path = public"); await c.query("update public.invoices set total_minor = 1 where id = $1", [inv.id]); })).rejects.toThrow(/cannot be changed/);
    await saveTaxRule(control, OP, { code: "PRA", label: "Punjab", sales_tax_pct: "16", active: true });
    await set("pkr_per_usd", "280");
    await saveTaxProfile(router, A.admin, profile());
  });

  it("pays for several months at once, and a manual payment is taxed the same way", async () => {
    await payAndConfirm(A, { months: "3", amount: "447" }, 3);
    expect((await lastInvoice(A)).tax).toMatchObject({ subtotal_minor: "12516000", sales_tax_minor: "2002560", total_minor: "14518560" });
    const r = await recordManualPayment(control, OP, A.tenantId, 1, "Cash at the office");
    expect(r.number).toMatch(/^INV-/);
    expect((await lastInvoice(A)).tax?.total_minor).toBe("4839520");
  });
});

describe("a customer that withholds", () => {
  it("keeps back tax, the operator sees what should arrive and whether the customer is short, and the invoice lists the certificate until it is held", async () => {
    await set("wht_income_pct_default", "8");
    await set("wht_sales_share_pct_default", "50");
    await saveTaxProfile(router, B.admin, profile({ tax_rule_code: "PRA", legal_name: "Bravo Foods Ltd", ntn: "7654321-0", withholding_agent: true }));
    const q = await quoteTax(router, B.admin, 14900, "USD", 1);
    expect(q?.result).toMatchObject({ totalMinor: 4_839_520, whtIncomeMinor: 333_760, whtSalesMinor: 333_760, netExpectedMinor: 4_172_000 });

    const sent = await submitClaim(router, noStore, B.admin, claim({ amount: "48395.2", currency: "PKR", bank_reference: "BRAVO-FULL" }));       // paid the whole total, did not withhold
    expect((await previewClaimTax(control, OP, sent.id))?.against).toEqual({ state: "over", diffMinor: 667_520 });
    await confirmClaim(control, OP, sent.id);
    const inv = await lastInvoice(B);
    expect(inv.tax).toMatchObject({ wht_income_minor: "333760", wht_sales_minor: "333760", net_expected_minor: "4172000", certificate: null });

    const owed = await listCertificatesOwed(control, OP);
    expect(owed.map((o) => o.number)).toContain(inv.number);
    expect(owed.find((o) => o.number === inv.number)).toMatchObject({ org_name: "Bravo Foods", wht_income_minor: "333760" });
    await expect(recordCertificate(control, OP, inv.id, { certificate_no: "", received_on: today() })).rejects.toBeInstanceOf(UserError);
    await expect(recordCertificate(control, OP, inv.id, { certificate_no: "WHT-77", received_on: "2999-01-01" })).rejects.toBeInstanceOf(UserError);
    await expect(recordCertificate(control, NOT_OP, inv.id, { certificate_no: "WHT-77", received_on: today() })).rejects.toThrow("Not allowed.");
    await recordCertificate(control, OP, inv.id, { certificate_no: "WHT-77", received_on: today() });
    expect((await listCertificatesOwed(control, OP)).map((o) => o.number)).not.toContain(inv.number);
    expect((await lastInvoice(B)).tax?.certificate).toMatchObject({ certificate_no: "WHT-77" });
  });

  it("a short payment is flagged, and a different percent for one customer overrides the default", async () => {
    await setOrgWithholding(control, OP, B.tenantId, { income_pct: "4.5", sales_share_pct: "100" });
    const q = await quoteTax(router, B.admin, 14900, "USD", 1);
    expect(q?.result).toMatchObject({ whtIncomeMinor: 187_740, whtSalesMinor: 667_520, netExpectedMinor: 3_984_260 });
    const sent = await submitClaim(router, noStore, B.admin, claim({ amount: "30000", currency: "PKR", bank_reference: "BRAVO-SHORT" }));
    expect((await previewClaimTax(control, OP, sent.id))?.against).toMatchObject({ state: "short" });
    await expect(setOrgWithholding(control, OP, B.tenantId, { income_pct: "150" })).rejects.toBeInstanceOf(UserError);
    await expect(setOrgWithholding(control, NOT_OP, B.tenantId, { income_pct: "5" })).rejects.toThrow("Not allowed.");
    await expect(setOrgWithholding(control, OP, U(1234), { income_pct: "5" })).rejects.toBeInstanceOf(UserError);
    await setOrgWithholding(control, OP, B.tenantId, {});                                                    // empty clears the override
    expect((await quoteTax(router, B.admin, 14900, "USD", 1))?.result.whtIncomeMinor).toBe(333_760);
    expect((await listClaimsForOperator(control, OP)).length).toBeGreaterThan(0);
  });

  it("income tax can be worked out on the total instead of the subtotal", async () => {
    await set("wht_income_base", "total");
    expect((await quoteTax(router, B.admin, 14900, "USD", 1))?.result.whtIncomeMinor).toBe(387_162);       // 8% of Rs 48,395.20
    await set("wht_income_base", "");
    expect((await quoteTax(router, B.admin, 14900, "USD", 1))?.result.whtIncomeMinor).toBe(333_760);
  });

  it("another customer's invoice and certificate are never visible", async () => {
    const mine = JSON.stringify(await listInvoices(router, A.admin));
    expect(mine).not.toContain("Bravo");
    const bravoInvoice = (await lastInvoice(B)).id;
    expect((await listInvoices(router, A.admin)).every((i) => i.id !== bravoInvoice)).toBe(true);
    expect(await getInvoice(router, A.admin, bravoInvoice)).toBeNull();
  });
});
