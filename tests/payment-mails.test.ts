import { beforeAll, describe, expect, it } from "vitest";
import { confirmClaim, rejectClaim } from "@/lib/billing/operator";
import { submitClaim } from "@/lib/billing/payments";
import { buildClaimAlertMail, buildPaymentConfirmedMail, buildPaymentRejectedMail, notifyClaimDecided, notifyClaimFiled, type ClaimFacts } from "@/lib/billing/payment-mails";
import type { Mail } from "@/lib/email/templates";
import { OP, claim, harness, noStore, type Org } from "./billing-harness";

// ADR-051: the emails around a subscription payment. The Billing mailbox hears when a customer files a payment; the customer hears what the operator decided.
let h: Awaited<ReturnType<typeof harness>>;
let a: Org, b: Org;
const outbox: Mail[] = [];
const send = async (m: Mail) => { outbox.push(m); };
const facts = (over: Partial<ClaimFacts> = {}): ClaimFacts => ({ org: "Acme Fleet", slug: "acme-fleet", reference: "TRX-1", amountMinor: 14900, currency: "USD", paidOn: "2026-11-07", months: 1, note: null, hasProof: true, by: "boss@acme.example", ...over });

beforeAll(async () => {
  h = await harness();
  await h.set("billing_email", "finance@fleetotg.test");
  a = await h.org("Alpha Fleet");
  b = await h.org("Beta <script>Fleet");
});

describe("what the emails say", () => {
  it("tells the Billing mailbox who paid, how much and which reference, without a receipt or bank details", () => {
    const m = buildClaimAlertMail("finance@fleetotg.test", facts());
    expect(m.to).toBe("finance@fleetotg.test");
    expect(m.replyTo).toBe("boss@acme.example");
    expect(m.subject).toBe("Payment to confirm: Acme Fleet (TRX-1)");
    for (const needle of ["Acme Fleet", "TRX-1", "$149.00", "2026-11-07", "/admin/payments"]) expect(m.text).toContain(needle);
    expect(m.text).not.toMatch(/IBAN|account number|bank details/i);
  });

  it("tells the customer the invoice and the date it is paid up to, replies go to Billing", () => {
    const m = buildPaymentConfirmedMail("boss@acme.example", "finance@fleetotg.test", facts(), { invoiceNumber: "FV-2026-0007", periodEnd: "2026-12-07", note: null });
    expect(m.subject).toBe("Payment confirmed: Fleet OTG invoice FV-2026-0007");
    expect(m.replyTo).toBe("finance@fleetotg.test");
    for (const needle of ["FV-2026-0007", "2026-12-07", "$149.00", "TRX-1", "/w/acme-fleet/billing"]) expect(m.text).toContain(needle);
  });

  it("gives the customer the reason a payment was rejected, and says nothing was charged", () => {
    const m = buildPaymentRejectedMail("boss@acme.example", undefined, facts(), "The transfer reference does not match any payment in our bank");
    expect(m.text).toContain("does not match any payment in our bank");
    expect(m.text).toContain("Nothing has been charged");
  });

  it("escapes what a customer typed, in the HTML", () => {
    const m = buildClaimAlertMail("f@x.test", facts({ org: "<b>Evil</b> & Co", note: "<img src=x onerror=alert(1)>" }));
    expect(m.html).not.toContain("<b>Evil</b>");
    expect(m.html).not.toContain("<img src=x");
    expect(m.html).toContain("&lt;b&gt;Evil&lt;/b&gt; &amp; Co");
  });
});

describe("filing a payment", () => {
  it("remembers the signed-in person's email with the claim and alerts the Billing mailbox, without the email being invented", async () => {
    outbox.length = 0;
    const { id } = await submitClaim(h.router, noStore, a.admin, claim({ bank_reference: "TRX-ALPHA" }), undefined, { submitterEmail: "alpha.boss@example.com" });
    await notifyClaimFiled(h.control, id, send);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ to: "finance@fleetotg.test", replyTo: "alpha.boss@example.com" });
    expect(outbox[0].subject).toBe("Payment to confirm: Alpha Fleet (TRX-ALPHA)");
    expect(outbox[0].text).toContain("Receipt uploaded: No");
  });

  it("sends nothing when no Billing mailbox is set, and a failing mailer never undoes anything", async () => {
    outbox.length = 0;
    const { id } = await submitClaim(h.router, noStore, b.admin, claim({ bank_reference: "TRX-BETA" }), undefined, { submitterEmail: "beta@example.com" });
    await h.set("billing_email", "");
    await notifyClaimFiled(h.control, id, send);
    expect(outbox).toHaveLength(0);
    await h.set("billing_email", "finance@fleetotg.test");
    await expect(notifyClaimFiled(h.control, id, async () => { throw new Error("smtp down"); })).resolves.toBeUndefined();
  });
});

describe("the operator's decision", () => {
  it("tells the customer a payment is confirmed and copies the Billing mailbox", async () => {
    outbox.length = 0;
    const pending = await h.control.transaction(async (q) => (await q.query<{ id: string }>("select id from public.payment_claims where bank_reference = 'TRX-ALPHA'")).rows[0].id);
    const r = await confirmClaim(h.control, OP, pending, { note: "Thank you" });
    await notifyClaimDecided(h.control, pending, { kind: "confirmed", invoiceNumber: r.number, periodEnd: r.periodEnd, note: "Thank you" }, send);
    expect(outbox.map((m) => m.to)).toEqual(["alpha.boss@example.com", "finance@fleetotg.test"]);
    expect(outbox[0].subject).toBe(`Payment confirmed: Fleet OTG invoice ${r.number}`);
    expect(outbox[0].replyTo).toBe("finance@fleetotg.test");
    expect(outbox[0].text).toContain("Note from us: Thank you");
    expect(outbox[1].subject).toContain("Confirmed: Alpha Fleet (TRX-ALPHA)");
  });

  it("tells the customer why a payment was rejected", async () => {
    outbox.length = 0;
    const pending = await h.control.transaction(async (q) => (await q.query<{ id: string }>("select id from public.payment_claims where bank_reference = 'TRX-BETA'")).rows[0].id);
    await rejectClaim(h.control, OP, pending, "Reference missing from the transfer");
    await notifyClaimDecided(h.control, pending, { kind: "rejected", why: "Reference missing from the transfer" }, send);
    expect(outbox.map((m) => m.to)).toEqual(["beta@example.com", "finance@fleetotg.test"]);
    expect(outbox[0].text).toContain("Reference missing from the transfer");
    expect(outbox[1].subject).toContain("Rejected:");
  });

  it("with no email on file the customer is not guessed at: only the Billing mailbox hears, and is told so", async () => {
    outbox.length = 0;
    const { id } = await submitClaim(h.router, noStore, a.admin, claim({ bank_reference: "TRX-OLD" }));          // no submitterEmail, as claims filed before this change
    await notifyClaimDecided(h.control, id, { kind: "rejected", why: "Not received" }, send);
    expect(outbox.map((m) => m.to)).toEqual(["finance@fleetotg.test"]);
    expect(outbox[0].subject).toContain("the customer has no email on file");
  });
});
