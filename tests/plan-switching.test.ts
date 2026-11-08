// Moving between Basic and Pro by paying (ADR-068): a claim names the plan and quotes its price; confirming it switches the plan when the paid period ends (or at once when
// there is none); a downgrade is a pending switch to Basic; a Basic company may take one free 3-day Pro trial; reads work the plan in force out from the dates.
import { beforeAll, describe, expect, it } from "vitest";
import { withPlatform } from "@/lib/db/tenant";
import { submitClaim, getInvoice, listInvoices } from "@/lib/billing/payments";
import { confirmClaim, rejectClaim, setComped } from "@/lib/billing/operator";
import { setPlanPrice, setProBands, setOrgPlan, tenantPlan } from "@/lib/billing/plans";
import { applyDueSwitches, cancelBasicRequest, planStatus, requestBasic, startProTrial } from "@/lib/billing/plan-switch";
import { loadAccess } from "@/lib/billing/state";
import { harness, noStore, claim, OP, type Org } from "./billing-harness";

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => {
  h = await harness();
  await setPlanPrice(h.control, OP, "standard", { price: "43000", currency: "PKR", trialDays: "3" });
  await setProBands(h.control, OP, [{ upTo: "", price: "65000", reads: "200" }], "PKR");
});

const row = (o: Org) => withPlatform(h.control, async (q) => (await q.query<{ plan_key: string; price_cents: number; currency: string; ai_reads_per_day: number | null; pending_plan_key: string | null; pending_plan_from: string | null; current_period_end: string | null; status: string }>(
  "select plan_key, price_cents, currency, ai_reads_per_day, pending_plan_key, pending_plan_from::text, current_period_end::text, status from public.org_billing where tenant_id = $1", [o.tenantId])).rows[0]);
const changes = (o: Org) => withPlatform(h.control, async (q) => (await q.query<{ from_plan: string | null; to_plan: string; reason: string }>("select from_plan, to_plan, reason from public.plan_changes where tenant_id = $1 order by created_at, id", [o.tenantId])).rows);
const setCol = (o: Org, sql: string, args: unknown[] = []) => withPlatform(h.control, (q) => q.query(`update public.org_billing set ${sql} where tenant_id = $1`, [o.tenantId, ...args]));
const flags = (o: Org, on: boolean) => withPlatform(h.control, (q) => q.query("update public.tenants set ai_documents_enabled = $2, wa_jobcards_enabled = $2 where id = $1", [o.tenantId, on]));
const readFlags = (o: Org) => withPlatform(h.control, async (q) => (await q.query<{ ai_documents_enabled: boolean; wa_jobcards_enabled: boolean }>("select ai_documents_enabled, wa_jobcards_enabled from public.tenants where id = $1", [o.tenantId])).rows[0]);
const fileClaim = async (o: Org, plan: string | undefined, amount: string, months = "1") => (await submitClaim(h.router, noStore, o.admin, claim({ plan, amount, currency: "PKR", months }))).id;
const accessOf = (tenantId: string) => loadAccess(h.control, tenantId);
const past = "now() - interval '1 hour'";

describe("a claim names the plan and quotes its price", () => {
  it("quotes Basic and Pro from the owner's tables, and refuses a plan that is not on sale", async () => {
    const o = await h.org("Quote Co");
    const a = await fileClaim(o, "pro", "65000");
    const q = await withPlatform(h.control, async (c) => (await c.query<{ plan_key: string; quoted_price_cents: number; quoted_currency: string; quoted_ai_reads_per_day: number }>("select plan_key, quoted_price_cents, quoted_currency, quoted_ai_reads_per_day from public.payment_claims where id = $1", [a])).rows[0]);
    expect(q).toMatchObject({ plan_key: "pro", quoted_price_cents: 6500000, quoted_currency: "PKR", quoted_ai_reads_per_day: 200 });
    await rejectClaim(h.control, OP, a, "test");
    await setProBands(h.control, OP, [], "PKR");
    await expect(fileClaim(o, "pro", "65000")).rejects.toThrow(/not on sale/);
    await setProBands(h.control, OP, [{ upTo: "", price: "65000", reads: "200" }], "PKR");
  });

  it("is settled at the price it was filed at, even if the owner changes the price before it is confirmed", async () => {
    const o = await h.org("Frozen Co");
    const id = await fileClaim(o, "pro", "65000");
    await setProBands(h.control, OP, [{ upTo: "", price: "70000", reads: "300" }], "PKR");
    await confirmClaim(h.control, OP, id);
    const inv = await h.lastInvoice(o);
    expect(inv.amount_cents).toBe("6500000");
    expect(await row(o)).toMatchObject({ plan_key: "pro", price_cents: 6500000, ai_reads_per_day: 200 });
    await setProBands(h.control, OP, [{ upTo: "", price: "65000", reads: "200" }], "PKR");
  });
});

describe("paying for the other plan", () => {
  it("switches at once for a company on its free trial, which has no paid period", async () => {
    const o = await h.org("Trial Pro Co");
    expect((await row(o)).status).toBe("trialing");
    const id = await fileClaim(o, "pro", "65000");
    const s = await confirmClaim(h.control, OP, id);
    expect(await row(o)).toMatchObject({ plan_key: "pro", pending_plan_key: null, status: "active", price_cents: 6500000, ai_reads_per_day: 200 });
    expect(await tenantPlan(h.control, o.tenantId)).toMatchObject({ key: "pro", aiDocuments: true, aiPerDay: 200 });
    expect(await changes(o)).toEqual([{ from_plan: "standard", to_plan: "pro", reason: "payment" }]);
    const inv = await h.lastInvoice(o);
    expect(inv.number).toBe(s.number);
  });

  it("starts Pro at the next renewal for a company that has paid for Basic: the Basic time already paid stays Basic", async () => {
    const o = await h.org("Renewal Co");
    await h.pay(o, { amount: "43000", currency: "PKR" });               // a Basic month, at the price copy
    const before = await row(o);
    expect(before.plan_key).toBe("standard");
    const id = await fileClaim(o, "pro", "65000");
    await confirmClaim(h.control, OP, id);
    const after = await row(o);
    expect(after).toMatchObject({ plan_key: "standard", pending_plan_key: "pro" });
    expect(new Date(after.pending_plan_from!).getTime()).toBe(new Date(before.current_period_end!).getTime());   // when the Basic month ends
    expect(new Date(after.current_period_end!).getTime()).toBeGreaterThan(new Date(before.current_period_end!).getTime());   // and the Pro month is added after it
    expect(await tenantPlan(h.control, o.tenantId)).toMatchObject({ key: "standard", aiDocuments: false });         // still Basic today
    const inv = await h.lastInvoice(o);
    expect(inv.amount_cents).toBe("6500000");

    await setCol(o, `pending_plan_from = ${past}`);                      // the Basic month has ended
    expect(await tenantPlan(h.control, o.tenantId)).toMatchObject({ key: "pro", aiDocuments: true, aiPerDay: 200 });   // in force at once, before any job runs
    expect(await row(o)).toMatchObject({ plan_key: "standard" });                                                       // a read writes nothing
    expect(await applyDueSwitches(h.control)).toMatchObject({ switched: 1 });
    expect(await row(o)).toMatchObject({ plan_key: "pro", pending_plan_key: null, price_cents: 6500000, ai_reads_per_day: 200 });
    expect(await changes(o)).toEqual([{ from_plan: "standard", to_plan: "pro", reason: "payment" }]);
    expect(await applyDueSwitches(h.control)).toMatchObject({ switched: 0 });                                           // safe to run twice
  });

  it("changes nothing when the claim is rejected", async () => {
    const o = await h.org("Rejected Co");
    await h.pay(o, { amount: "43000", currency: "PKR" });
    const id = await fileClaim(o, "pro", "65000");
    await rejectClaim(h.control, OP, id, "no money received");
    expect(await row(o)).toMatchObject({ plan_key: "standard", pending_plan_key: null });
    expect(await changes(o)).toEqual([]);
  });

  it("refuses a claim for Basic while a paid move to Pro is waiting, but a claim for the plan in force is a renewal", async () => {
    const o = await h.org("Waiting Co");
    await h.pay(o, { amount: "43000", currency: "PKR" });
    await confirmClaim(h.control, OP, await fileClaim(o, "pro", "65000"));
    await expect(fileClaim(o, "standard", "43000")).rejects.toThrow(/already paid for/);
    expect((await row(o)).pending_plan_key).toBe("pro");
  });
});

describe("moving down to Basic", () => {
  it("is a request that takes effect when the paid period ends, with no refund, and then switches the AI and WhatsApp job cards off", async () => {
    const o = await h.org("Down Co");
    await confirmClaim(h.control, OP, await fileClaim(o, "pro", "65000"));            // a trial company: Pro at once
    await flags(o, true);
    await expect(requestBasic(h.router, o.requester)).rejects.toThrow();               // the administrator only
    await requestBasic(h.router, o.admin);
    const r = await row(o);
    expect(r).toMatchObject({ plan_key: "pro", pending_plan_key: "standard" });
    expect(await tenantPlan(h.control, o.tenantId)).toMatchObject({ key: "pro", aiDocuments: true });   // Pro works until the period ends
    await expect(requestBasic(h.router, o.admin)).rejects.toThrow(/already waiting/);

    await setCol(o, `pending_plan_from = ${past}`);
    expect(await tenantPlan(h.control, o.tenantId)).toMatchObject({ key: "standard", aiDocuments: false, aiPerDay: 0 });
    await applyDueSwitches(h.control);
    expect(await row(o)).toMatchObject({ plan_key: "standard", pending_plan_key: null, price_cents: 4300000, ai_reads_per_day: null });
    expect(await readFlags(o)).toEqual({ ai_documents_enabled: false, wa_jobcards_enabled: false });
    expect((await changes(o)).map((c) => c.reason)).toEqual(["payment", "downgrade"]);
  });

  it("can be taken back, and paying for Pro again cancels it", async () => {
    const o = await h.org("Stay Co");
    await confirmClaim(h.control, OP, await fileClaim(o, "pro", "65000"));
    await requestBasic(h.router, o.admin);
    await cancelBasicRequest(h.router, o.admin);
    expect((await row(o)).pending_plan_key).toBeNull();
    await requestBasic(h.router, o.admin);
    await confirmClaim(h.control, OP, await fileClaim(o, "pro", "65000"));            // renews Pro
    expect((await row(o)).pending_plan_key).toBeNull();
    await expect(cancelBasicRequest(h.router, o.admin)).rejects.toThrow(/no request/);
  });
});

describe("the free Pro trial", () => {
  it("reopens a never-paid company whose free trial ended, for the trial days, but not a suspended one", async () => {
    const o = await h.org("Lapsed Trial Co");
    await setCol(o, `trial_ends_at = ${past}`);
    expect((await accessOf(o.tenantId)).full).toBe(false);
    await startProTrial(h.router, o.admin);
    const a = await accessOf(o.tenantId);
    expect(a.full).toBe(true);
    expect(a.daysLeft).toBeLessThanOrEqual(3);

    const s = await h.org("Suspended Trial Co");
    await setCol(s, `trial_ends_at = ${past}, suspended = true`);
    await startProTrial(h.router, s.admin);
    expect((await accessOf(s.tenantId)).full).toBe(false);
  });


  it("gives a Basic company Pro's features for 3 days, once, then shuts them off", async () => {
    const o = await h.org("Trial Taker");
    expect(await tenantPlan(h.control, o.tenantId)).toMatchObject({ aiDocuments: false, proTrialEndsAt: null });
    await expect(startProTrial(h.router, o.requester)).rejects.toThrow();
    await startProTrial(h.router, o.admin);
    const t = await tenantPlan(h.control, o.tenantId);
    expect(t).toMatchObject({ key: "standard", aiDocuments: true, aiPerDay: 200, aiTrialReads: null });
    const days = (new Date(t.proTrialEndsAt!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(2.9); expect(days).toBeLessThanOrEqual(3);
    expect(await row(o)).toMatchObject({ plan_key: "standard" });
    await expect(startProTrial(h.router, o.admin)).rejects.toThrow(/already had/);

    await flags(o, true);
    await setCol(o, `pro_trial_ends_at = ${past}`);
    expect(await tenantPlan(h.control, o.tenantId)).toMatchObject({ aiDocuments: false, aiPerDay: 0, proTrialEndsAt: null });
    expect(await applyDueSwitches(h.control)).toMatchObject({ trialsClosed: 1 });
    expect(await readFlags(o)).toEqual({ ai_documents_enabled: false, wa_jobcards_enabled: false });
    expect((await changes(o)).map((c) => c.reason)).toEqual(["pro_trial_end"]);
    expect(await applyDueSwitches(h.control)).toMatchObject({ trialsClosed: 0 });
    await expect(startProTrial(h.router, o.admin)).rejects.toThrow(/already had/);      // never again
  });

  it("is for Basic companies only, and keeps the Pro features of a company that bought Pro during it", async () => {
    const p = await h.org("Already Pro");
    await confirmClaim(h.control, OP, await fileClaim(p, "pro", "65000"));
    await expect(startProTrial(h.router, p.admin)).rejects.toThrow(/companies on Basic/);

    const o = await h.org("Buys During Trial");
    await startProTrial(h.router, o.admin);
    await confirmClaim(h.control, OP, await fileClaim(o, "pro", "65000"));
    await flags(o, true);
    await setCol(o, `pro_trial_ends_at = ${past}`);
    await applyDueSwitches(h.control);
    expect(await readFlags(o)).toEqual({ ai_documents_enabled: true, wa_jobcards_enabled: true });
    expect(await tenantPlan(h.control, o.tenantId)).toMatchObject({ key: "pro", aiDocuments: true });
  });

  it("is not offered while Pro is not on sale", async () => {
    const o = await h.org("No Pro Yet");
    await setProBands(h.control, OP, [], "PKR");
    expect((await planStatus(h.router, o.admin)).canTryPro).toBe(false);
    await expect(startProTrial(h.router, o.admin)).rejects.toThrow(/not on sale/);
    await setProBands(h.control, OP, [{ upTo: "", price: "65000", reads: "200" }], "PKR");
    expect((await planStatus(h.router, o.admin)).canTryPro).toBe(true);
  });
});

describe("what Billing shows, and the operator's own move", () => {
  it("lists the plan in force, a waiting switch, and what each plan would charge", async () => {
    const o = await h.org("Status Co");
    await h.pay(o, { amount: "43000", currency: "PKR" });
    await confirmClaim(h.control, OP, await fileClaim(o, "pro", "65000"));
    const s = await planStatus(h.router, o.admin);
    expect(s.planKey).toBe("standard");
    expect(s.pending).toMatchObject({ key: "pro", paid: true });
    expect(s.options).toEqual([{ key: "standard", priceCents: 4300000, currency: "PKR" }, { key: "pro", priceCents: 6500000, currency: "PKR" }]);
    expect(s.canTryPro).toBe(false); expect(s.canMoveToBasic).toBe(false);
    await expect(planStatus(h.router, o.requester)).rejects.toThrow();
  });

  it("the operator may still move any organization at once, which clears a waiting switch and leaves a history row", async () => {
    const o = await h.org("Operator Co");
    await h.pay(o, { amount: "43000", currency: "PKR" });
    await confirmClaim(h.control, OP, await fileClaim(o, "pro", "65000"));
    await setComped(h.control, OP, o.tenantId, true);
    await setOrgPlan(h.control, OP, o.tenantId, "pro");
    expect(await row(o)).toMatchObject({ plan_key: "pro", pending_plan_key: null });
    expect((await changes(o)).at(-1)).toEqual({ from_plan: "standard", to_plan: "pro", reason: "operator" });
  });
});

describe("an invoice says which plan it was for", () => {
  it("records the plan on the invoice", async () => {
    const o = await h.org("Invoice Co");
    await confirmClaim(h.control, OP, await fileClaim(o, "pro", "65000"));
    const id = (await listInvoices(h.router, o.admin))[0].id;
    const planKey = await withPlatform(h.control, async (q) => (await q.query<{ plan_key: string }>("select plan_key from public.invoices where id = $1", [id])).rows[0].plan_key);
    expect(planKey).toBe("pro");
    expect(await getInvoice(h.router, o.admin, id)).not.toBeNull();
  });
});
