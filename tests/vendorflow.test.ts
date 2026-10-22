import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import * as vf from "@/lib/vendorflow/service";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number, vehicleScope: "all" | "own" = "all"): Membership => ({ ...t, userId: U(n), role, vehicleScope });
const owner = () => mem("tenant_admin", 1);
const driver = () => mem("requester", 11, "own");
const mgr = () => mem("fleet_manager", 12);          // assigns vendors, approves quotations
const mgr2 = () => mem("fleet_manager", 13);         // approves job cards
const finance = () => mem("finance", 14);
const vendorA = () => mem("vendor", 21);
const vendorB = () => mem("vendor", 22);

let veh: string, reason: string, vA: string;
const raw = <T,>(m: Membership, fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, m, fn);
const statusOf = (id: string) => raw(owner(), async (q) => (await q.query<{ status: string }>("select status from job_cards where id = $1", [id])).rows[0].status);

const quote = (over: Record<string, unknown> = {}) => ({
  details: "Pads and discs", days_needed: "2", warranty_months: "6",
  lines: [{ kind: "part", description: "Brake pads", qty: "2", unit_cost: "1500" }, { kind: "labour", description: "Fit", qty: "1", unit_cost: "800" }], ...over,
});

/** A card approved and assigned to vendor A, ready for a quotation. */
async function assigned(): Promise<string> {
  const { id } = await jc.createJobCard(d, driver(), { vehicle_id: veh, reason_code_id: reason, cause_text: "Front brake pads worn to the metal", lines: [] }, true);
  await jc.transitionJobCard(d, mgr2(), id, "approved");
  await jc.transitionJobCard(d, mgr(), id, "vendor_assigned", { vendorId: vA });
  return id;
}
const quotationOf = (jobId: string) => raw(owner(), async (q) => (await q.query<{ id: string }>("select id from quotations where job_card_id = $1 order by created_at desc limit 1", [jobId])).rows[0].id);
const woOf = (jobId: string) => raw(owner(), async (q) => (await q.query<{ id: string }>("select id from work_orders where job_card_id = $1", [jobId])).rows[0].id);
async function approvedQuote(): Promise<{ job: string; wo: string }> {
  const job = await assigned();
  await vf.submitQuotation(d, vendorA(), job, quote());
  await vf.decideQuotation(d, mgr(), await quotationOf(job), "approve");
  return { job, wo: await woOf(job) };
}
async function completed() {
  const x = await approvedQuote();
  await vf.startWork(d, vendorA(), x.wo);
  await vf.completeWork(d, vendorA(), x.wo, "Done and road tested");
  return x;
}
const invoiceInput = async (jobId: string, extra: unknown[] = []) => {
  const ql = await raw(owner(), async (q) => (await q.query<{ id: string; description: string }>("select ql.id, ql.description from quotation_lines ql join quotations q on q.id = ql.quotation_id where q.job_card_id = $1 order by ql.id", [jobId])).rows);
  return { invoice_no: `INV-${Math.random().toString(36).slice(2, 8)}`, tax_amount: "0",
    lines: [...ql.map((l) => ({ kind: "part", description: l.description, qty: l.description === "Fit" ? "1" : "2", unit_cost: l.description === "Fit" ? "800" : "1500", quotation_line_id: l.id })), ...extra] };
};
const invoiceOf = (woId: string) => raw(owner(), async (q) => (await q.query<{ id: string }>("select id from invoices where work_order_id = $1 order by invoice_date desc, id limit 1", [woId])).rows[0].id);
const evs = (id: string) => raw(owner(), async (q) => (await q.query<{ to_status: string }>("select to_status from job_card_events where job_card_id = $1 order by seq", [id])).rows.map((r) => r.to_status));

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  const people: [number, string, string][] = [[11, "Driver One", "requester"], [12, "Manager One", "fleet_manager"], [13, "Manager Two", "fleet_manager"], [14, "Finance One", "finance"]];
  for (const [n, name] of people) {
    const e = await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` });
    await raw(owner(), (q) => q.query("update employees set user_id = $1 where id = $2", [U(n), e.id]));
  }
  vA = (await master.saveVendor(d, owner(), { name: "Quick Fix Motors", categories: ["brakes"] })).id;
  const vB = (await master.saveVendor(d, owner(), { name: "Other Garage" })).id;
  await raw(owner(), async (q) => { await q.query("update vendors set user_id = $1 where id = $2", [U(21), vA]); await q.query("update vendors set user_id = $1 where id = $2", [U(22), vB]); });
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[11, "requester"], [12, "fleet_manager"], [13, "fleet_manager"], [14, "finance"], [21, "vendor"], [22, "vendor"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  const emp11 = await raw(owner(), async (q) => (await q.query<{ id: string }>("select id from employees where user_id = $1", [U(11)])).rows[0].id);
  veh = (await master.addVehicle(d, owner(), { registration_no: "BKL-245", employee_id: emp11, holding_since: "2026-01-01" })).id;
  reason = (await raw(owner(), async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'WEAR_BRAKES'")).rows[0])).id;
});

describe("the whole flow", () => {
  it("assign, quote, approve, work, invoice, check, verify, close", async () => {
    const job = await assigned();
    // the vendor is told and sees the request through the vendor view
    expect((await jc.listNotifications(d, vendorA())).some((n) => n.kind === "jobcard.vendor_assigned" && n.payload.job_card_id === job)).toBe(true);
    const ov = await vf.vendorOverview(d, vendorA());
    expect(ov.requests.map((r) => r.job_card_id)).toContain(job);

    await vf.submitQuotation(d, vendorA(), job, quote());
    expect(await statusOf(job)).toBe("quotation_received");
    expect((await jc.listNotifications(d, mgr())).some((n) => n.kind === "quotation.received" && n.payload.job_card_id === job)).toBe(true);
    const flow1 = await vf.getJobFlow(d, mgr(), job);
    expect(flow1.quotations[0]).toMatchObject({ status: "submitted", amount: "3800.00", vendor_name: "Quick Fix Motors" });
    expect(flow1.quotations[0].lines).toHaveLength(2);

    await vf.decideQuotation(d, mgr(), flow1.quotations[0].id, "approve", "OK go ahead");
    const flow2 = await vf.getJobFlow(d, mgr(), job);
    expect(flow2.workOrder).toMatchObject({ status: "issued", approved_amount: "3800.00" });
    expect(flow2.workOrder!.wo_no).toMatch(/^WO-\d{6}$/);
    expect(await statusOf(job)).toBe("quotation_approved");
    expect((await jc.listNotifications(d, vendorA())).some((n) => n.kind === "quotation.approved")).toBe(true);

    const wo = flow2.workOrder!.id;
    await vf.startWork(d, vendorA(), wo);
    await vf.completeWork(d, vendorA(), wo, "Done and road tested");
    expect(await statusOf(job)).toBe("completed");

    // the invoice bills the approved lines plus one nobody approved
    await vf.submitInvoice(d, vendorA(), wo, await invoiceInput(job, [{ kind: "other", description: "Wheel alignment", qty: "1", unit_cost: "500" }]));
    expect(await statusOf(job)).toBe("invoiced");
    expect((await jc.listNotifications(d, finance())).some((n) => n.kind === "invoice.submitted")).toBe(true);

    const inv = (await vf.getInvoiceCheck(d, finance(), await invoiceOf(wo)))!;
    expect(inv).toMatchObject({ amount: "4300.00", approved_amount: "3800.00", variance: "500.00", unapproved_lines: 1, status: "submitted" });
    expect(inv.lines.filter((l) => !l.approved).map((l) => l.description)).toEqual(["Wheel alignment"]);
    expect((await vf.listInvoices(d, finance(), { status: "submitted" })).map((i) => i.id)).toContain(inv.id);

    // paying only what was approved
    await vf.verifyInvoice(d, finance(), inv.id, "pay_approved");
    const after = (await vf.getInvoiceCheck(d, finance(), inv.id))!;
    expect(after).toMatchObject({ status: "verified", payable_amount: "3800.00" });
    expect(await statusOf(job)).toBe("invoice_verified");
    expect((await jc.listNotifications(d, vendorA())).some((n) => n.kind === "invoice.verified")).toBe(true);

    await jc.transitionJobCard(d, finance(), job, "closed");
    expect(await statusOf(job)).toBe("closed");
    expect(await evs(job)).toEqual(["draft", "submitted", "approved", "vendor_assigned", "quotation_received", "quotation_approved", "in_progress", "completed", "invoiced", "invoice_verified", "closed"]);
    // closed cards leave the vendor's active lists
    expect((await vf.vendorOverview(d, vendorA())).requests.map((r) => r.job_card_id)).not.toContain(job);
  });
});

describe("a vendor sees only their own work", () => {
  it("the other vendor sees nothing of it, through any view", async () => {
    const { job, wo } = await completed();
    await vf.submitInvoice(d, vendorA(), wo, await invoiceInput(job));
    const ov = await vf.vendorOverview(d, vendorB());
    expect(ov.requests).toEqual([]);
    expect(ov.orders).toEqual([]);
    expect(await vf.vendorGetOrder(d, vendorB(), wo)).toBeNull();
    expect(await vf.vendorGetRequest(d, vendorB(), job)).toBeNull();
    const mine = (await vf.vendorGetOrder(d, vendorA(), wo))!;
    expect(mine.quotation_lines).toHaveLength(2);
    expect(mine.invoices).toHaveLength(1);
    const counts = await raw(vendorB(), async (q) => (await Promise.all(["v_vendor_quotation_lines", "v_vendor_invoices", "v_vendor_work_orders", "v_vendor_job_requests"]
      .map(async (v) => (await q.query<{ c: number }>(`select count(*)::int c from ${v}`)).rows[0].c))));
    expect(counts).toEqual([0, 0, 0, 0]);
  });

  it("vendor views carry no requester, approver or budget columns", async () => {
    const cols = await raw(owner(), async (q) => (await q.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = current_schema() and table_name like 'v\\_vendor\\_%'")).rows.map((r) => r.column_name));
    expect(cols.length).toBeGreaterThan(20);
    expect(cols.filter((c) => /requester|approved_by|custodian|budget|employee/.test(c))).toEqual([]);
  });

  it("the other vendor cannot act on the job, even by calling the functions", async () => {
    const job = await assigned();
    await expect(vf.submitQuotation(d, vendorB(), job, quote())).rejects.toThrow(/job card not found/i);
    const { wo } = await completed();
    await expect(vf.startWork(d, vendorB(), wo)).rejects.toThrow(/work order not found/i);
    await expect(vf.submitInvoice(d, vendorB(), wo, { invoice_no: "X", lines: [{ description: "x", unit_cost: "1" }] })).rejects.toThrow(/work order not found/i);
  });

  it("a login not linked to a vendor, or a blocked vendor, cannot quote", async () => {
    const job = await assigned();
    await expect(raw(mem("vendor", 99), (q) => q.query("select submit_quotation($1, $2, $3::jsonb)", [job, U(99), JSON.stringify(quote())]))).rejects.toThrow(/not linked to an active vendor/);
    await master.setVendorStatus(d, owner(), vA, "blocked");
    await expect(vf.submitQuotation(d, vendorA(), job, quote())).rejects.toThrow(/not linked to an active vendor/);
    await master.setVendorStatus(d, owner(), vA, "active");
  });
});

describe("order of steps", () => {
  it("refuses steps out of order", async () => {
    const job = await assigned();
    await expect(vf.submitQuotation(d, vendorA(), job, { ...quote(), lines: [] })).rejects.toBeInstanceOf(UserError);   // schema: at least one line
    const { wo, job: job2 } = await approvedQuote();
    await expect(vf.completeWork(d, vendorA(), wo)).rejects.toThrow(/start the work/i);
    await expect(vf.submitInvoice(d, vendorA(), wo, await invoiceInput(job2))).rejects.toThrow(/completed before invoicing/i);
    await vf.startWork(d, vendorA(), wo);
    await expect(vf.startWork(d, vendorA(), wo)).rejects.toThrow(/already been started/i);
    await vf.completeWork(d, vendorA(), wo);
    await expect(vf.submitQuotation(d, vendorA(), job2, quote())).rejects.toThrow(/not waiting for a quotation/i);
  });

  it("one open invoice at a time; a returned invoice can be replaced", async () => {
    const { job, wo } = await completed();
    await vf.submitInvoice(d, vendorA(), wo, await invoiceInput(job));
    await expect(vf.submitInvoice(d, vendorA(), wo, await invoiceInput(job))).rejects.toThrow(/already open/i);
    const first = await invoiceOf(wo);
    await expect(vf.verifyInvoice(d, finance(), first, "return")).rejects.toThrow(/note is required/i);
    await vf.verifyInvoice(d, finance(), first, "return", "Totals do not match the work done");
    expect(await statusOf(job)).toBe("completed");
    expect((await vf.vendorGetOrder(d, vendorA(), wo))!.invoices[0]).toMatchObject({ status: "disputed", return_note: "Totals do not match the work done" });
    await vf.submitInvoice(d, vendorA(), wo, await invoiceInput(job));
    expect(await statusOf(job)).toBe("invoiced");
  });

  it("an invoice line cannot point at someone else's quotation line", async () => {
    const a = await completed();
    const b = await completed();
    const foreign = (await raw(owner(), async (q) => (await q.query<{ id: string }>("select ql.id from quotation_lines ql join quotations q on q.id = ql.quotation_id where q.job_card_id = $1 limit 1", [b.job])).rows[0])).id;
    await expect(vf.submitInvoice(d, vendorA(), a.wo, { invoice_no: "Z-1", lines: [{ description: "x", unit_cost: "10", quotation_line_id: foreign }] })).rejects.toThrow(/not in the approved quotation/i);
  });
});

describe("quotation decisions", () => {
  it("rejecting needs a comment, sends the job back, and the vendor can quote again", async () => {
    const job = await assigned();
    await vf.submitQuotation(d, vendorA(), job, quote());
    const q1 = await quotationOf(job);
    await expect(vf.decideQuotation(d, mgr(), q1, "reject", "no")).rejects.toThrow(/at least 5 characters/i);
    await vf.decideQuotation(d, mgr(), q1, "reject", "Too expensive, please revise");
    expect(await statusOf(job)).toBe("vendor_assigned");
    expect((await jc.listNotifications(d, vendorA())).some((n) => n.kind === "quotation.rejected")).toBe(true);
    await vf.submitQuotation(d, vendorA(), job, quote({ lines: [{ kind: "part", description: "Pads", qty: "2", unit_cost: "1000" }] }));
    expect((await vf.getJobFlow(d, mgr(), job)).quotations.map((x) => x.status)).toEqual(["submitted", "rejected"]);
    await expect(vf.decideQuotation(d, mgr(), q1, "approve")).rejects.toThrow(/not awaiting a decision/i);
  });

  it("the requester cannot approve the quotation for their own card", async () => {
    // manager raises the card for themself; another manager approves it; the first one then tries to approve the quote
    const { id } = await jc.createJobCard(d, mgr(), { vehicle_id: veh, reason_code_id: reason, cause_text: "Own car needs brake work done", lines: [] }, true);
    await jc.transitionJobCard(d, mgr2(), id, "approved");
    await jc.transitionJobCard(d, mgr2(), id, "vendor_assigned", { vendorId: vA });
    await vf.submitQuotation(d, vendorA(), id, quote());
    await expect(vf.decideQuotation(d, mgr(), await quotationOf(id), "approve")).rejects.toThrow(/segregation/i);
    await vf.decideQuotation(d, mgr2(), await quotationOf(id), "approve");
    expect(await statusOf(id)).toBe("quotation_approved");
  });

  it("the person who approved the job card cannot verify its invoice", async () => {
    const job = await assigned();
    await vf.submitQuotation(d, vendorA(), job, quote());
    await vf.decideQuotation(d, mgr(), await quotationOf(job), "approve");
    const wo = await woOf(job);
    await vf.startWork(d, vendorA(), wo); await vf.completeWork(d, vendorA(), wo);
    await vf.submitInvoice(d, vendorA(), wo, await invoiceInput(job));
    // a finance login that is also the approver of this card (mgr2 holds the finance role here)
    await withPlatform(d, (q) => q.query("update public.tenant_memberships set role = 'finance' where user_id = $1 and tenant_id = $2", [U(13), t.tenantId]));
    await expect(vf.verifyInvoice(d, mem("finance", 13), await invoiceOf(wo), "pay_approved")).rejects.toThrow(/segregation/i);
    await withPlatform(d, (q) => q.query("update public.tenant_memberships set role = 'fleet_manager' where user_id = $1 and tenant_id = $2", [U(13), t.tenantId]));
  });
});

describe("permissions", () => {
  it("each step needs its own permission", async () => {
    const job = await assigned();
    const forbidden = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(ForbiddenError);
    await forbidden(vf.submitQuotation(d, mgr(), job, quote()));          // managers do not quote
    await forbidden(vf.submitQuotation(d, driver(), job, quote()));
    await vf.submitQuotation(d, vendorA(), job, quote());
    const q = await quotationOf(job);
    await forbidden(vf.decideQuotation(d, vendorA(), q, "approve"));       // vendors do not approve their own quote
    await forbidden(vf.decideQuotation(d, finance(), q, "approve"));
    await forbidden(vf.decideQuotation(d, driver(), q, "approve"));
    await forbidden(vf.getJobFlow(d, driver(), job));                      // prices are not for requesters
    await forbidden(vf.getJobFlow(d, vendorA(), job));
    await forbidden(vf.listInvoices(d, mgr()));
    await forbidden(vf.listInvoices(d, vendorA()));
    await forbidden(vf.vendorOverview(d, mgr()));
    await forbidden(jc.listJobCards(d, vendorA()));                        // a vendor reads no job cards
    await forbidden(jc.transitionJobCard(d, vendorA(), job, "closed"));
    await forbidden(jc.transitionJobCard(d, mgr(), job, "closed"));
  });

  it("another workspace sees none of it", async () => {
    const { job } = await completed();
    const other = await provisionTenant(d, { name: "Other Co", slug: "other", ownerUserId: U(2), ownerName: "O" }, tenantMigrations(), { transform: stripExt });
    const o: Membership = { ...other, userId: U(60), role: "fleet_manager", vehicleScope: "all" };
    expect((await vf.getJobFlow(d, o, job)).quotations).toEqual([]);
    expect(await vf.listInvoices(d, { ...o, role: "finance" })).toEqual([]);
  });
});
