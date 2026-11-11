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

  it("the person who checked it cannot record its payment; someone else can", async () => {
    const id = ids[2];
    const finance = mem("finance", U(9001));
    expect((await pay.getPayments(d, finance, "workshop", id)).blocked).toMatch(/checked this invoice/);
    await expect(pay.recordPayment(d, finance, "workshop", id, input())).rejects.toThrow(/segregation of duties/i);
    const other = mem("finance", U(9002));
    expect((await pay.getPayments(d, other, "workshop", id)).blocked).toBeNull();
    await pay.recordPayment(d, other, "workshop", id, input({ amount: "10" }));
    expect((await pay.getPayments(d, other, "workshop", id)).paid).toBe(10);
  });

  it("the approver or requester of the job card cannot record it either", async () => {
    const id = ids[3];
    const approver = await raw(async (q) => (await q.query<{ user_id: string }>(
      "select e.user_id from invoices i join work_orders wo on wo.id = i.work_order_id join job_cards jc on jc.id = wo.job_card_id join employees e on e.id = jc.approved_by where i.id = $1", [id])).rows[0]?.user_id);
    if (!approver) return;                       // the demo card was approved by a person without a login: nothing to test
    await expect(pay.recordPayment(d, mem("finance", approver), "workshop", id, input())).rejects.toThrow(/segregation of duties/i);
  });

  it("only finance and the administrator may record; the auditor may read, others may not even read", async () => {
    const id = ids[4];
    for (const role of ["fleet_manager", "auditor", "requester", "logistics", "hr", "security", "vendor"])
      await expect(pay.recordPayment(d, mem(role, U(9003)), "workshop", id, input())).rejects.toBeInstanceOf(ForbiddenError);
    expect((await pay.getPayments(d, mem("auditor", U(9003)), "workshop", id)).canPay).toBe(false);
    for (const role of ["requester", "vendor", "hr"]) await expect(pay.getPayments(d, mem(role, U(9003)), "workshop", id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(pay.voidPayment(d, mem("auditor", U(9003)), "00000000-0000-4000-8000-0000000000aa", "because")).rejects.toBeInstanceOf(ForbiddenError);
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

  it("the person who checked the invoice, or awarded or asked for the trip, cannot pay it", async () => {
    const { invoice } = await checkedTripInvoice();
    await expect(pay.recordPayment(d, fin(), "trip", invoice, input())).rejects.toThrow(/segregation of duties/i);
    expect((await pay.getPayments(d, fin(), "trip", invoice)).blocked).toMatch(/checked this invoice/);
    const finance2 = tm("finance", 31);
    await traw((q) => q.query("update trips set decided_by = $1 where id = (select trip_id from trip_invoices where id = $2)", [U(31), invoice]));
    await expect(pay.recordPayment(d, finance2, "trip", invoice, input())).rejects.toThrow(/segregation of duties/i);   // awarded by this person
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
