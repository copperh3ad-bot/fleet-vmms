// Vendor flow: quotation, work order, invoice, finance check. Every function checks the permission first
// (CLAUDE.md rule 3). A vendor reads only the v_vendor_* views, which filter on the signed-in user; the vendor
// functions in migration 0007 check again that the job or order belongs to that vendor's login.
import { z } from "zod";
import type { Driver, Queryable } from "@/lib/db/types";
import { adminMayDecideOwn, authorized, authorizedAny, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";
import { lineSchema } from "@/lib/jobcards/schemas";
import { friendly, notifyAfter } from "@/lib/jobcards/service";
import { inboundConfigured, newReplyCode, replyCodeHash } from "./inbound";
import { notify } from "@/lib/notify";
import { waReplyHash } from "./whatsapp-inbound";
import { normalizePhone } from "@/lib/phone";
import { hashToken, newToken } from "@/lib/odometer/link";
import { routeToken } from "@/lib/orgs";
import { listAttachments, saveAttachment, type AttachmentRow, type BlobStore } from "@/lib/jobcards/attachments";

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
/** A department user reaches only the job cards of their department's vehicles (ADR-048). */
async function jobVisible(q: import("@/lib/db/types").Queryable, jobId: string): Promise<boolean> {
  return (await q.query("select 1 from job_cards where id = $1 and dept_ok(vehicle_id)", [jobId])).rows.length > 0;
}

export function getJobFlow(driver: Driver, m: Membership, jobId: string): Promise<JobFlow> {
  return authorized(driver, m, "jobcard.read_all", async (q) => {
    if (!(await jobVisible(q, jobId))) return { quotations: [], workOrder: null, invoices: [] };
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

export function decideQuotation(driver: Driver, m: Membership, quotationId: string, decision: "approve" | "reject", note?: string): Promise<{ jobId: string }> {
  return authorized(driver, m, "quotation.approve", async (q) => {
    const jobId = (await q.query<{ job_card_id: string }>("select qt.job_card_id from quotations qt join job_cards jc on jc.id = qt.job_card_id where qt.id = $1 and dept_ok(jc.vehicle_id)", [quotationId])).rows[0]?.job_card_id;
    if (!jobId) throw new UserError("Quotation not found.");
    try {
      if (decision === "approve") await q.query("select approve_quotation($1, $2, $3)", [quotationId, m.userId, note?.trim() || null]);
      else await q.query("select reject_quotation($1, $2, $3)", [quotationId, m.userId, note ?? null]);
    } catch (e) { friendly(e); }
    if (decision === "approve") await notifyAfter(q, m, jobId, "quotation_approved");
    else await notify(q, [await vendorUserOfJob(q, jobId)], "quotation.rejected", { job_card_id: jobId, job_no: (await q.query<{ job_no: string }>("select job_no from job_cards where id = $1", [jobId])).rows[0].job_no }, m.userId);
    return { jobId };
  });
}

/** Who to tell on WhatsApp about a job card's estimate or invoice (ADR-056): the workshop on it, its mobile number made international, and the job number. Null when it has no mobile number. */
export function workshopContact(driver: Driver, m: Membership, jobId: string): Promise<{ vendor_name: string; phone: string; job_no: string } | null> {
  return authorizedAny(driver, m, INVOICE_LINK_PERMS, async (q) => {
    const r = (await q.query<{ job_no: string; name: string | null; phone: string | null }>(
      "select jc.job_no, vn.name, vn.phone from job_cards jc left join vendors vn on vn.id = jc.vendor_id where jc.id = $1 and dept_ok(jc.vehicle_id)", [jobId])).rows[0];
    const p = r?.phone ? normalizePhone(r.phone) : null;
    return r && r.name && p?.ok ? { vendor_name: r.name, phone: p.e164, job_no: r.job_no } : null;
  });
}

export type WorkshopLinkKind = "quotation" | "invoice";
export type NewQuoteLink = { kind: WorkshopLinkKind; plate: string; token: string; replyCode: string | null; expires_at: string; job_no: string; vendor_name: string; vendor_email: string | null; phone: { e164: string; digits: string; display: string } };
const QUOTE_LINK_HOURS = 168;
const QUOTE_LINK_PERMS = ["jobcard.assign_vendor", "quotation.approve"];
const INVOICE_LINK_PERMS = ["jobcard.assign_vendor", "quotation.approve", "invoice.verify"];
/** The job card statuses in which each kind of link makes sense: waiting for an estimate, or an approved estimate still to be billed. */
const LINK_STATUSES: Record<WorkshopLinkKind, string[]> = { quotation: ["vendor_assigned"], invoice: ["quotation_approved", "in_progress", "completed"] };

/**
 * A fresh single-use link for the workshop on this job card, to be sent to the workshop's own phone number (ADR-030) or email (ADR-033).
 * `quotation` asks for the estimate; `invoice` asks for the invoice against the approved estimate. Any earlier unused link of the same
 * kind on this job card stops working. Workshops never sign up, so these links are how they send anything.
 */
export async function createWorkshopLink(driver: Driver, m: Membership, jobId: string, kind: WorkshopLinkKind, opts: { withReply?: boolean } = {}): Promise<NewQuoteLink> {
  const perms = kind === "quotation" ? QUOTE_LINK_PERMS : INVOICE_LINK_PERMS;
  const made = await authorizedAny(driver, m, perms, async (q) => {
    const j = (await q.query<{ job_no: string; status: string; vendor_id: string | null; vendor_name: string | null; phone: string | null; email: string | null; plate: string }>(
      "select jc.job_no, jc.status, jc.vendor_id, vn.name as vendor_name, vn.phone, vn.email, v.registration_no as plate from job_cards jc join vehicles v on v.id = jc.vehicle_id left join vendors vn on vn.id = jc.vendor_id where jc.id = $1 and dept_ok(jc.vehicle_id)", [jobId])).rows[0];
    if (!j) throw new UserError("Job card not found.");
    if (!j.vendor_id || !LINK_STATUSES[kind].includes(j.status)) throw new UserError(kind === "quotation" ? "This job card is not waiting for a workshop estimate." : "This job card has no approved estimate waiting to be invoiced.");
    if (kind === "invoice" && (await q.query("select 1 from work_orders wo where wo.job_card_id = $1 and wo.vendor_id = $2 and wo.status in ('issued','in_progress','completed') and not exists (select 1 from invoices i where i.work_order_id = wo.id and i.status in ('submitted','verified','paid'))", [jobId, j.vendor_id])).rows.length === 0)
      throw new UserError("An invoice has already been sent for this job card.");
    const phone = normalizePhone(j.phone ?? "");
    if (!phone.ok && !j.email) throw new UserError(`${j.vendor_name} has no mobile number or email a message can reach. Add one under Vendors first.`);
    await q.query("update public.quotation_links set revoked_at = now() where tenant_id = $1 and job_card_id = $2 and kind = $3 and used_at is null and revoked_at is null", [m.tenantId, jobId, kind]);
    const token = newToken();
    const replyCode = opts.withReply && inboundConfigured() ? newReplyCode() : null;     // only an emailed request can be answered by replying
    const exp = (await q.query<{ e: string }>(
      `insert into public.quotation_links(token_hash, tenant_id, job_card_id, vendor_id, created_by, expires_at, kind, reply_code_hash)
       values ($1, $2, $3, $4, $5, now() + ($6 || ' hours')::interval, $7, $8) returning expires_at::text as e`,
      [hashToken(token), m.tenantId, jobId, j.vendor_id, m.userId, String(QUOTE_LINK_HOURS), kind, replyCode ? replyCodeHash(replyCode) : null])).rows[0].e;
    return { kind, plate: j.plate, token, replyCode, expires_at: exp, job_no: j.job_no, vendor_name: j.vendor_name ?? "", vendor_email: j.email,
             phone: phone.ok ? { e164: phone.e164, digits: phone.digits, display: phone.display } : { e164: "", digits: "", display: "" } };
  });
  // The control plane learns which organization the link belongs to; without that it would not open.
  try {
    await routeToken(driver, kind, m.tenantId, hashToken(made.token), made.expires_at);
    if (made.replyCode) await routeToken(driver, "reply", m.tenantId, replyCodeHash(made.replyCode), made.expires_at);
  }
  catch {
    await authorizedAny(driver, m, perms, (q) => q.query("update public.quotation_links set revoked_at = now() where token_hash = $1", [hashToken(made.token)])).catch(() => undefined);
    throw new UserError("The link could not be created. Try again.");
  }
  return made;
}

/**
 * Remembers which WhatsApp message carried a request (ADR-042): a workshop's "reply" to it names that message, and it is found by a hash of its id, kept where an emailed
 * request keeps its reply code. Only the person who could make the link may do this, and only for a link of this organization.
 */
export async function attachWhatsAppReply(driver: Driver, m: Membership, token: string, messageId: string, expiresAt: string): Promise<void> {
  if (!messageId) return;
  const hash = waReplyHash(messageId);
  await authorizedAny(driver, m, [...QUOTE_LINK_PERMS, ...INVOICE_LINK_PERMS], (q) =>
    q.query("update public.quotation_links set reply_code_hash = $1 where token_hash = $2 and tenant_id = $3 and used_at is null and revoked_at is null", [hash, hashToken(token), m.tenantId]));
  await routeToken(driver, "reply", m.tenantId, hash, expiresAt);
}

/** The estimate link (ADR-030). */
export const createQuoteLink = (driver: Driver, m: Membership, jobId: string) => createWorkshopLink(driver, m, jobId, "quotation");

// ============================ A workshop's email reply (ADR-033) ============================

export type WorkshopEmailRow = { id: string; kind: WorkshopLinkKind; from_address: string; sender_matches: boolean; subject: string | null; body_text: string | null; file_count: number; status: string; received_at: string };
const EMAIL_PERMS = ["jobcard.assign_vendor", "quotation.approve", "invoice.verify"];

/** The replies that came in for one job card, newest first, for the people who handle estimates and invoices. */
export function listWorkshopEmails(driver: Driver, m: Membership, jobId: string): Promise<WorkshopEmailRow[]> {
  return authorizedAny(driver, m, EMAIL_PERMS, async (q) => !(await jobVisible(q, jobId)) ? [] : (await q.query<WorkshopEmailRow>(
    "select id, kind, from_address, sender_matches, subject, body_text, file_count, status, received_at::text from workshop_emails where job_card_id = $1 order by received_at desc, id", [jobId])).rows);
}

/** Staff say a reply has been dealt with: its figures were entered, or it needs nothing. */
export function setWorkshopEmailStatus(driver: Driver, m: Membership, emailId: string, status: "entered" | "dismissed"): Promise<void> {
  return authorizedAny(driver, m, EMAIL_PERMS, async (q) => {
    await q.query("update workshop_emails set status = $2, handled_by = $3, handled_at = now() where id = $1 and status = 'new' and exists (select 1 from job_cards jc where jc.id = workshop_emails.job_card_id and dept_ok(jc.vehicle_id))", [emailId, status, m.userId]);
  });
}

export type QuotationRow = { id: string; status: string; amount: string; created_at: string; valid_until: string | null; days_needed: number | null; warranty_months: number | null;
  job_card_id: string; job_no: string; job_status: string; vendor_name: string; registration_no: string };

/** Every vendor quotation in one list, newest first, for the people who may read all job cards. Read-only. */
export function listQuotations(driver: Driver, m: Membership, opts: { status?: string } = {}): Promise<QuotationRow[]> {
  return authorized(driver, m, "jobcard.read_all", async (q) =>
    (await q.query<QuotationRow>(
      `select qt.id, qt.status, qt.amount::text, qt.created_at::text, qt.valid_until::text, qt.days_needed, qt.warranty_months,
              jc.id as job_card_id, jc.job_no, jc.status as job_status, vn.name as vendor_name, v.registration_no
         from quotations qt join job_cards jc on jc.id = qt.job_card_id join vendors vn on vn.id = qt.vendor_id join vehicles v on v.id = jc.vehicle_id
        where dept_ok(jc.vehicle_id) ${opts.status ? "and qt.status = $1" : ""} order by qt.created_at desc, qt.id limit 300`, opts.status ? [opts.status] : [])).rows);
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

export type CompareRow = {
  key: string; item: string; kind: string; quoted: number | null; approved: number | null; invoiced: number | null;
  check: "ok" | "not_approved" | "qty" | "price" | "not_billed";
};
export type InvoiceReview = InvoiceCheck & {
  vehicle_id: string; vehicle_label: string; driver: string | null; reason: string; requester_name: string; approver_name: string | null; approved_on: string | null; wo_no: string;
  comparison: CompareRow[];
  totals: { approved: number; invoiced: number; over: number; overPct: number | null };
  /** the person checking may not be the one who approved or raised the job card */
  blocked: { by: "approver" | "requester"; name: string } | null;
  next: string | null; waiting: number;
};

/** Everything the invoice check screen shows: lines side by side, the job, who is barred from checking, the next invoice. */
export async function getInvoiceReview(driver: Driver, m: Membership, id: string): Promise<InvoiceReview | null> {
  const adminAlone = await adminMayDecideOwn(driver, m, "invoice.verify");          // the administrator may check an invoice on a card they raised or approved only while nobody else could (ADR-072)
  return authorized(driver, m, "invoice.verify", async (q) => {
    const base = (await q.query<InvoiceCheck>(
      `select i.id, i.invoice_no, i.invoice_date::text, i.amount::text, i.tax_amount::text, i.status, jc.job_no, jc.id as job_card_id, jc.status as job_status,
              vn.name as vendor_name, v.registration_no, c.approved_amount::text, c.variance::text, c.variance_pct::text, c.unapproved_lines::int,
              i.decision, i.decision_note, i.payable_amount::text
         from invoices i join v_invoice_check c on c.invoice_id = i.id join work_orders wo on wo.id = i.work_order_id
         join job_cards jc on jc.id = wo.job_card_id join vendors vn on vn.id = wo.vendor_id join vehicles v on v.id = jc.vehicle_id
        where i.id = $1`, [id])).rows[0];
    if (!base) return null;
    const j = (await q.query<{ vehicle_id: string; label: string; driver: string | null; reason: string; requester_name: string; requested_by: string; approved_by: string | null;
                               approver_name: string | null; approved_on: string | null; wo_no: string; quotation_id: string | null }>(
      `select jc.vehicle_id, concat_ws(' ', v.make, v.model) as label, cu.full_name as driver, rc.label as reason, re.full_name as requester_name, jc.requested_by, jc.approved_by,
              ap.full_name as approver_name,
              (select e.created_at::date::text from job_card_events e where e.job_card_id = jc.id and e.to_status = 'approved' order by e.seq desc limit 1) as approved_on,
              wo.wo_no, wo.quotation_id
         from invoices i join work_orders wo on wo.id = i.work_order_id join job_cards jc on jc.id = wo.job_card_id join vehicles v on v.id = jc.vehicle_id
         join reason_codes rc on rc.id = jc.reason_code_id join employees re on re.id = jc.requested_by left join employees ap on ap.id = jc.approved_by left join employees cu on cu.id = jc.custodian_id
        where i.id = $1`, [id])).rows[0];

    const quoted = j.quotation_id ? (await q.query<{ id: string; kind: string; description: string; qty: string; unit_cost: string }>(
      "select id, kind, description, qty::text, unit_cost::text from quotation_lines where quotation_id = $1 order by id", [j.quotation_id])).rows : [];
    const billed = (await q.query<{ id: string; kind: string; description: string; qty: string; unit_cost: string; quotation_line_id: string | null }>(
      "select id, kind, description, qty::text, unit_cost::text, quotation_line_id from invoice_lines where invoice_id = $1 order by id", [id])).rows;
    const comparison: CompareRow[] = quoted.map((ql) => {
      const mine = billed.filter((b) => b.quotation_line_id === ql.id);
      const amount = Number(ql.qty) * Number(ql.unit_cost);
      const invoiced = mine.reduce((sum, b) => sum + Number(b.qty) * Number(b.unit_cost), 0);
      const first = mine[0];
      const check: CompareRow["check"] = !first ? "not_billed" : Number(first.qty) !== Number(ql.qty) ? "qty" : Number(first.unit_cost) !== Number(ql.unit_cost) ? "price" : "ok";
      return { key: ql.id, item: ql.description, kind: ql.kind, quoted: amount, approved: amount, invoiced: first ? invoiced : 0, check };
    });
    for (const b of billed.filter((x) => !x.quotation_line_id)) {
      comparison.push({ key: b.id, item: b.description, kind: b.kind, quoted: null, approved: null, invoiced: Number(b.qty) * Number(b.unit_cost), check: "not_approved" });
    }
    const approved = Number(base.approved_amount), invoiced = Number(base.amount);
    const over = invoiced - approved;

    const me = (await q.query<{ id: string | null }>("select actor_employee($1) as id", [m.userId])).rows[0].id;
    const blocked = adminAlone ? null : me && me === j.approved_by ? { by: "approver" as const, name: j.approver_name ?? "The approver" }
      : me && me === j.requested_by ? { by: "requester" as const, name: j.requester_name } : null;

    const waitingRows = (await q.query<{ id: string }>("select i.id from invoices i where i.status = 'submitted' and i.id <> $1 order by i.invoice_date, i.id", [id])).rows;
    return {
      ...base, lines: [], vehicle_id: j.vehicle_id, vehicle_label: j.label, driver: j.driver, reason: j.reason, requester_name: j.requester_name,
      approver_name: j.approver_name, approved_on: j.approved_on, wo_no: j.wo_no, comparison,
      totals: { approved, invoiced, over, overPct: approved > 0 ? Math.round((over / approved) * 1000) / 10 : null },
      blocked, next: waitingRows[0]?.id ?? null, waiting: waitingRows.length,
    };
  });
}

export function verifyInvoice(driver: Driver, m: Membership, id: string, decision: string, note?: string): Promise<{ jobId: string }> {
  return authorized(driver, m, "invoice.verify", async (q) => {
    const jobId = (await q.query<{ job_card_id: string }>("select wo.job_card_id from invoices i join work_orders wo on wo.id = i.work_order_id where i.id = $1", [id])).rows[0]?.job_card_id;
    if (!jobId) throw new UserError("Invoice not found.");
    if (!["pay_approved", "pay_full", "return"].includes(decision)) throw new UserError("Choose a decision.");
    try { await q.query("select verify_invoice($1, $2, $3, $4)", [id, m.userId, decision, note?.trim() || null]); } catch (e) { friendly(e); }
    const job_no = (await q.query<{ job_no: string }>("select job_no from job_cards where id = $1", [jobId])).rows[0].job_no;
    await notify(q, [await vendorUserOfJob(q, jobId)], decision === "return" ? "invoice.returned" : "invoice.verified", { job_card_id: jobId, job_no }, m.userId);
    return { jobId };
  });
}

// ============================ Vendor side ============================

export type VendorRequest = { job_card_id: string; job_no: string; job_status: string; priority: string; needed_by: string | null; description: string | null; cause_text: string;
  odometer_km: string | null; registration_no: string; make: string | null; model: string | null; year: number | null; last_quotation_status: string | null; assigned_at: string | null };
export type VendorOrder = { work_order_id: string; wo_no: string; wo_status: string; issued_at: string; approved_amount: string; job_no: string; priority: string; needed_by: string | null;
  description: string | null; cause_text: string; registration_no: string; make: string | null; model: string | null; year: number | null; job_card_id: string; job_status: string;
  quotation_id: string | null; completed_at: string | null };

export function vendorOverview(driver: Driver, m: Membership): Promise<{ requests: VendorRequest[]; orders: VendorOrder[] }> {
  return authorized(driver, m, "quotation.submit", async (q) => ({
    requests: (await q.query<VendorRequest>("select job_card_id, job_no, job_status, priority, needed_by::text, description, cause_text, odometer_km::text, registration_no, make, model, year, last_quotation_status, assigned_at::text from v_vendor_job_requests order by needed_by nulls last, job_no")).rows,
    orders: (await q.query<VendorOrder>("select work_order_id, wo_no, wo_status, issued_at::text, approved_amount::text, job_no, priority, needed_by::text, description, cause_text, registration_no, make, model, year, job_card_id, job_status, quotation_id, completed_at::text from v_vendor_work_orders order by issued_at desc")).rows,
  }));
}

export function vendorGetRequest(driver: Driver, m: Membership, jobId: string): Promise<VendorRequest | null> {
  return authorized(driver, m, "quotation.submit", async (q) =>
    (await q.query<VendorRequest>("select job_card_id, job_no, job_status, priority, needed_by::text, description, cause_text, odometer_km::text, registration_no, make, model, year, last_quotation_status, assigned_at::text from v_vendor_job_requests where job_card_id = $1", [jobId])).rows[0] ?? null);
}

export async function submitQuotation(driver: Driver, m: Membership, jobId: string, input: unknown): Promise<string> {
  const data = parse(quotationSchema, input);
  return authorized(driver, m, "quotation.submit", async (q) => {
    let id = "";
    try { id = (await q.query<{ id: string }>("select submit_quotation($1, $2, $3::jsonb) as id", [jobId, m.userId, JSON.stringify(data)])).rows[0].id; } catch (e) { friendly(e); }
    await notifyAfter(q, m, jobId, "quotation_received");
    return id;
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

export async function submitInvoice(driver: Driver, m: Membership, woId: string, input: unknown): Promise<string> {
  const data = parse(invoiceSchema, input);
  return authorized(driver, m, "invoice.submit", async (q) => {
    const jobId = (await q.query<{ job_card_id: string }>("select job_card_id from v_vendor_work_orders where work_order_id = $1", [woId])).rows[0]?.job_card_id;
    if (!jobId) throw new UserError("Work order not found.");
    let id = "";
    try { id = (await q.query<{ id: string }>("select submit_invoice($1, $2, $3::jsonb) as id", [woId, m.userId, JSON.stringify(data)])).rows[0].id; } catch (e) { friendly(e); }
    await notifyAfter(q, m, jobId, "invoiced");
    return id;
  });
}

// ============================ Files on quotations and invoices ============================

/**
 * A workshop attaches its printed quotation, or the invoice and completion photos. Only to its own record, and only
 * while that record is still open (a quotation waiting for a decision, an invoice not yet checked).
 */
export async function vendorAttach(driver: Driver, store: BlobStore, m: Membership, kind: "quotation" | "invoice", entityId: string, file: { name: string; bytes: Uint8Array }): Promise<void> {
  return authorized(driver, m, kind === "quotation" ? "quotation.submit" : "invoice.submit", async (q) => {
    const open = kind === "quotation"
      ? await q.query("select 1 from v_vendor_quotation_lines where quotation_id = $1 and quotation_status = 'submitted' limit 1", [entityId])
      : await q.query("select 1 from v_vendor_invoices where invoice_id = $1 and status = 'submitted'", [entityId]);
    if (open.rows.length === 0) throw new UserError("That record is not open for new files.");
    await saveAttachment(q, store, m, kind, entityId, file);
  });
}

/** Files on one quotation or invoice, for the fleet side (people who can read the job card or check invoices). */
export function listCommercialFiles(driver: Driver, store: BlobStore, m: Membership, kind: "quotation" | "invoice", entityId: string): Promise<AttachmentRow[]> {
  return authorizedAny(driver, m, ["jobcard.read_all", "invoice.verify"], async (q) => {
    const from = kind === "quotation" ? "quotations x join job_cards jc on jc.id = x.job_card_id" : "invoices x join work_orders wo on wo.id = x.work_order_id join job_cards jc on jc.id = wo.job_card_id";
    if ((await q.query(`select 1 from ${from} where x.id = $1 and dept_ok(jc.vehicle_id)`, [entityId])).rows.length === 0) return [];
    return listAttachments(q, store, m, kind, entityId);
  });
}

/** Files the workshop itself attached to one of its invoices. */
export function vendorListInvoiceFiles(driver: Driver, store: BlobStore, m: Membership, invoiceId: string): Promise<AttachmentRow[]> {
  return authorized(driver, m, "invoice.submit", async (q) => {
    if ((await q.query("select 1 from v_vendor_invoices where invoice_id = $1", [invoiceId])).rows.length === 0) return [];
    return listAttachments(q, store, m, "invoice", invoiceId);
  });
}
