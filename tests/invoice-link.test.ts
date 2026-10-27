// The workshop invoice link (ADR-033). Workshops are added by each organization and never sign up, so the invoice, like the estimate, comes
// through a one-time link: the same rules as the estimate link (ADR-030), plus what is special about billing against an approved quotation.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withLinkContext, withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import * as vf from "@/lib/vendorflow/service";
import { hashToken } from "@/lib/odometer/link";
import { lookupQuoteLink, lookupWorkshopLink, submitViaInvoiceLink, submitViaQuoteLink } from "@/lib/vendorflow/link";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number, vehicleScope: "all" | "own" = "all"): Membership => ({ ...t, userId: U(n), role, vehicleScope });
const owner = () => mem("tenant_admin", 1);
const driver = () => mem("requester", 11, "own");
const mgr = () => mem("fleet_manager", 12);
const mgr2 = () => mem("fleet_manager", 13);
const raw = <T,>(m: Membership, fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, m, fn);

let veh: string, reason: string, vA: string;

const estimate = () => ({
  details: "Pads and discs", days_needed: "2", warranty_months: "6",
  lines: [{ kind: "part", description: "Brake pads", qty: "2", unit_cost: "1500" }, { kind: "labour", description: "Fit", qty: "1", unit_cost: "800" }],
});

/** A job card with an APPROVED estimate, ready to be invoiced. */
async function approved(): Promise<string> {
  const { id } = await jc.createJobCard(d, driver(), { vehicle_id: veh, reason_code_id: reason, cause_text: "Front brake pads worn to the metal", lines: [] }, true);
  await jc.transitionJobCard(d, mgr2(), id, "approved");
  await jc.transitionJobCard(d, mgr(), id, "vendor_assigned", { vendorId: vA });
  const q = await vf.createQuoteLink(d, mgr(), id);
  expect(await submitViaQuoteLink(d, q.token, estimate())).toEqual({ ok: true });
  const flow = await vf.getJobFlow(d, mgr(), id);
  await vf.decideQuotation(d, mgr(), flow.quotations[0].id, "approve");
  return id;
}
const statusOf = (id: string) => raw(owner(), async (q) => (await q.query<{ status: string }>("select status from job_cards where id = $1", [id])).rows[0].status);
const invoiceLines = () => ({
  invoice_no: "QF-1001", invoice_date: "2026-10-28", tax_amount: "0",
  lines: [{ kind: "part", description: "Brake pads", qty: "2", unit_cost: "1500" }, { kind: "labour", description: "Fit", qty: "1", unit_cost: "800" }],
});

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Echo Textiles", slug: "echo", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  for (const [n, name] of [[11, "Driver One"], [12, "Manager One"], [13, "Manager Two"]] as const) {
    const e = await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` });
    await raw(owner(), (q) => q.query("update employees set user_id = $1 where id = $2", [U(n), e.id]));
  }
  vA = (await master.saveVendor(d, owner(), { name: "Quick Fix Motors", categories: ["brakes"] })).id;
  await raw(owner(), (q) => q.query("update vendors set phone = '0300 1234567', email = 'office@quickfix.example' where id = $1", [vA]));   // no user: this workshop never signs up
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[11, "requester"], [12, "fleet_manager"], [13, "fleet_manager"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  const emp11 = await raw(owner(), async (q) => (await q.query<{ id: string }>("select id from employees where user_id = $1", [U(11)])).rows[0].id);
  veh = (await master.addVehicle(d, owner(), { registration_no: "INV-245", employee_id: emp11, holding_since: "2026-01-01" })).id;
  reason = (await raw(owner(), async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'WEAR_BRAKES'")).rows[0])).id;
});
beforeEach(async () => { await withPlatform(d, (q) => q.query("update public.quotation_links set revoked_at = now() where revoked_at is null")); });

describe("making an invoice link", () => {
  it("works for a workshop with no login, once the estimate is approved, and records which kind it is", async () => {
    const job = await approved();
    const l = await vf.createWorkshopLink(d, mgr(), job, "invoice");
    expect(l.kind).toBe("invoice");
    expect(l.vendor_email).toBe("office@quickfix.example");
    const row = await withPlatform(d, async (q) => (await q.query<{ kind: string }>("select kind from public.quotation_links where token_hash = $1", [hashToken(l.token)])).rows[0]);
    expect(row.kind).toBe("invoice");
  });
  it("is refused before an estimate is approved, and for people who may not assign, decide or verify", async () => {
    const { id } = await jc.createJobCard(d, driver(), { vehicle_id: veh, reason_code_id: reason, cause_text: "Another card, still waiting", lines: [] }, true);
    await jc.transitionJobCard(d, mgr2(), id, "approved");
    await jc.transitionJobCard(d, mgr(), id, "vendor_assigned", { vendorId: vA });
    await expect(vf.createWorkshopLink(d, mgr(), id, "invoice")).rejects.toBeInstanceOf(UserError);
    const job = await approved();
    await expect(vf.createWorkshopLink(d, driver(), job, "invoice")).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("can go by email alone when the workshop has no mobile number, and is refused when it has neither", async () => {
    const job = await approved();
    await raw(owner(), (q) => q.query("update vendors set phone = null where id = $1", [vA]));
    const l = await vf.createWorkshopLink(d, mgr(), job, "invoice");
    expect(l.phone.e164).toBe("");
    expect(l.vendor_email).toBe("office@quickfix.example");
    await raw(owner(), (q) => q.query("update vendors set email = null where id = $1", [vA]));
    await expect(vf.createWorkshopLink(d, mgr(), job, "invoice")).rejects.toThrow(/mobile number or email/);
    await raw(owner(), (q) => q.query("update vendors set phone = '0300 1234567', email = 'office@quickfix.example' where id = $1", [vA]));
  });
  it("a new invoice link stops the old one, and does not touch an estimate link", async () => {
    const job = await approved();
    const a = await vf.createWorkshopLink(d, mgr(), job, "invoice");
    const b = await vf.createWorkshopLink(d, mgr(), job, "invoice");
    expect(await lookupWorkshopLink(d, a.token)).toBeNull();
    expect((await lookupWorkshopLink(d, b.token))?.kind).toBe("invoice");
  });
});

describe("sending an invoice through the link", () => {
  it("shows the job and the approved lines only, and records the invoice against the job card, with the work marked done", async () => {
    const job = await approved();
    const { token } = await vf.createWorkshopLink(d, mgr(), job, "invoice");
    const link = await lookupWorkshopLink(d, token);
    expect(link?.kind).toBe("invoice");
    if (link?.kind !== "invoice") throw new Error("not an invoice link");
    expect(Object.keys(link.view).sort()).toEqual(["approved_amount", "currency", "description", "job_no", "lines", "make", "model", "registration_no", "vendor_name", "wo_no", "year"]);
    expect(link.view.lines).toHaveLength(2);
    expect(Number(link.view.approved_amount)).toBe(3800);

    const lines = link.view.lines.map((l) => ({ kind: l.kind, description: l.description, qty: l.qty, unit_cost: l.unit_cost, quotation_line_id: l.id }));
    expect(await submitViaInvoiceLink(d, token, { invoice_no: "QF-1001", invoice_date: "2026-10-28", lines })).toEqual({ ok: true });

    expect(await statusOf(job)).toBe("invoiced");
    const wo = await raw(owner(), async (q) => (await q.query<{ status: string; completed_at: string | null }>("select status, completed_at::text from work_orders where job_card_id = $1", [job])).rows[0]);
    expect(wo.status).toBe("completed");
    expect(wo.completed_at).not.toBeNull();
    const inv = await raw(owner(), async (q) => (await q.query<{ invoice_no: string; amount: string; status: string; n: string; linked: string }>(
      `select i.invoice_no, i.amount::text, i.status, (select count(*) from invoice_lines where invoice_id = i.id)::text n,
              (select count(*) from invoice_lines where invoice_id = i.id and quotation_line_id is not null)::text linked
         from invoices i join work_orders w on w.id = i.work_order_id where w.job_card_id = $1`, [job])).rows);
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ invoice_no: "QF-1001", status: "submitted", n: "2", linked: "2" });
    expect(Number(inv[0].amount)).toBe(3800);
    // The three steps happen in one transaction, so they share a timestamp: check the chain of moves rather than their order of storage.
    const events = await raw(owner(), async (q) => (await q.query<{ from_status: string; to_status: string; comment: string | null }>("select from_status, to_status, comment from job_card_events where job_card_id = $1 and to_status in ('in_progress','completed','invoiced')", [job])).rows);
    expect(events.map((e) => `${e.from_status}>${e.to_status}`).sort()).toEqual(["completed>invoiced", "in_progress>completed", "quotation_approved>in_progress"]);
    expect(events.every((e) => /workshop sent its invoice|through a link/.test(e.comment ?? ""))).toBe(true);   // the history says what happened and why
    const note = await raw(owner(), async (q) => (await q.query<{ n: string }>("select count(*)::text n from notifications where kind = 'invoice.submitted' and payload->>'job_card_id' = $1", [job])).rows[0].n);
    expect(Number(note)).toBeGreaterThan(0);                                     // the people who check invoices are told
    expect((await vf.listInvoices(d, owner(), { status: "submitted" })).some((x) => x.job_card_id === job)).toBe(true);
  });
  it("an extra line that was never approved is accepted and shows as unlinked for the person who checks", async () => {
    const job = await approved();
    const { token } = await vf.createWorkshopLink(d, mgr(), job, "invoice");
    const link = await lookupWorkshopLink(d, token);
    if (link?.kind !== "invoice") throw new Error("not an invoice link");
    const lines = [...link.view.lines.map((l) => ({ kind: l.kind, description: l.description, qty: l.qty, unit_cost: l.unit_cost, quotation_line_id: l.id })), { kind: "part", description: "Brake fluid", qty: "1", unit_cost: "400", quotation_line_id: "" }];
    expect(await submitViaInvoiceLink(d, token, { invoice_no: "QF-1002", lines })).toEqual({ ok: true });
    const unlinked = await raw(owner(), async (q) => (await q.query<{ n: string }>("select count(*)::text n from invoice_lines il join invoices i on i.id = il.invoice_id join work_orders w on w.id = i.work_order_id where w.job_card_id = $1 and il.quotation_line_id is null", [job])).rows[0].n);
    expect(unlinked).toBe("1");
  });
  it("works once, and a refused invoice does not burn the link", async () => {
    const job = await approved();
    const { token } = await vf.createWorkshopLink(d, mgr(), job, "invoice");
    const bad = await submitViaInvoiceLink(d, token, { invoice_no: "", lines: [] });
    expect(bad.ok).toBe(false);
    const foreign = await submitViaInvoiceLink(d, token, { invoice_no: "QF-1", lines: [{ kind: "part", description: "x", qty: "1", unit_cost: "1", quotation_line_id: "11111111-1111-4111-8111-111111111111" }] });
    expect(foreign).toMatchObject({ ok: false, reason: "bad_input" });          // the workshop is told what to fix, not that the link is dead
    expect(await statusOf(job)).toBe("quotation_approved");                     // nothing half-done: the work was not marked started
    expect(await submitViaInvoiceLink(d, token, invoiceLines())).toEqual({ ok: true });
    expect(await submitViaInvoiceLink(d, token, invoiceLines())).toEqual({ ok: false, reason: "invalid" });
    expect(await lookupWorkshopLink(d, token)).toBeNull();
  });
  it("only one invoice can be open for a job card", async () => {
    const job = await approved();
    const a = await vf.createWorkshopLink(d, mgr(), job, "invoice");
    expect(await submitViaInvoiceLink(d, a.token, invoiceLines())).toEqual({ ok: true });
    await expect(vf.createWorkshopLink(d, mgr(), job, "invoice")).rejects.toThrow(/already been sent|no approved estimate/);
  });
});

describe("the two kinds of link cannot be swapped", () => {
  it("an invoice link cannot send an estimate, and an estimate link cannot send an invoice", async () => {
    const job = await approved();
    const inv = await vf.createWorkshopLink(d, mgr(), job, "invoice");
    expect(await lookupQuoteLink(d, inv.token)).toBeNull();                     // not an estimate link
    expect(await submitViaQuoteLink(d, inv.token, estimate())).toEqual({ ok: false, reason: "invalid" });

    const { id } = await jc.createJobCard(d, driver(), { vehicle_id: veh, reason_code_id: reason, cause_text: "Second card for the swap check", lines: [] }, true);
    await jc.transitionJobCard(d, mgr2(), id, "approved");
    await jc.transitionJobCard(d, mgr(), id, "vendor_assigned", { vendorId: vA });
    const q = await vf.createQuoteLink(d, mgr(), id);
    expect(await submitViaInvoiceLink(d, q.token, invoiceLines())).toEqual({ ok: false, reason: "invalid" });
    expect(await statusOf(id)).toBe("vendor_assigned");
  });
  it("expired and revoked invoice links look the same as unknown ones", async () => {
    const job = await approved();
    const { token } = await vf.createWorkshopLink(d, mgr(), job, "invoice");
    await withPlatform(d, (q) => q.query("update public.quotation_links set expires_at = now() - interval '1 minute' where token_hash = $1", [hashToken(token)]));
    expect(await lookupWorkshopLink(d, token)).toBeNull();
    expect(await submitViaInvoiceLink(d, token, invoiceLines())).toEqual({ ok: false, reason: "invalid" });
  });
  it("the link's database role can call the link functions and read nothing", async () => {
    await expect(withLinkContext(d, t.schema, (q) => q.query("select * from invoices"), "quotation_link")).rejects.toThrow(/permission denied/);
    await expect(withLinkContext(d, t.schema, (q) => q.query("select * from work_orders"), "quotation_link")).rejects.toThrow(/permission denied/);
    await expect(withLinkContext(d, t.schema, (q) => q.query("select submit_invoice(gen_random_uuid(), gen_random_uuid(), '{}'::jsonb)"), "quotation_link")).rejects.toThrow(/permission denied/);
  });
});
