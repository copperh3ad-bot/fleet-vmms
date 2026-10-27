// Paying by bank transfer (ADR-014): the customer files a claim with a receipt; the operator confirms or rejects it.
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { secretBox } from "@/lib/crypto/secretbox";
import { routingDriver, type RoutingDriver } from "@/lib/db/router";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { loadAccess } from "@/lib/billing/state";
import { getInvoice, listClaims, listInvoices, paymentReference, submitClaim } from "@/lib/billing/payments";
import { confirmClaim, deleteOrganization, extendTrial, getOrganization, isOperator, listClaimsForOperator, listOrganizations, proofLink, recordManualPayment, rejectClaim, setComped, setSuspended } from "@/lib/billing/operator";
import { checkPlatformSetting, loadPlatformSettings, savePlatformSetting } from "@/lib/billing/settings";
import { advanceProvisioning, type ProvisionDeps } from "@/lib/orgs/provision";
import { claimSignup, parseSignup, recordSignup } from "@/lib/orgs/signup";
import type { BlobStore } from "@/lib/jobcards/attachments";
import { requestBill } from "@/lib/billing/request-details";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { farm, newControl, platformMigrations, stripExt, tenantMigrations } from "./helpers";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
const box = secretBox(randomBytes(32));
const OP = U(900), NOT_OP = U(901);
const pdf = () => Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 1, 2, 3]);
const claim = (over: Record<string, unknown> = {}) => ({ amount: "149", currency: "USD", paid_on: new Date().toISOString().slice(0, 10), bank_reference: "TRX-12345", months: "1", ...over });

function fakeStore() {
  const files = new Map<string, Uint8Array>();
  const store: BlobStore = {
    async put(p, b) { files.set(p, b); }, async remove(p) { files.delete(p); },
    async signedUrl(p) { return files.has(p) ? `https://signed.example/${p}` : null; },
  };
  return { store, files };
}

let control: Awaited<ReturnType<typeof newControl>>;
let router: RoutingDriver;
let deps: ProvisionDeps;
let f: ReturnType<typeof farm>;
const provider = () => deps.provider as ReturnType<ReturnType<typeof farm>["provider"]>;

async function makeOrg(n: number, name: string): Promise<{ tenantId: string; schema: string; admin: Membership; requester: Membership; slug: string }> {
  const email = `owner${n}@example.com`;
  await recordSignup(control, parseSignup({ org_name: name, contact_name: `Owner ${n}`, email, terms: "on" }));
  const t = (await claimSignup(control, { id: U(n), email, emailConfirmed: true }))!;
  expect((await advanceProvisioning(deps, t.tenantId)).state).toBe("ready");
  const slug = (await control.transaction(async (q) => (await q.query<{ slug: string }>("select slug from public.tenants where id = $1", [t.tenantId])).rows[0])).slug;
  const base = { tenantId: t.tenantId, schema: t.schema, vehicleScope: "all" as const };
  return { ...t, slug, admin: { ...base, userId: U(n), role: "tenant_admin" }, requester: { ...base, userId: U(n + 500), role: "requester" } };
}

let a: Awaited<ReturnType<typeof makeOrg>>;
let b: Awaited<ReturnType<typeof makeOrg>>;

beforeAll(async () => {
  control = await newControl();
  f = farm();
  deps = { control, provider: f.provider(), openDb: f.open, box, platformMigrations: platformMigrations(), tenantMigrations: tenantMigrations(), transform: stripExt, connectRetries: { tries: 1, delayMs: 1 } };
  router = routingDriver({ control, makeDriver: f.open, decrypt: box.decrypt });
  await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("insert into public.platform_admins(user_id) values ($1)", [OP]); });
  a = await makeOrg(1, "Alpha Fleet");
  b = await makeOrg(2, "Bravo Fleet");
});

describe("who is an operator", () => {
  it("only people in platform_admins", async () => {
    expect(await isOperator(control, OP)).toBe(true);
    expect(await isOperator(control, NOT_OP)).toBe(false);
    for (const fn of [() => listOrganizations(control, NOT_OP), () => listClaimsForOperator(control, NOT_OP), () => confirmClaim(control, NOT_OP, U(1)), () => rejectClaim(control, NOT_OP, U(1), "why not"), () => extendTrial(control, NOT_OP, a.tenantId, 3), () => setSuspended(control, NOT_OP, a.tenantId, true), () => setComped(control, NOT_OP, a.tenantId, true), () => recordManualPayment(control, NOT_OP, a.tenantId, 1, "cash"), () => getOrganization(control, NOT_OP, a.tenantId)])
      await expect(fn()).rejects.toThrow("Not allowed.");
  });
});

describe("the customer files a claim", () => {
  it("the reference to write on the transfer is short and fixed", () => {
    expect(paymentReference("12345678-aaaa-bbbb-cccc-1234567890ab")).toBe("FVM-12345678");
  });

  it("only the administrator, and each field is checked", async () => {
    const { store } = fakeStore();
    await expect(submitClaim(router, store, a.requester, claim())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listClaims(router, a.requester)).rejects.toBeInstanceOf(ForbiddenError);
    const bad = await submitClaim(router, store, a.admin, claim({ amount: "", currency: "EUR", paid_on: "2999-01-01", bank_reference: "", months: "13" })).catch((e) => e);
    expect(Object.keys(bad.fields).sort()).toEqual(["amount", "bank_reference", "currency", "months", "paid_on"]);
    expect((await submitClaim(router, store, a.admin, claim({ paid_on: "2020-01-01" })).catch((e) => e)).fields.paid_on).toMatch(/too long ago/);
    expect((await submitClaim(router, store, a.admin, claim({ amount: "-5" })).catch((e) => e)).fields.amount).toBeTruthy();
  });

  it("a receipt must be a photo or PDF under 4 MB, is stored in the organization's own folder, and a rejected claim leaves no file behind", async () => {
    const { store, files } = fakeStore();
    await expect(submitClaim(router, store, a.admin, claim(), { name: "x.exe", bytes: pdf() })).rejects.toThrow(/photo.*or a PDF/);
    await expect(submitClaim(router, store, a.admin, claim(), { name: "big.pdf", bytes: new Uint8Array(5 * 1024 * 1024) })).rejects.toThrow(/larger than 4 MB/);
    expect(files.size).toBe(0);
    const ok = await submitClaim(router, store, a.admin, claim({ note: "from HBL" }), { name: "receipt 1.pdf", bytes: pdf() });
    expect([...files.keys()].every((p) => p.startsWith(`${a.schema}/billing/`))).toBe(true);
    expect(files.size).toBe(1);
    // one waiting at a time; the second attempt removes its own file
    await expect(submitClaim(router, store, a.admin, claim({ bank_reference: "TRX-2" }), { name: "r2.pdf", bytes: pdf() })).rejects.toThrow(/already have a payment waiting/);
    expect(files.size).toBe(1);
    expect((await listClaims(router, a.admin)).map((c) => [c.id, c.status, c.has_proof, c.amount_minor])).toEqual([[ok.id, "pending", true, "14900"]]);
    expect(await listClaims(router, b.admin)).toEqual([]);                                           // another organization sees none of it
  });
});

describe("the operator decides", () => {
  it("lists what is waiting with the details needed to match the bank statement, and gives a link to the receipt", async () => {
    const { store, files } = fakeStore();
    await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("delete from public.payment_claims where tenant_id = $1", [b.tenantId]); });
    const c = await submitClaim(router, store, b.admin, claim({ currency: "PKR", amount: "41720", bank_reference: "IBFT-889", months: "1" }), { name: "slip.pdf", bytes: pdf() });
    const waiting = (await listClaimsForOperator(control, OP)).find((x) => x.id === c.id)!;
    expect(waiting).toMatchObject({ org_name: "Bravo Fleet", amount_minor: "4172000", currency: "PKR", bank_reference: "IBFT-889", months: 1, has_proof: true, price_cents: 14900, billing_currency: "USD", reference_code: paymentReference(b.tenantId) });
    expect(await proofLink(control, store, OP, c.id)).toBe(`https://signed.example/${[...files.keys()][0]}`);
    await expect(proofLink(control, store, NOT_OP, c.id)).rejects.toThrow("Not allowed.");
    await rejectClaim(control, OP, c.id, "The amount does not match our statement");   // leave Bravo free for the next test
  });

  it("confirming a payment on a trial: the organization is active for a month, an invoice is issued, and it is logged under the operator's name", async () => {
    const { store } = fakeStore();
    const c = await submitClaim(router, store, a.admin, claim({ note: "" }) /* a's first claim is still waiting from above */).catch(() => null);
    expect(c).toBeNull();
    const waiting = (await listClaimsForOperator(control, OP)).find((x) => x.tenant_id === a.tenantId)!;
    const done = await confirmClaim(control, OP, waiting.id, { note: "Seen in HBL statement" });
    expect(done.number).toMatch(/^INV-\d{4}-\d{6}$/);
    const access = await loadAccess(control, a.tenantId);
    expect(access).toMatchObject({ state: "active", full: true });
    expect(access.daysLeft).toBeGreaterThanOrEqual(30); expect(access.daysLeft).toBeLessThanOrEqual(31);

    const [inv] = await listInvoices(router, a.admin);
    expect(inv).toMatchObject({ number: done.number, months: 1, amount_cents: "14900", currency: "USD" });
    expect(await getInvoice(router, a.admin, inv.id)).toMatchObject({ billed_to: "Alpha Fleet", received_minor: "14900", received_currency: "USD" });
    expect(await getInvoice(router, b.admin, inv.id)).toBeNull();                                      // another organization cannot open it
    expect(await getInvoice(router, a.admin, "not-an-id")).toBeNull();
    expect((await listClaims(router, a.admin))[0]).toMatchObject({ status: "confirmed", invoice_id: inv.id });

    const log = await control.transaction(async (q) => (await q.query<{ actor_id: string }>("select actor_id from public.platform_audit_log where table_name = 'org_billing' and tenant_id = $1 order by id desc limit 1", [a.tenantId])).rows[0]);
    expect(log.actor_id).toBe(OP);
    await expect(confirmClaim(control, OP, waiting.id)).rejects.toThrow(/already been decided/);           // once
    await expect(control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.invoices set amount_cents = 1"); })).rejects.toThrow(/cannot be changed/);
  });

  it("the next payment runs on from the end of the paid period, not from today, and months can be corrected", async () => {
    const { store } = fakeStore();
    const before = (await loadAccess(control, a.tenantId)).until!;
    const c = await submitClaim(router, store, a.admin, claim({ amount: "447", months: "1", bank_reference: "TRX-3" }));
    const done = await confirmClaim(control, OP, c.id, { months: 3 });                                  // they sent three months' worth
    const after = (await loadAccess(control, a.tenantId)).until!;
    const diffDays = Math.round((new Date(after).getTime() - new Date(before).getTime()) / 86_400_000);
    expect(diffDays).toBeGreaterThanOrEqual(89); expect(diffDays).toBeLessThanOrEqual(92);
    expect((await listInvoices(router, a.admin))[0]).toMatchObject({ number: done.number, months: 3, amount_cents: "44700" });
    await expect(confirmClaim(control, OP, (await submitClaim(router, store, a.admin, claim({ bank_reference: "TRX-4" }))).id, { months: 13 })).rejects.toThrow(/between 1 and 12/);
  });

  it("a payment after the grace period unlocks the organization, counted from today", async () => {
    const { store } = fakeStore();
    await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.org_billing set current_period_end = now() - interval '20 days' where tenant_id = $1", [a.tenantId]); });
    expect(await loadAccess(control, a.tenantId)).toMatchObject({ state: "locked", lockedReason: "payment_overdue" });
    const waiting = (await listClaimsForOperator(control, OP)).filter((x) => x.tenant_id === a.tenantId);
    for (const w of waiting) await rejectClaim(control, OP, w.id, "Replaced by a new transfer");
    const c = await submitClaim(router, store, a.admin, claim({ bank_reference: "TRX-LATE" }));
    await confirmClaim(control, OP, c.id);
    const access = await loadAccess(control, a.tenantId);
    expect(access).toMatchObject({ state: "active", full: true });
    expect(access.daysLeft).toBeGreaterThanOrEqual(30);                                                  // from today, not from the old date
  });

  it("rejecting needs a reason, can happen once, and lets the customer try again", async () => {
    const { store } = fakeStore();
    const c = await submitClaim(router, store, b.admin, claim({ bank_reference: "WRONG" }));
    await expect(rejectClaim(control, OP, c.id, "  ")).rejects.toThrow(/Say why/);
    await rejectClaim(control, OP, c.id, "Reference does not appear on our statement");
    await expect(rejectClaim(control, OP, c.id, "again")).rejects.toThrow(/already been decided/);
    expect((await listClaims(router, b.admin))[0]).toMatchObject({ status: "rejected", decision_note: "Reference does not appear on our statement" });
    expect((await listClaimsForOperator(control, OP, "rejected")).map((x) => x.id)).toContain(c.id);
    await expect(submitClaim(router, store, b.admin, claim({ bank_reference: "RIGHT" }))).resolves.toBeTruthy();
    expect(await loadAccess(control, b.tenantId)).toMatchObject({ state: "trial" });                      // a rejected claim changes nothing
  });
});

describe("the operator's other controls", () => {
  it("records a payment by hand and extends only trials", async () => {
    await expect(extendTrial(control, OP, a.tenantId, 3)).rejects.toThrow(/only an organization on a trial/i);
    await expect(extendTrial(control, OP, b.tenantId, 0)).rejects.toThrow(/between 1 and 60/);
    const before = (await loadAccess(control, b.tenantId)).daysLeft!;
    await extendTrial(control, OP, b.tenantId, 4);
    expect((await loadAccess(control, b.tenantId)).daysLeft).toBe(before + 4);
    await expect(recordManualPayment(control, OP, b.tenantId, 1, " ")).rejects.toThrow(/how it was paid/);
    const paid = await recordManualPayment(control, OP, b.tenantId, 2, "Cash at the office, receipt 55");
    expect(paid.number).toMatch(/^INV-/);
    expect(await loadAccess(control, b.tenantId)).toMatchObject({ state: "active" });
    expect((await listInvoices(router, b.admin)).find((i) => i.number === paid.number)).toMatchObject({ months: 2, amount_cents: "29800" });
    await expect(recordManualPayment(control, OP, U(9999), 1, "cash")).rejects.toThrow(/no billing record/);
  });

  it("suspending locks, and comping waives billing, and both are reversible", async () => {
    await setSuspended(control, OP, b.tenantId, true);
    expect(await loadAccess(control, b.tenantId)).toMatchObject({ full: false, lockedReason: "suspended" });
    await setSuspended(control, OP, b.tenantId, false);
    expect((await loadAccess(control, b.tenantId)).full).toBe(true);
    await setComped(control, OP, b.tenantId, true);
    expect(await loadAccess(control, b.tenantId)).toMatchObject({ state: "comped" });
    await setComped(control, OP, b.tenantId, false);
    expect((await loadAccess(control, b.tenantId)).state).toBe("active");
  });

  it("lists organizations with their state and never a connection string", async () => {
    const orgs = await listOrganizations(control, OP);
    const alpha = orgs.find((o) => o.slug === a.slug)!;
    expect(alpha).toMatchObject({ name: "Alpha Fleet", db_kind: "dedicated", provision_state: "ready", access: { state: "active" } });
    expect(JSON.stringify(orgs)).not.toMatch(/db_url|postgres/i);
    expect(alpha.members).toBe(1);
  });
});

describe("deleting an organization's database", () => {
  it("needs the typed phrase, an organization with no access, and removes the database, logins and routes but keeps invoices", async () => {
    const c = await makeOrg(3, "Gamma Fleet");
    await expect(deleteOrganization(control, deps.provider, OP, c.tenantId, "delete gamma-fleet")).rejects.toThrow(/Type exactly: DELETE gamma-fleet/);
    await expect(deleteOrganization(control, deps.provider, OP, c.tenantId, `DELETE ${c.slug}`)).rejects.toThrow(/still has access/);
    // a paid-up organization is not deleted even if the operator suspends it by mistake in the same breath: suspension is what allows it,
    // so the operator must choose to do both, on purpose.
    await recordManualPayment(control, OP, c.tenantId, 1, "test invoice that must survive");
    await setSuspended(control, OP, c.tenantId, true);
    await router.transaction(async (q) => { await q.query("select 1"); }, { schema: c.schema });          // its database answers before
    const ref = (await control.transaction(async (q) => (await q.query<{ db_ref: string }>("select db_ref from public.tenants where id = $1", [c.tenantId])).rows[0])).db_ref;
    expect(provider().destroyed).toEqual([]);

    await deleteOrganization(control, deps.provider, OP, c.tenantId, `DELETE ${c.slug}`);
    expect(provider().destroyed).toEqual([ref]);
    const t = await control.transaction(async (q) => (await q.query("select status, db_url_enc, provision_state from public.tenants where id = $1", [c.tenantId])).rows[0]);
    expect(t).toEqual({ status: "closed", db_url_enc: null, provision_state: "failed" });
    expect(await control.transaction(async (q) => (await q.query("select 1 from public.user_orgs where tenant_id = $1", [c.tenantId])).rows)).toEqual([]);
    expect(await control.transaction(async (q) => (await q.query("select number from public.invoices where tenant_id = $1", [c.tenantId])).rows)).toHaveLength(1);   // the record stays
    await expect(deleteOrganization(control, deps.provider, OP, c.tenantId, `DELETE ${c.slug}`)).rejects.toThrow(/already deleted/);
    await expect(deleteOrganization(control, deps.provider, NOT_OP, c.tenantId, `DELETE ${c.slug}`)).rejects.toThrow("Not allowed.");
  });

  it("an organization on the shared database cannot be removed from here", async () => {
    const id = await control.transaction(async (q) => {
      await q.query("set local search_path = public");
      const t = (await q.query<{ id: string }>("insert into public.tenants(name, slug, schema_name) values ('Shared Co', 'shared-co', 'tenant_sharedco') returning id")).rows[0].id;
      await q.query("insert into public.org_billing(tenant_id, plan_key, status, price_cents, suspended) values ($1, 'legacy', 'active', 0, true)", [t]);
      return t;
    });
    await expect(deleteOrganization(control, deps.provider, OP, id, "DELETE shared-co")).rejects.toThrow(/shares the main database/);
  });
});

describe("what the operator edits", () => {
  it("settings are validated, saved with the operator's name, and cleared by saving nothing", async () => {
    expect(() => checkPlatformSetting("nope", "x")).toThrow(/Unknown setting/);
    expect(() => checkPlatformSetting("pkr_per_usd", "abc")).toThrow(/number/);
    expect(() => checkPlatformSetting("pkr_per_usd", "0")).toThrow(/number/);
    expect(() => checkPlatformSetting("support_email", "not an email")).toThrow(/valid email/);
    expect(() => checkPlatformSetting("billing_email", "not an email")).toThrow(/valid email/);
    expect(() => checkPlatformSetting("sales_email", "not an email")).toThrow(/valid email/);
    expect(checkPlatformSetting("billing_email", " finance@fleetotg.com ")).toBe("finance@fleetotg.com");
    expect(checkPlatformSetting("sales_email", "")).toBe("");
    expect(() => checkPlatformSetting("bank_details", "x".repeat(801))).toThrow(/too long/);
    expect(checkPlatformSetting("pkr_per_usd", " 280.5 ")).toBe("280.5");
    await savePlatformSetting(control, OP, "bank_details", "HBL\r\nAccount 123\n");
    await savePlatformSetting(control, OP, "pkr_per_usd", "280.5");
    expect(await loadPlatformSettings(control)).toMatchObject({ bank_details: "HBL\nAccount 123", pkr_per_usd: "280.5" });
    await savePlatformSetting(control, OP, "pkr_per_usd", "");
    expect((await loadPlatformSettings(control)).pkr_per_usd).toBeUndefined();
    const log = await control.transaction(async (q) => (await q.query<{ actor_id: string }>("select actor_id from public.platform_audit_log where table_name = 'platform_settings' order by id desc limit 1")).rows[0]);
    expect(log.actor_id).toBe(OP);
  });
});

describe("the customer requests a bill", () => {
  it("only the administrator; the bill with the bank details goes to the asker, a copy without them to the Billing mailbox; limited; nothing without bank details", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "mail-")), "out.jsonl");
    const saved = { u: process.env.SMTP_URL, f: process.env.EMAIL_FROM, a: process.env.ALLOW_FILE_MAILER };
    process.env.SMTP_URL = `file:${out}`; process.env.EMAIL_FROM = "Fleet OTG <noreply@example.com>"; process.env.ALLOW_FILE_MAILER = "1";
    try {
      const admin = { ...a.admin, tenantName: "Alpha Fleet", billing: await loadAccess(control, a.tenantId) };
      await expect(requestBill(router, { ...a.requester, billing: admin.billing }, "r@example.com")).rejects.toBeInstanceOf(ForbiddenError);
      await savePlatformSetting(control, OP, "bank_details", "");
      await expect(requestBill(router, admin, "owner1@example.com")).rejects.toThrow(/cannot send a bill/);   // no bank details entered yet
      expect(existsSync(out)).toBe(false);
      await savePlatformSetting(control, OP, "bank_details", "HBL\nTitle: Test Seller\nIBAN: PK00TEST");
      await savePlatformSetting(control, OP, "billing_email", "billing@example.com");
      await requestBill(router, admin, "owner1@example.com");
      const [bill, copy] = readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(bill).toMatchObject({ to: "owner1@example.com", replyTo: "billing@example.com" });
      expect(bill.subject).toMatch(/^Your Fleet OTG bill BILL-/);
      expect(bill.text).toContain(paymentReference(a.tenantId));
      expect(bill.text).toContain("IBAN: PK00TEST");
      expect(bill.html).toContain("Alpha Fleet");
      expect(copy).toMatchObject({ to: "billing@example.com", replyTo: "owner1@example.com" });
      expect(copy.text).not.toContain("PK00TEST");
      await requestBill(router, admin, "owner1@example.com");
      await requestBill(router, admin, "owner1@example.com");
      await expect(requestBill(router, admin, "owner1@example.com")).rejects.toThrow(/sent a moment ago/);
    } finally {
      for (const [k, v] of [["SMTP_URL", saved.u], ["EMAIL_FROM", saved.f], ["ALLOW_FILE_MAILER", saved.a]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });
});
