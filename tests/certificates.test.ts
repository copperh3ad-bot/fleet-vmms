// Withholding certificates issued through the application (ADR-018): who may issue one, what it carries, that it clears the "owed"
// list, that it cannot be edited, and that one company never reaches another's.
import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { CERTIFICATE_DISCLAIMER, getCertificateForInvoice, getCertificateForOperator, issueCertificate, listCertificates, voidCertificate } from "@/lib/billing/certificates";
import { listCertificatesOwed } from "@/lib/billing/tax-data";
import { harness, NOT_OP, OP, today, type Org } from "./billing-harness";

let h: Awaited<ReturnType<typeof harness>>;
let A: Org, B: Org, plain: Org, abroad: Org;
let invA: Awaited<ReturnType<typeof h.lastInvoice>>;

beforeAll(async () => {
  h = await harness();
  await h.sellerReady("280");
  await h.set("wht_income_pct_default", "8"); await h.set("wht_sales_share_pct_default", "50"); await h.set("wht_certificate_section", "Section 153 (test wording)");
  A = await h.org("Withholder A", { country: "PK", profile: h.pk({ legal_name: "Withholder A Pvt Ltd", withholding_agent: true }) });
  B = await h.org("Withholder B", { country: "PK", profile: h.pk({ legal_name: "Withholder B Pvt Ltd", withholding_agent: true }) });
  plain = await h.org("No Withholding", { country: "PK", profile: h.pk() });
  abroad = await h.org("Abroad", { country: "US", profile: h.pk({ country: "US", tax_rule_code: "" }) });
  for (const o of [A, B, plain, abroad]) await h.pay(o, { amount: "41720", currency: "PKR" });
  invA = await h.lastInvoice(A);
});

const deposit = { deposit_reference: "CPR-2026-0042", deposit_date: today() };

describe("issuing a certificate", () => {
  it("a customer that withheld tax gets a numbered certificate with the figures from its invoice", async () => {
    expect((await listCertificatesOwed(h.control, OP)).map((o) => o.number)).toContain(invA.number);
    const { number } = await issueCertificate(h.router, { kind: "customer", m: A.admin }, invA.id, { ...deposit, note: "October payment" });
    expect(number).toMatch(/^WHC-\d{4}-\d{6}$/);
    const c = (await getCertificateForInvoice(h.router, A.admin, invA.id))!;
    expect(c).toMatchObject({
      number, invoice_number: invA.number, issued_by_kind: "customer", status: "issued", currency: "PKR", gross_minor: "4172000", income_tax_pct: "8.00",
      income_tax_minor: "333760", sales_tax_minor: "333760", section: "Section 153 (test wording)", deposit_reference: "CPR-2026-0042", note: "October payment",
    });
    expect(c.agent).toMatchObject({ legal_name: "Withholder A Pvt Ltd", ntn: "1234567-8" });
    expect(c.payee).toMatchObject({ legal_name: "Test Seller", ntn: "1111111-1", tax_reg: "PRA-0001" });
    expect(CERTIFICATE_DISCLAIMER).toMatch(/does not replace any statement/);
  });

  it("issuing it also records the certificate on the invoice, so it is no longer owed", async () => {
    expect((await listCertificatesOwed(h.control, OP)).map((o) => o.number)).not.toContain(invA.number);
    expect((await h.lastInvoice(A)).tax?.certificate).toMatchObject({ certificate_no: expect.stringMatching(/^WHC-/) });
  });

  it("only one live certificate per invoice", async () => {
    await expect(issueCertificate(h.router, { kind: "customer", m: A.admin }, invA.id, deposit)).rejects.toThrow(/already been issued/);
    await expect(issueCertificate(h.router, { kind: "operator", operatorId: OP }, invA.id, {})).rejects.toThrow(/already been issued/);
  });

  it("a customer must say where the tax was deposited; the operator, issuing for a customer, may leave it out", async () => {
    const invB = await h.lastInvoice(B);
    await expect(issueCertificate(h.router, { kind: "customer", m: B.admin }, invB.id, {})).rejects.toMatchObject({ fields: { deposit_reference: expect.any(String) } });
    await expect(issueCertificate(h.router, { kind: "customer", m: B.admin }, invB.id, { deposit_reference: "CPR-1", deposit_date: "" })).rejects.toMatchObject({ fields: { deposit_date: expect.any(String) } });
    await expect(issueCertificate(h.router, { kind: "customer", m: B.admin }, invB.id, { deposit_reference: "CPR-1", deposit_date: "2999-01-01" })).rejects.toBeInstanceOf(UserError);
    await expect(issueCertificate(h.router, { kind: "customer", m: B.admin }, invB.id, { deposit_reference: "CP", deposit_date: today() })).rejects.toBeInstanceOf(UserError);
    const { number } = await issueCertificate(h.router, { kind: "operator", operatorId: OP }, invB.id, { note: "Issued at the customer's request" });
    const c = (await getCertificateForOperator(h.control, OP, (await listCertificates(h.control, OP)).find((x) => x.number === number)!.id))!;
    expect(c).toMatchObject({ issued_by_kind: "operator", deposit_reference: null, deposit_date: null });
  });

  it("nothing to certify when nothing was withheld, or the customer is outside Pakistan", async () => {
    await expect(issueCertificate(h.router, { kind: "customer", m: plain.admin }, (await h.lastInvoice(plain)).id, deposit)).rejects.toThrow(/nothing to certify/);
    await expect(issueCertificate(h.router, { kind: "customer", m: abroad.admin }, (await h.lastInvoice(abroad)).id, deposit)).rejects.toThrow(/nothing to certify/);
    await expect(issueCertificate(h.router, { kind: "operator", operatorId: OP }, "00000000-0000-0000-0000-000000000000", {})).rejects.toThrow(/not found/);
    await expect(issueCertificate(h.router, { kind: "operator", operatorId: OP }, "not-an-id", {})).rejects.toThrow(/not found/);
  });
});

describe("who may", () => {
  it("only someone who manages billing issues for a customer, and only an operator issues, lists or voids for the platform", async () => {
    const c = await h.org("Withholder C", { country: "PK", profile: h.pk({ withholding_agent: true }) });
    await h.pay(c, { amount: "41720", currency: "PKR" });
    const inv = await h.lastInvoice(c);
    await expect(issueCertificate(h.router, { kind: "customer", m: c.requester }, inv.id, deposit)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getCertificateForInvoice(h.router, c.requester, inv.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(issueCertificate(h.router, { kind: "operator", operatorId: NOT_OP }, inv.id, {})).rejects.toThrow("Not allowed.");
    await expect(listCertificates(h.control, NOT_OP)).rejects.toThrow("Not allowed.");
    await expect(voidCertificate(h.control, NOT_OP, inv.id, "not an operator")).rejects.toThrow("Not allowed.");
  });

  it("one company cannot issue for, read or see another company's invoice or certificate", async () => {
    const invB = await h.lastInvoice(B);
    const spare = await h.org("Withholder D", { country: "PK", profile: h.pk({ withholding_agent: true }) });
    await h.pay(spare, { amount: "41720", currency: "PKR" });
    const invD = await h.lastInvoice(spare);
    await expect(issueCertificate(h.router, { kind: "customer", m: A.admin }, invD.id, deposit)).rejects.toThrow(/not found/);        // A tries to certify D's invoice
    expect(await getCertificateForInvoice(h.router, A.admin, invB.id)).toBeNull();                                                      // A reads B's certificate
    expect(await getCertificateForInvoice(h.router, spare.admin, invA.id)).toBeNull();
    expect((await listCertificatesOwed(h.control, OP)).map((o) => o.number)).toContain(invD.number);                                    // D's was not touched
  });
});

describe("a certificate is fixed once issued", () => {
  it("the database refuses to edit or delete it; only voiding changes", async () => {
    const live = (await listCertificates(h.control, OP)).find((c) => c.status === "issued")!;
    const run = (sql: string) => h.control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query(sql, [live.id]); });
    await expect(run("update public.wht_certificates set income_tax_minor = 1 where id = $1")).rejects.toThrow(/cannot be edited/);
    await expect(run("update public.wht_certificates set agent = '{}'::jsonb where id = $1")).rejects.toThrow(/cannot be edited/);
    await expect(run("delete from public.wht_certificates where id = $1")).rejects.toThrow(/cannot be deleted/);
  });

  it("voiding it makes the tax owed again, and a replacement can be issued; a void one cannot be changed", async () => {
    const mine = (await listCertificates(h.control, OP)).find((c) => c.invoice_id === invA.id)!;
    await expect(voidCertificate(h.control, OP, mine.id, "")).rejects.toThrow(/Say why/);
    await voidCertificate(h.control, OP, mine.id, "Wrong deposit reference");
    expect(await getCertificateForInvoice(h.router, A.admin, invA.id)).toBeNull();
    expect((await getCertificateForOperator(h.control, OP, mine.id))).toMatchObject({ status: "void", void_reason: "Wrong deposit reference" });
    expect((await listCertificatesOwed(h.control, OP)).map((o) => o.number)).toContain(invA.number);
    await expect(voidCertificate(h.control, OP, mine.id, "again")).rejects.toThrow(/not live/);
    await expect(h.control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.wht_certificates set void_reason = 'changed' where id = $1", [mine.id]); })).rejects.toThrow(/void certificate cannot be changed/);
    const next = await issueCertificate(h.router, { kind: "customer", m: A.admin }, invA.id, { deposit_reference: "CPR-2026-0099", deposit_date: today() });
    expect(next.number).not.toBe(mine.number);
    expect((await getCertificateForInvoice(h.router, A.admin, invA.id))?.deposit_reference).toBe("CPR-2026-0099");
    expect((await listCertificatesOwed(h.control, OP)).map((o) => o.number)).not.toContain(invA.number);
  });
});
