import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import * as vf from "@/lib/vendorflow/service";
import type { BlobStore } from "@/lib/jobcards/attachments";
import { seedDemo } from "@/lib/demo/seed";

let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, userId: string): Membership => ({ ...t, userId, role, vehicleScope: "all" });
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, mem("tenant_admin", "00000000-0000-0000-0000-0000000000aa"), fn);
const userOf = (no: string) => raw(async (q) => (await q.query<{ user_id: string }>("select user_id from employees where employee_no = $1", [no])).rows[0].user_id);
const submittedInvoice = () => raw(async (q) => (await q.query<{ id: string }>("select id from invoices where status = 'submitted' order by invoice_date limit 1")).rows[0].id);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const NOBODY = "00000000-0000-0000-0000-0000000000f1";

function fakeStore() {
  const files = new Map<string, Uint8Array>();
  const store: BlobStore = { async put(p, b) { files.set(p, b); }, async remove(p) { files.delete(p); }, async signedUrl(p) { return files.has(p) ? `https://signed.example/${p}` : null; } };
  return { store, files };
}

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Demo Workspace", slug: "demo" }, tenantMigrations(), { transform: stripExt });
  await seedDemo(d, t);
});

describe("invoice review", () => {
  it("lines side by side: what was quoted, approved and invoiced, with the extra line flagged", async () => {
    const finance = mem("finance", await userOf("E-301"));
    const r = (await vf.getInvoiceReview(d, finance, await submittedInvoice()))!;
    expect(r.vendor_name).toBe("Quick Fix Motors");
    expect(r.vehicle_label).toBe("Toyota Hilux");
    expect(r.wo_no).toMatch(/^WO-\d{6}$/);
    const quoted = r.comparison.filter((x) => x.check !== "not_approved");
    expect(quoted.length).toBeGreaterThan(0);
    expect(quoted.every((x) => x.check === "ok" && x.quoted === x.approved && x.invoiced === x.quoted)).toBe(true);
    const extra = r.comparison.filter((x) => x.check === "not_approved");
    expect(extra).toHaveLength(1);
    expect(extra[0]).toMatchObject({ item: "Compressor clutch relay", quoted: null, approved: null, invoiced: 1800 });
    expect(r.totals.invoiced - r.totals.approved).toBe(1800);
    expect(r.totals.over).toBe(1800);
    expect(r.totals.overPct).toBeCloseTo((1800 / r.totals.approved) * 100, 0);
    expect(r.unapproved_lines).toBe(1);
  });

  it("notices a changed quantity, a changed price and an unbilled line", async () => {
    const id = await submittedInvoice();
    const finance = mem("finance", await userOf("E-301"));
    await raw(async (q) => {
      await q.query("update invoice_lines set qty = qty + 1 where invoice_id = $1 and quotation_line_id is not null", [id]);
    });
    expect((await vf.getInvoiceReview(d, finance, id))!.comparison.filter((x) => x.check === "qty")).toHaveLength(1);
    await raw(async (q) => {
      await q.query("update invoice_lines set qty = (select qty from quotation_lines ql where ql.id = quotation_line_id), unit_cost = unit_cost + 100 where invoice_id = $1 and quotation_line_id is not null", [id]);
    });
    expect((await vf.getInvoiceReview(d, finance, id))!.comparison.filter((x) => x.check === "price")).toHaveLength(1);
    await raw(async (q) => { await q.query("delete from invoice_lines where invoice_id = $1 and quotation_line_id is not null", [id]); });
    expect((await vf.getInvoiceReview(d, finance, id))!.comparison.filter((x) => x.check === "not_billed")).toHaveLength(1);
  });

  it("says who is barred from checking: the approver and the requester", async () => {
    const id = await submittedInvoice();
    const approver = mem("finance", await userOf("E-202"));                       // Ayesha approved the job card
    expect((await vf.getInvoiceReview(d, approver, id))!.blocked).toEqual({ by: "approver", name: "Ayesha Noor" });
    await expect(vf.verifyInvoice(d, approver, id, "pay_approved")).rejects.toThrow(/segregation/i);
    expect((await vf.getInvoiceReview(d, mem("finance", await userOf("E-301")), id))!.blocked).toBeNull();
    const requester = "00000000-0000-0000-0000-0000000000c9";
    await raw((q) => q.query("update employees set user_id = $1 where employee_no = 'E-102'", [requester]));   // Bilal raised that card
    expect((await vf.getInvoiceReview(d, mem("finance", requester), id))!.blocked).toEqual({ by: "requester", name: "Bilal Raza" });
  });

  it("points at the next invoice waiting, and counts them", async () => {
    const finance = mem("finance", await userOf("E-301"));
    const id = await submittedInvoice();
    expect((await vf.getInvoiceReview(d, finance, id))!).toMatchObject({ next: null, waiting: 0 });   // only one is waiting
    // fabricate a second submitted invoice on a verified job to test the pointer
    const other = await raw(async (q) => (await q.query<{ id: string }>("select id from invoices where status = 'verified' limit 1")).rows[0].id);
    await raw((q) => q.query("update invoices set status = 'submitted', decision = null, payable_amount = null, verified_by = null, verified_at = null where id = $1", [other]));
    const r = (await vf.getInvoiceReview(d, finance, id))!;
    expect(r.waiting).toBe(1);
    expect(r.next).toBe(other);
  });

  it("needs invoice.verify, and an unknown invoice gives nothing", async () => {
    const id = await submittedInvoice();
    for (const role of ["requester", "vendor", "hr", "security"]) await expect(vf.getInvoiceReview(d, mem(role, NOBODY), id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await vf.getInvoiceReview(d, mem("finance", NOBODY), "00000000-0000-4000-8000-0000000000aa")).toBeNull();
  });
});

describe("files on quotations and invoices", () => {
  const vendorUser = async () => raw(async (q) => (await q.query<{ user_id: string }>("select user_id from vendors where name = 'Quick Fix Motors'")).rows[0].user_id);
  const otherVendorUser = async () => raw(async (q) => (await q.query<{ user_id: string }>("select user_id from vendors where name = 'Al-Noor Auto Works'")).rows[0].user_id);

  it("a workshop attaches to its own open invoice; the fleet side can read it", async () => {
    const { store, files } = fakeStore();
    const id = await submittedInvoice();
    await vf.vendorAttach(d, store, mem("vendor", await vendorUser()), "invoice", id, { name: "invoice.jpg", bytes: jpeg });
    expect([...files.keys()][0]).toContain(`${t.schema}/invoice/${id}/`);
    const list = await vf.listCommercialFiles(d, store, mem("finance", await userOf("E-301")), "invoice", id);
    expect(list).toHaveLength(1);
    expect(list[0].url).toContain(`/invoice/${id}/`);
    expect(await vf.vendorListInvoiceFiles(d, store, mem("vendor", await vendorUser()), id)).toHaveLength(1);
    expect(await vf.vendorListInvoiceFiles(d, store, mem("vendor", await otherVendorUser()), id)).toEqual([]);   // another workshop sees nothing
  });

  it("another workshop, a manager and a requester cannot attach to it", async () => {
    const { store } = fakeStore();
    const id = await submittedInvoice();
    await expect(vf.vendorAttach(d, store, mem("vendor", await otherVendorUser()), "invoice", id, { name: "x.jpg", bytes: jpeg })).rejects.toBeInstanceOf(UserError);
    await expect(vf.vendorAttach(d, store, mem("fleet_manager", await userOf("E-201")), "invoice", id, { name: "x.jpg", bytes: jpeg })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(vf.vendorAttach(d, store, mem("requester", NOBODY), "quotation", id, { name: "x.jpg", bytes: jpeg })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a checked invoice and a decided quotation are closed to new files", async () => {
    const { store } = fakeStore();
    const verified = await raw(async (q) => (await q.query<{ id: string; user_id: string }>(
      "select i.id, vn.user_id from invoices i join work_orders wo on wo.id = i.work_order_id join vendors vn on vn.id = wo.vendor_id where i.status = 'verified' and vn.user_id is not null limit 1")).rows[0]);
    await expect(vf.vendorAttach(d, store, mem("vendor", verified.user_id), "invoice", verified.id, { name: "late.jpg", bytes: jpeg })).rejects.toThrow(/not open/);
    const approved = await raw(async (q) => (await q.query<{ id: string; user_id: string }>(
      "select q.id, vn.user_id from quotations q join vendors vn on vn.id = q.vendor_id where q.status = 'approved' and vn.user_id is not null limit 1")).rows[0]);
    await expect(vf.vendorAttach(d, store, mem("vendor", approved.user_id), "quotation", approved.id, { name: "late.pdf", bytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46, 1]) })).rejects.toThrow(/not open/);
  });

  it("a quotation waiting for a decision takes the printed quotation", async () => {
    const { store, files } = fakeStore();
    const open = await raw(async (q) => (await q.query<{ id: string; user_id: string }>(
      "select q.id, vn.user_id from quotations q join vendors vn on vn.id = q.vendor_id where q.status = 'submitted' limit 1")).rows[0]);
    await vf.vendorAttach(d, store, mem("vendor", open.user_id), "quotation", open.id, { name: "printed quote.pdf", bytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46, 1, 2]) });
    expect([...files.keys()][0]).toMatch(/\/quotation\/.+printed_quote\.pdf$/);
    await expect(vf.vendorAttach(d, store, mem("vendor", open.user_id), "quotation", open.id, { name: "bad.exe", bytes: Uint8Array.from([1, 2, 3]) })).rejects.toBeInstanceOf(UserError);
  });
});
