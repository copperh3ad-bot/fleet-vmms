import { beforeAll, describe, expect, it, vi } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import * as master from "@/lib/master/service";
import * as trips from "@/lib/trips/service";
import * as pay from "@/lib/payments/service";
import { seedDemo } from "@/lib/demo/seed";

// ADR-086: recording payment of workshop invoices and provider trip invoices. Part payments, never above the amount due,
// segregation of duties, append-only with void, and who may do what.
const plan = vi.hoisted(() => ({ pro: true }));
vi.mock("@/lib/billing/plans", async (orig) => ({ ...(await orig<typeof import("@/lib/billing/plans")>()), tenantPlan: async () => ({ outsourcedTrips: plan.pro }) }));

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
type Q = import("@/lib/db/types").Queryable;
let d: Awaited<ReturnType<typeof testDriver>>;

// ------------------------------------------------------------------ workshop invoices (demo workspace)
let t: { tenantId: string; schema: string };
const mem = (role: string, userId: string): Membership => ({ ...t, userId, role, vehicleScope: "all" });
const ADMIN = "00000000-0000-0000-0000-0000000000aa";
const raw = <R,>(fn: (q: Q) => Promise<R>) => withTenant(d, mem("tenant_admin", ADMIN), fn);
const userOf = (no: string) => raw(async (q) => (await q.query<{ user_id: string }>("select user_id from employees where employee_no = $1", [no])).rows[0].user_id);
const admin = () => mem("tenant_admin", ADMIN);
const verifiedInvoices = () => raw(async (q) => (await q.query<{ id: string }>("select id from invoices where status = 'verified' order by invoice_no")).rows.map((r) => r.id));
const dueOf = (id: string) => raw(async (q) => Number((await q.query<{ due: string }>("select (coalesce(payable_amount, amount) + tax_amount)::text due from invoices where id = $1", [id])).rows[0].due));
const statusOf = (id: string) => raw(async (q) => (await q.query<{ status: string }>("select status from invoices where id = $1", [id])).rows[0].status);
const input = (over: Record<string, string> = {}) => ({ amount: "100", paid_on: "2026-01-15", method: "bank_transfer", reference: "TRX-1001", note: "", ...over });
let ids: string[];
const setSetting = (key: string, value: string) => raw((q) => q.query("update settings set value = $2 where key = $1", [key, value]));
/** No limit and no over-quote rule: the first tests are about recording a payment, not about approval. */
const relax = async () => { await setSetting("payment_approval_limit", ""); await setSetting("invoice_over_quote_pct", "1000"); };
const fm = () => mem("fleet_manager", U(9010));

describe("paying a workshop invoice", () => {
  beforeAll(async () => {
    d = await testDriver();
    t = await provisionTenant(d, { name: "Demo Workspace", slug: "demo" }, tenantMigrations(), { transform: stripExt });
    await seedDemo(d, t);
    // The demo data has only a few checked invoices, so make eight more from one of them (same work order, new invoice numbers),
    // plus one that has not been checked, and give them all a known checker so the segregation tests do not depend on the seed.
    await raw(async (q) => {
      for (let n = 1; n <= 8; n++)
        await q.query(`insert into invoices(work_order_id, invoice_no, invoice_date, amount, tax_amount, status, decision, payable_amount, verified_by, verified_at)
                       select work_order_id, 'PAYTEST-' || $1::text, invoice_date, amount, tax_amount, 'verified', 'pay_approved', amount, $2::uuid, now()
                         from invoices where status in ('verified','paid') order by invoice_no limit 1`, [n, U(9001)]);
      await q.query(`insert into invoices(work_order_id, invoice_no, invoice_date, amount, tax_amount, status)
                     select work_order_id, 'PAYTEST-OPEN', invoice_date, amount, 0, 'submitted' from invoices order by invoice_no limit 1`);
    });
    ids = (await raw(async (q) => (await q.query<{ id: string }>("select id from invoices where invoice_no like 'PAYTEST-%' and status = 'verified' order by invoice_no")).rows.map((r) => r.id)));
    expect(ids.length).toBe(8);
    await relax();
  });

  it("two part payments settle it: the first leaves it open, the second marks it paid", async () => {
    const id = ids[0], due = await dueOf(id);
    const first = (due / 2).toFixed(2), second = (due - Number(first)).toFixed(2);
    await pay.recordPayment(d, admin(), "workshop", id, input({ amount: first }));
    let s = await pay.getPayments(d, admin(), "workshop", id);
    expect(s).toMatchObject({ status: "part_paid", due, canPay: true });
    expect(s.paid).toBeCloseTo(Number(first), 2);
    expect(s.remaining).toBeCloseTo(due - Number(first), 2);
    expect(await statusOf(id)).toBe("verified");
    await pay.recordPayment(d, admin(), "workshop", id, input({ amount: second, reference: "TRX-1002" }));
    s = await pay.getPayments(d, admin(), "workshop", id);
    expect(s).toMatchObject({ status: "paid", remaining: 0 });
    expect(s.payments).toHaveLength(2);
    expect(s.payments[0].payment_no).toMatch(/^PAY-\d{6}$/);
    expect(await statusOf(id)).toBe("paid");
    await expect(pay.recordPayment(d, admin(), "workshop", id, input({ amount: "1" }))).rejects.toThrow(/already paid in full/i);
  });

  it("never takes the total above the amount due, and rejects a bad amount, date, method or missing reference", async () => {
    const id = ids[1], due = await dueOf(id);
    await expect(pay.recordPayment(d, admin(), "workshop", id, input({ amount: String(due + 1) }))).rejects.toThrow(/above the amount due/i);
    const bad = await pay.recordPayment(d, admin(), "workshop", id, input({ amount: "abc" })).catch((e) => e);
    expect(bad).toBeInstanceOf(UserError);
    expect((bad as UserError).fields).toHaveProperty("amount");
    await expect(pay.recordPayment(d, admin(), "workshop", id, input({ amount: "0" }))).rejects.toBeInstanceOf(UserError);
    await expect(pay.recordPayment(d, admin(), "workshop", id, input({ paid_on: "2999-01-01" }))).rejects.toThrow(/future/i);
    await expect(pay.recordPayment(d, admin(), "workshop", id, input({ method: "barter" }))).rejects.toBeInstanceOf(UserError);
    await expect(pay.recordPayment(d, admin(), "workshop", id, input({ reference: "" }))).rejects.toThrow(/payment reference/i);
    await pay.recordPayment(d, admin(), "workshop", id, input({ method: "cash", reference: "", amount: "5" }));   // cash needs no reference
    expect((await pay.getPayments(d, admin(), "workshop", id)).paid).toBe(5);
  });

  it("an invoice that has not been checked cannot be paid", async () => {
    const open = await raw(async (q) => (await q.query<{ id: string }>("select id from invoices where invoice_no = 'PAYTEST-OPEN'")).rows[0]?.id);
    expect(open).toBeTruthy();
    await expect(pay.recordPayment(d, admin(), "workshop", open, input())).rejects.toThrow(/only a checked invoice/i);
    expect(await pay.getPayments(d, admin(), "workshop", open)).toMatchObject({ status: "not_checked", due: null });
  });

  it("the person who checked the invoice may record its payment (owner decision B1); the approver or requester of the card too", async () => {
    const id = ids[2];
    const checker = mem("finance", U(9001));
    expect((await pay.getPayments(d, checker, "workshop", id)).blocked).toBeNull();
    await pay.recordPayment(d, checker, "workshop", id, input({ amount: "10" }));
    expect((await pay.getPayments(d, checker, "workshop", id)).paid).toBe(10);
  });

  it("only finance and the administrator may record; the auditor may read, others may not even read", async () => {
    const id = ids[4];
    for (const role of ["fleet_manager", "auditor", "requester", "logistics", "hr", "security", "vendor"])
      await expect(pay.recordPayment(d, mem(role, U(9003)), "workshop", id, input())).rejects.toBeInstanceOf(ForbiddenError);
    expect((await pay.getPayments(d, mem("auditor", U(9003)), "workshop", id)).canPay).toBe(false);
    for (const role of ["requester", "vendor", "hr"]) await expect(pay.getPayments(d, mem(role, U(9003)), "workshop", id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(pay.voidPayment(d, mem("auditor", U(9003)), "00000000-0000-4000-8000-0000000000aa", "because")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the auditor and the fleet manager can read invoices and their payments; requester, HR and vendor cannot (owner decision A4)", async () => {
    const vf = await import("@/lib/vendorflow/service");
    const id = ids[6];
    for (const role of ["auditor", "fleet_manager"]) {
      const m = mem(role, U(9020));
      expect((await vf.listInvoices(d, m, { status: "verified" })).length).toBeGreaterThan(0);
      expect((await vf.getInvoiceReview(d, m, id))!.invoice_no).toMatch(/^PAYTEST-/);
      expect((await pay.getPayments(d, m, "workshop", id)).canPay).toBe(false);
    }
    for (const role of ["requester", "hr", "vendor", "security"]) {
      await expect(vf.listInvoices(d, mem(role, U(9021)), {})).rejects.toBeInstanceOf(ForbiddenError);
      await expect(vf.getInvoiceReview(d, mem(role, U(9021)), id)).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(pay.recordPayment(d, mem("auditor", U(9020)), "workshop", id, input())).rejects.toBeInstanceOf(ForbiddenError);   // reading is not paying
  });

  it("the defaults are 50,000 and 10 percent, and the settings are changeable by the administrator", async () => {
    const ctl = await import("@/lib/control/service");
    const s = await ctl.getSettings(d, admin());
    expect(s.find((x) => x.key === "payment_approval_limit")).toMatchObject({ editable: true });
    expect(s.find((x) => x.key === "invoice_over_quote_pct")).toMatchObject({ editable: true });
    expect(await ctl.saveSettings(d, admin(), { payment_approval_limit: "75000", invoice_over_quote_pct: "12.5" })).toBe(2);
    await relax();
  });

  it("an invoice above the limit needs a Fleet Manager or Administrator to approve it first; splitting the payment does not get round it (B2)", async () => {
    const id = ids[6], due = await dueOf(id);
    await setSetting("payment_approval_limit", String(Math.floor(due) - 1));
    try {
      let s = await pay.getPayments(d, admin(), "workshop", id);
      expect(s.approval).toMatchObject({ needed: "amount", approvedBy: null, canApprove: true });
      expect(s.blocked).toMatch(/needs a Fleet Manager or Administrator/);
      const finance = mem("finance", U(9002));
      expect((await pay.getPayments(d, finance, "workshop", id)).approval.canApprove).toBe(false);     // Finance cannot approve its own payment
      await expect(pay.recordPayment(d, finance, "workshop", id, input({ amount: "1" }))).rejects.toThrow(/needs approval before it can be paid/i);   // not even a small part
      await expect(pay.approvePayment(d, finance, "workshop", id, "ok")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(pay.approvePayment(d, mem("auditor", U(9003)), "workshop", id, "ok")).rejects.toBeInstanceOf(ForbiddenError);
      await pay.approvePayment(d, fm(), "workshop", id, "");
      s = await pay.getPayments(d, finance, "workshop", id);
      expect(s.approval).toMatchObject({ needed: "amount", canApprove: false });
      expect(s.approval.approvedBy).toBeTruthy();
      expect(s.blocked).toBeNull();
      await expect(pay.approvePayment(d, fm(), "workshop", id, "")).rejects.toThrow(/already approved/i);
      await pay.recordPayment(d, finance, "workshop", id, input({ amount: "1" }));
      expect((await pay.getPayments(d, finance, "workshop", id)).paid).toBe(1);
      await expect(raw((q) => q.query("update payment_approvals set note = 'x'"))).rejects.toThrow(/cannot be changed or deleted/i);
    } finally { await relax(); }
  });

  it("an invoice whose payable amount is more than the percentage above the approved quote needs approval with a reason (B3)", async () => {
    const id = ids[7];
    await raw((q) => q.query("update invoices set payable_amount = (select approved_amount from work_orders wo where wo.id = invoices.work_order_id) * 1.5, tax_amount = 0 where id = $1", [id]));
    await setSetting("invoice_over_quote_pct", "10");
    try {
      const finance = mem("finance", U(9002));
      const s = await pay.getPayments(d, finance, "workshop", id);
      expect(s.approval.needed).toBe("over_quote");
      await expect(pay.recordPayment(d, finance, "workshop", id, input({ amount: "1" }))).rejects.toThrow(/over the approved quote/i);
      const short = await pay.approvePayment(d, fm(), "workshop", id, "ok").catch((e) => e);
      expect(short.message).toMatch(/reason of at least 5 characters/i);
      await pay.approvePayment(d, admin(), "workshop", id, "Extra parts agreed on the phone with the workshop");
      await pay.recordPayment(d, finance, "workshop", id, input({ amount: "1" }));
      // the person who approved cannot also record it, unless nobody else could have approved: a Fleet Manager now holds the permission in this company
      await withPlatform(d, async (q) => { await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'fleet_manager') on conflict do nothing", [U(9010), t.tenantId]); });
      const own = ids[4];
      await raw((q) => q.query("update invoices set payable_amount = (select approved_amount from work_orders wo where wo.id = invoices.work_order_id) * 2, tax_amount = 0 where id = $1", [own]));
      await pay.approvePayment(d, admin(), "workshop", own, "Agreed with the workshop after the repair");
      await expect(pay.recordPayment(d, admin(), "workshop", own, input({ amount: "1" }))).rejects.toThrow(/segregation of duties/i);
    } finally { await relax(); }
  });

  it("an invoice that does not need approval cannot be given one", async () => {
    const id = ids[3];
    await expect(pay.approvePayment(d, fm(), "workshop", id, "not needed")).rejects.toThrow(/does not need a payment approval/i);
  });

  it("a payment is voided with a reason, reopens the invoice, and stays on the record; it cannot be edited or deleted", async () => {
    const id = ids[5], due = await dueOf(id);
    await pay.recordPayment(d, admin(), "workshop", id, input({ amount: String(due) }));
    expect(await statusOf(id)).toBe("paid");
    const p = (await pay.getPayments(d, admin(), "workshop", id)).payments[0];
    await expect(pay.voidPayment(d, admin(), p.id, "oops")).rejects.toThrow(/at least 5 characters/i);
    await pay.voidPayment(d, admin(), p.id, "Entered on the wrong invoice");
    expect(await statusOf(id)).toBe("verified");
    const s = await pay.getPayments(d, admin(), "workshop", id);
    expect(s).toMatchObject({ status: "unpaid", paid: 0, remaining: due });
    expect(s.payments).toHaveLength(1);
    expect(s.payments[0]).toMatchObject({ void_reason: "Entered on the wrong invoice" });
    expect(s.payments[0].voided_at).toBeTruthy();
    await expect(pay.voidPayment(d, admin(), p.id, "Again for good measure")).rejects.toThrow(/already void/i);
    await expect(raw((q) => q.query("delete from invoice_payments where id = $1", [p.id]))).rejects.toThrow(/cannot be deleted/i);
    const live = await pay.recordPayment(d, admin(), "workshop", id, input({ amount: "7" }));
    await expect(raw((q) => q.query("update invoice_payments set amount = 1 where id = $1", [live]))).rejects.toThrow(/cannot be changed/i);
    await pay.recordPayment(d, admin(), "workshop", id, input({ amount: String(due - 7), reference: "TRX-2" }));    // a voided payment no longer counts toward the total
    expect(await statusOf(id)).toBe("paid");
  });

  it("the Paid list on the Invoices page now has the settled invoices, and vehicle cost is unchanged by paying", async () => {
    const paid = await raw(async (q) => (await q.query<{ n: string }>("select count(*)::text n from invoices where status = 'paid'")).rows[0].n);
    expect(Number(paid)).toBeGreaterThanOrEqual(2);
    const vf = await import("@/lib/vendorflow/service");
    const rows = await vf.listInvoices(d, mem("finance", await userOf("E-301")), { status: "paid" });
    expect(rows.length).toBe(Number(paid));
  });
});

// ------------------------------------------------------------------ provider (trip) invoices
let tt: { tenantId: string; schema: string };
const tm = (role: string, n: number): Membership => ({ ...tt, userId: U(n), role, vehicleScope: "all" });
const owner = () => tm("tenant_admin", 1);
const mgr = () => tm("fleet_manager", 12);
const req = () => tm("requester", 11);
const logi = () => tm("logistics", 19);
const fin = () => tm("finance", 20);
const traw = <R,>(fn: (q: Q) => Promise<R>) => withTenant(d, owner(), fn);
let provA: string;
const at = (day: number, hour: number) => `2031-06-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;

/** A trip awarded at 72,500 and returned, with the provider's invoice checked by Finance (user 20). */
async function checkedTripInvoice(): Promise<{ trip: string; invoice: string }> {
  const trip = await trips.requestTrip(d, req(), { purpose: "Move machinery to Faisalabad", from_place: "Lahore", to_place: "Faisalabad", start_at: at(10, 8), end_at: at(10, 18) });
  await trips.requestTripQuotes(d, mgr(), trip, [provA]);
  const q = (await trips.listTripQuotes(d, mgr(), trip))[0];
  await trips.recordTripQuote(d, mgr(), q.id, { amount: "72500" });
  await trips.awardTripQuote(d, logi(), trip, q.id);
  await trips.transitionTrip(d, mgr(), trip, "started");
  await trips.transitionTrip(d, mgr(), trip, "completed");
  const invoice = await traw(async (c) => (await c.query<{ id: string }>(
    "insert into trip_invoices(trip_id, vendor_id, invoice_no, invoice_date, amount) values ($1, $2, $3, '2031-06-12', 72500) returning id", [trip, provA, `INV-${trip.slice(0, 6)}`])).rows[0].id);
  await trips.verifyTripInvoice(d, fin(), invoice, "pay_approved");
  return { trip, invoice };
}

describe("paying a provider's trip invoice", () => {
  beforeAll(async () => {
    tt = await provisionTenant(d, { name: "Pay Haul Co", slug: "payhaul", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
    for (const [n, name] of [[11, "Requester One"], [12, "Manager One"], [19, "Logistics One"], [20, "Finance One"]] as const) {
      const id = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` })).id;
      await traw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), id]));
    }
    await withPlatform(d, async (q) => {
      for (const [n, role] of [[11, "requester"], [12, "fleet_manager"], [19, "logistics"], [20, "finance"]] as const)
        await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), tt.tenantId, role]);
    });
    await traw((q) => q.query("insert into settings(key, value) values ('module_trips','1') on conflict (key) do update set value = '1'"));
    provA = (await master.saveVendor(d, owner(), { name: "Alpha Freight", kind: "logistics", phone: "0300 1111111" })).id;
    await traw((q) => q.query("update settings set value = '' where key = 'payment_approval_limit'"));
    await traw((q) => q.query("update settings set value = '1000' where key = 'invoice_over_quote_pct'"));
  });

  it("is paid in two parts by someone other than the checker, and each step is written to the trip's history", async () => {
    const { trip, invoice } = await checkedTripInvoice();
    expect(await pay.getPayments(d, fin(), "trip", invoice)).toMatchObject({ status: "unpaid", due: 72500, canPay: true });
    await pay.recordPayment(d, owner(), "trip", invoice, input({ amount: "50000" }));
    expect(await pay.getPayments(d, owner(), "trip", invoice)).toMatchObject({ status: "part_paid", paid: 50000, remaining: 22500 });
    await expect(pay.recordPayment(d, owner(), "trip", invoice, input({ amount: "22501" }))).rejects.toThrow(/above the amount due/i);
    await pay.recordPayment(d, owner(), "trip", invoice, input({ amount: "22500", reference: "TRX-9" }));
    expect(await pay.getPayments(d, owner(), "trip", invoice)).toMatchObject({ status: "paid", remaining: 0 });
    await expect(pay.recordPayment(d, owner(), "trip", invoice, input({ amount: "1" }))).rejects.toThrow(/already paid in full/i);
    const notes = await traw(async (q) => (await q.query<{ note: string }>("select note from trip_events where trip_id = $1 and note like 'Payment of%' order by created_at", [trip])).rows.map((r) => r.note));
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain("part payment");
    expect(notes[1]).toContain("paid in full");
  });

  it("the checker may pay a trip invoice; above the limit a Fleet Manager or Administrator approves first", async () => {
    const { invoice } = await checkedTripInvoice();
    expect((await pay.getPayments(d, fin(), "trip", invoice)).blocked).toBeNull();     // B1: Finance may check and pay
    await traw((q) => q.query("update settings set value = '10000' where key = 'payment_approval_limit'"));
    try {
      expect((await pay.getPayments(d, fin(), "trip", invoice)).approval).toMatchObject({ needed: "amount", canApprove: false });
      await expect(pay.recordPayment(d, fin(), "trip", invoice, input({ amount: "100" }))).rejects.toThrow(/needs approval before it can be paid/i);
      expect((await pay.getPayments(d, mgr(), "trip", invoice)).approval.canApprove).toBe(true);
      await pay.approvePayment(d, mgr(), "trip", invoice, "");
      await pay.recordPayment(d, fin(), "trip", invoice, input({ amount: "100" }));
      expect((await pay.getPayments(d, fin(), "trip", invoice)).paid).toBe(100);
    } finally { await traw((q) => q.query("update settings set value = '' where key = 'payment_approval_limit'")); }
  });

  it("an unchecked trip invoice cannot be paid, and a void reopens a settled one", async () => {
    const { trip, invoice } = await checkedTripInvoice();
    const second = await traw(async (c) => (await c.query<{ id: string }>(
      "insert into trip_invoices(trip_id, vendor_id, invoice_no, invoice_date, amount, status) values ($1, $2, 'INV-OTHER', '2031-06-13', 1000, 'disputed') returning id", [trip, provA])).rows[0].id);
    await expect(pay.recordPayment(d, owner(), "trip", second, input())).rejects.toThrow(/only a checked invoice/i);
    await pay.recordPayment(d, owner(), "trip", invoice, input({ amount: "72500" }));
    const p = (await pay.getPayments(d, owner(), "trip", invoice)).payments[0];
    await pay.voidPayment(d, owner(), p.id, "Wrong bank account used");
    expect(await pay.getPayments(d, owner(), "trip", invoice)).toMatchObject({ status: "unpaid", paid: 0 });
    const last = await traw(async (q) => (await q.query<{ note: string }>("select note from trip_events where trip_id = $1 order by created_at desc limit 1", [trip])).rows[0].note);
    expect(last).toContain("voided: Wrong bank account used");
  });
});
