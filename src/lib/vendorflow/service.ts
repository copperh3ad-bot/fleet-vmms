// Vendor flow: quotation, work order, invoice, finance check. Every function checks the permission first
// (CLAUDE.md rule 3). A vendor reads only the v_vendor_* views, which filter on the signed-in user; the vendor
// functions in migration 0007 check again that the job or order belongs to that vendor's login.
import { z } from "zod";
import type { Driver, Queryable } from "@/lib/db/types";
import { authorized, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";
import { lineSchema } from "@/lib/jobcards/schemas";
import { friendly, notifyAfter } from "@/lib/jobcards/service";
import { notify } from "@/lib/notify";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const intOpt = (max: number) => z.preprocess(blank, z.coerce.number().int().min(0).max(max).optional());

export const quotationSchema = z.object({
  details: z.preprocess(blank, z.string().trim().max(2000).optional()),
  days_needed: z.preprocess(blank, z.coerce.number().int().min(1, "At least 1 day").max(365).optional()),
  valid_until: z.preprocess(blank, z.iso.date().optional()),
  warranty_months: intOpt(120),
  lines: z.array(lineSchema).min(1, "Add at least one line").max(50),
});

export const invoiceSchema = z.object({
  invoice_no: z.string().trim().min(1, "Enter the invoice number").max(60),
  invoice_date: z.preprocess(blank, z.iso.date().optional()),
  tax_amount: z.preprocess(blank, z.coerce.number().min(0).max(99_999_999).optional()),
  lines: z.array(lineSchema.extend({ quotation_line_id: z.preprocess(blank, z.uuid().optional()) })).min(1, "Add at least one line").max(50),
});

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new UserError("Fix the highlighted fields.", fieldErrors(r.error));
  return r.data;
}

async function vendorUserOfJob(q: Queryable, jobId: string): Promise<string | null> {
  return (await q.query<{ user_id: string | null }>("select vn.user_id from job_cards jc join vendors vn on vn.id = jc.vendor_id where jc.id = $1", [jobId])).rows[0]?.user_id ?? null;
}

// ============================ Manager and finance side ============================

export type QuotationView = {
  id: string; status: string; amount: string; details: string | null; days_needed: number | null; valid_until: string | null;
  warranty_months: number | null; created_at: string; vendor_name: string;
  lines: { id: string; kind: string; description: string; qty: string; unit_cost: string }[];
};
export type InvoiceView = {
  id: string; invoice_no: string; invoice_date: string; amount: string; tax_amount: string; status: string; payable_amount: string | null;
  decision: string | null; decision_note: string | null;
  lines: { id: string; kind: string; description: string; qty: string; unit_cost: string; quotation_line_id: string | null }[];
};
export type JobFlow = {
  quotations: QuotationView[];
  workOrder: { id: string; wo_no: string; status: string; approved_amount: string; issued_at: string; completed_at: string | null } | null;
  invoices: InvoiceView[];
};

/** Everything the commercial side of a job card shows. Vendor prices are for people who can read all cards. */
export function getJobFlow(driver: Driver, m: Membership, jobId: string): Promise<JobFlow> {
  return authorized(driver, m, "jobcard.read_all", async (q) => {
    const quotations = (await q.query<Omit<QuotationView, "lines">>(
      `select q.id, q.status, q.amount::text, q.details, q.days_needed, q.valid_until::text, q.warranty_months, q.created_at::text, vn.name as vendor_name
         from quotations q join vendors vn on vn.id = q.vendor_id where q.job_card_id = $1 order by q.created_at desc`, [jobId])).rows as QuotationView[];
    for (const x of quotations) x.lines = (await q.query<QuotationView["lines"][number]>(
      "select id, kind, description, qty::text, unit_cost::text from quotation_lines where quotation_id = $1 order by id", [x.id])).rows;
    const workOrder = (await q.query<NonNullable<JobFlow["workOrder"]>>(
      "select id, wo_no, status, approved_amount::text, issued_at::text, completed_at::text from work_orders where job_card_id = $1", [jobId])).rows[0] ?? null;
    const invoices = workOrder ? (await q.query<Omit<InvoiceView, "lines">>(
      `select id, invoice_no, invoice_date::text, amount::text, tax_amount::text, status, payable_amount::text, decision, decision_note
         from invoices where work_order_id = $1 order by invoice_date desc, id`, [workOrder.id])).rows as InvoiceView[] : [];
    for (const i of invoices) i.lines = (await q.query<InvoiceView["lines"][number]>(
      "select id, kind, description, qty::text, unit_cost::text, quotation_line_id from invoice_lines where invoice_id = $1 order by id", [i.id])).rows;
    return { quotations, workOrder, invoices };
  });
}

export function decideQuotation(driver: Driver, m: Membership, quotationId: string, decision: "approve" | "reject", note?: string): Promise<void> {
  return authorized(driver, m, "quotation.approve", async (q) => {
    const jobId = (await q.query<{ job_card_id: string }>("select job_card_id from quotations where id = $1", [quotationId])).rows[0]?.job_card_id;
    if (!jobId) throw new UserError("Quotation not found.");
    try {
      if (decision === "approve") await q.query("select approve_quotation($1, $2, $3)", [quotationId, m.userId, note?.trim() || null]);
      else await q.query("select reject_quotation($1, $2, $3)", [quotationId, m.userId, note ?? null]);
    } catch (e) { friendly(e); }
    if (decision === "approve") await notifyAfter(q, m, jobId, "quotation_approved");
    else await notify(q, [await vendorUserOfJob(q, jobId)], "quotation.rejected", { job_card_id: jobId, job_no: (await q.query<{ job_no: string }>("select job_no from job_cards where id = $1", [jobId])).rows[0].job_no }, m.userId);
  });
}

export type InvoiceRow = { id: string; invoice_no: string; invoice_date: string; amount: string; status: string; job_no: string; job_card_id: string; vendor_name: string; registration_no: string };

export function listInvoices(driver: Driver, m: Membership, opts: { status?: string } = {}): Promise<InvoiceRow[]> {
  return authorized(driver, m, "invoice.verify", async (q) =>
    (await q.query<InvoiceRow>(
      `select i.id, i.invoice_no, i.invoice_date::text, i.amount::text, i.status, jc.job_no, jc.id as job_card_id, vn.name as vendor_name, v.registration_no
         from invoices i join work_orders wo on wo.id = i.work_order_id join job_cards jc on jc.id = wo.job_card_id
         join vendors vn on vn.id = wo.vendor_id join vehicles v on v.id = jc.vehicle_id
        ${opts.status ? "where i.status = $1" : ""} order by i.invoice_date desc, i.id limit 300`, opts.status ? [opts.status] : [])).rows);
}

export type InvoiceCheck = InvoiceRow & {
  tax_amount: string; approved_amount: string; variance: string; variance_pct: string | null; unapproved_lines: number;
  decision: string | null; decision_note: string | null; payable_amount: string | null; job_status: string;
  lines: (InvoiceView["lines"][number] & { approved: boolean })[];
};

export function getInvoiceCheck(driver: Driver, m: Membership, id: string): Promise<InvoiceCheck | null> {
  return authorized(driver, m, "invoice.verify", async (q) => {
    const r = (await q.query<InvoiceCheck>(
      `select i.id, i.invoice_no, i.invoice_date::text, i.amount::text, i.tax_amount::text, i.status, jc.job_no, jc.id as job_card_id, jc.status as job_status,
              vn.name as vendor_name, v.registration_no, c.approved_amount::text, c.variance::text, c.variance_pct::text, c.unapproved_lines::int,
              i.decision, i.decision_note, i.payable_amount::text
         from invoices i join v_invoice_check c on c.invoice_id = i.id join work_orders wo on wo.id = i.work_order_id
         join job_cards jc on jc.id = wo.job_card_id join vendors vn on vn.id = wo.vendor_id join vehicles v on v.id = jc.vehicle_id
        where i.id = $1`, [id])).rows[0];
    if (!r) return null;
    r.lines = (await q.query<InvoiceCheck["lines"][number]>(
      "select id, kind, description, qty::text, unit_cost::text, quotation_line_id, (quotation_line_id is not null) as approved from invoice_lines where invoice_id = $1 order by id", [id])).rows;
    return r;
  });
}

export function verifyInvoice(driver: Driver, m: Membership, id: string, decision: string, note?: string): Promise<void> {
  return authorized(driver, m, "invoice.verify", async (q) => {
    const jobId = (await q.query<{ job_card_id: string }>("select wo.job_card_id from invoices i join work_orders wo on wo.id = i.work_order_id where i.id = $1", [id])).rows[0]?.job_card_id;
    if (!jobId) throw new UserError("Invoice not found.");
    if (!["pay_approved", "pay_full", "return"].includes(decision)) throw new UserError("Choose a decision.");
    try { await q.query("select verify_invoice($1, $2, $3, $4)", [id, m.userId, decision, note?.trim() || null]); } catch (e) { friendly(e); }
    const job_no = (await q.query<{ job_no: string }>("select job_no from job_cards where id = $1", [jobId])).rows[0].job_no;
    await notify(q, [await vendorUserOfJob(q, jobId)], decision === "return" ? "invoice.returned" : "invoice.verified", { job_card_id: jobId, job_no }, m.userId);
  });
}

// ============================ Vendor side ============================

export type VendorRequest = { job_card_id: string; job_no: string; job_status: string; priority: string; needed_by: string | null; description: string | null; cause_text: string;
  odometer_km: string | null; registration_no: string; make: string | null; model: string | null; year: number | null; last_quotation_status: string | null };
export type VendorOrder = { work_order_id: string; wo_no: string; wo_status: string; issued_at: string; approved_amount: string; job_no: string; priority: string; needed_by: string | null;
  description: string | null; cause_text: string; registration_no: string; make: string | null; model: string | null; year: number | null; job_card_id: string; job_status: string;
  quotation_id: string | null; completed_at: string | null };

export function vendorOverview(driver: Driver, m: Membership): Promise<{ requests: VendorRequest[]; orders: VendorOrder[] }> {
  return authorized(driver, m, "quotation.submit", async (q) => ({
    requests: (await q.query<VendorRequest>("select job_card_id, job_no, job_status, priority, needed_by::text, description, cause_text, odometer_km::text, registration_no, make, model, year, last_quotation_status from v_vendor_job_requests order by needed_by nulls last, job_no")).rows,
    orders: (await q.query<VendorOrder>("select work_order_id, wo_no, wo_status, issued_at::text, approved_amount::text, job_no, priority, needed_by::text, description, cause_text, registration_no, make, model, year, job_card_id, job_status, quotation_id, completed_at::text from v_vendor_work_orders order by issued_at desc")).rows,
  }));
}

export function vendorGetRequest(driver: Driver, m: Membership, jobId: string): Promise<VendorRequest | null> {
  return authorized(driver, m, "quotation.submit", async (q) =>
    (await q.query<VendorRequest>("select job_card_id, job_no, job_status, priority, needed_by::text, description, cause_text, odometer_km::text, registration_no, make, model, year, last_quotation_status from v_vendor_job_requests where job_card_id = $1", [jobId])).rows[0] ?? null);
}

export async function submitQuotation(driver: Driver, m: Membership, jobId: string, input: unknown): Promise<void> {
  const data = parse(quotationSchema, input);
  return authorized(driver, m, "quotation.submit", async (q) => {
    try { await q.query("select submit_quotation($1, $2, $3::jsonb)", [jobId, m.userId, JSON.stringify(data)]); } catch (e) { friendly(e); }
    await notifyAfter(q, m, jobId, "quotation_received");
  });
}

export type VendorOrderDetail = VendorOrder & {
  quotation_lines: { line_id: string; kind: string; description: string; qty: string; unit_cost: string }[];
  invoices: { invoice_id: string; invoice_no: string; invoice_date: string; amount: string; tax_amount: string; status: string; payable_amount: string | null; decision: string | null; return_note: string | null }[];
};

export function vendorGetOrder(driver: Driver, m: Membership, woId: string): Promise<VendorOrderDetail | null> {
  return authorized(driver, m, "quotation.submit", async (q) => {
    const o = (await q.query<VendorOrderDetail>("select work_order_id, wo_no, wo_status, issued_at::text, approved_amount::text, job_no, priority, needed_by::text, description, cause_text, registration_no, make, model, year, job_card_id, job_status, quotation_id, completed_at::text from v_vendor_work_orders where work_order_id = $1", [woId])).rows[0];
    if (!o) return null;
    o.quotation_lines = (await q.query<VendorOrderDetail["quotation_lines"][number]>("select line_id, kind, description, qty::text, unit_cost::text from v_vendor_quotation_lines where quotation_id = $1 order by line_id", [o.quotation_id])).rows;
    o.invoices = (await q.query<VendorOrderDetail["invoices"][number]>("select invoice_id, invoice_no, invoice_date::text, amount::text, tax_amount::text, status, payable_amount::text, decision, return_note from v_vendor_invoices where work_order_id = $1 order by invoice_date desc", [woId])).rows;
    return o;
  });
}

async function vendorStep(driver: Driver, m: Membership, woId: string, fn: string, args: unknown[], to: string) {
  return authorized(driver, m, "workorder.update", async (q) => {
    const jobId = (await q.query<{ job_card_id: string }>("select job_card_id from v_vendor_work_orders where work_order_id = $1", [woId])).rows[0]?.job_card_id;
    if (!jobId) throw new UserError("Work order not found.");
    try { await q.query(`select ${fn}($1, $2${args.length ? ", $3" : ""})`, [woId, m.userId, ...args]); } catch (e) { friendly(e); }
    await notifyAfter(q, m, jobId, to);
  });
}
export const startWork = (driver: Driver, m: Membership, woId: string) => vendorStep(driver, m, woId, "vendor_start_work", [], "in_progress");
export const completeWork = (driver: Driver, m: Membership, woId: string, note?: string) => vendorStep(driver, m, woId, "vendor_complete_work", [note?.trim() || null], "completed");

export async function submitInvoice(driver: Driver, m: Membership, woId: string, input: unknown): Promise<void> {
  const data = parse(invoiceSchema, input);
  return authorized(driver, m, "invoice.submit", async (q) => {
    const jobId = (await q.query<{ job_card_id: string }>("select job_card_id from v_vendor_work_orders where work_order_id = $1", [woId])).rows[0]?.job_card_id;
    if (!jobId) throw new UserError("Work order not found.");
    try { await q.query("select submit_invoice($1, $2, $3::jsonb)", [woId, m.userId, JSON.stringify(data)]); } catch (e) { friendly(e); }
    await notifyAfter(q, m, jobId, "invoiced");
  });
}
