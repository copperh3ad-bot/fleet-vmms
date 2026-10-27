// The unauthenticated workshop links (ADR-030 for estimates, ADR-033 for invoices). Workshops are added by each organization and never sign up,
// so everything a workshop sends comes through one of these. Everything here runs without a signed-in user, so it stays small: look a link up,
// show the job, accept one estimate or one invoice. Unknown, used, expired and revoked links are indistinguishable.
import type { Driver } from "@/lib/db/types";
import { withLinkContext, withOrgPlatform } from "@/lib/db/tenant";
import { findTenantByToken } from "@/lib/orgs";
import { hashToken } from "@/lib/odometer/link";
import { invoiceSchema, quotationSchema } from "./service";

export const QUOTE_LINK_HOURS = 168;
/** The one message for unknown, used, expired and revoked links, so nobody can tell them apart. */
export const DEAD_QUOTE_LINK = "This link is not working. Ask the fleet office for a new one.";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type LinkKind = "quotation" | "invoice";

export type QuoteLinkView = {
  job_no: string; registration_no: string; make: string | null; model: string | null; year: number | null;
  description: string | null; cause_text: string | null; needed_by: string | null; vendor_name: string; currency: string;
};
export type InvoiceLinkView = {
  job_no: string; registration_no: string; make: string | null; model: string | null; year: number | null;
  description: string | null; wo_no: string; approved_amount: string; vendor_name: string; currency: string;
  lines: { id: string; kind: string; description: string; qty: string; unit_cost: string }[];
};
export type WorkshopLink = { kind: "quotation"; view: QuoteLinkView } | { kind: "invoice"; view: InvoiceLinkView };

type Resolved = { kind: LinkKind; schema: string; jobId: string; vendorId: string; currency: string };

async function resolve(driver: Driver, token: string, only?: LinkKind): Promise<Resolved | null> {
  if (!TOKEN_RE.test(token)) return null;
  const hash = hashToken(token);
  for (const kind of (only ? [only] : ["quotation", "invoice"]) as LinkKind[]) {
    const t = await findTenantByToken(driver, kind, hash);            // the control plane says which organization's database to ask
    if (!t) continue;
    const row = (await withOrgPlatform(driver, t.schema, (q) => q.query<{ job_card_id: string; vendor_id: string; currency: string | null }>(
      `select l.job_card_id, l.vendor_id, t.currency
         from public.quotation_links l join public.tenants t on t.id = l.tenant_id
        where l.token_hash = $1 and l.kind = $2 and l.used_at is null and l.revoked_at is null and l.expires_at > now() and t.status = 'active'`, [hash, kind]))).rows[0];
    if (row) return { kind, schema: t.schema, jobId: row.job_card_id, vendorId: row.vendor_id, currency: row.currency || "PKR" };
  }
  return null;
}

/** What the page shows, or null if the link does not work for any reason. */
export async function lookupWorkshopLink(driver: Driver, token: string): Promise<WorkshopLink | null> {
  const link = await resolve(driver, token);
  if (!link) return null;
  if (link.kind === "quotation") {
    const view = await withLinkContext(driver, link.schema, async (q) =>
      (await q.query<Omit<QuoteLinkView, "currency">>("select job_no, registration_no, make, model, year, description, cause_text, needed_by::text, vendor_name from quote_link_info($1, $2)", [link.jobId, link.vendorId])).rows[0] ?? null,
    "quotation_link");
    return view ? { kind: "quotation", view: { ...view, currency: link.currency } } : null;
  }
  const view = await withLinkContext(driver, link.schema, async (q) =>
    (await q.query<Omit<InvoiceLinkView, "currency">>("select job_no, registration_no, make, model, year, description, wo_no, approved_amount::text, vendor_name, lines from invoice_link_info($1, $2)", [link.jobId, link.vendorId])).rows[0] ?? null,
  "quotation_link");
  return view ? { kind: "invoice", view: { ...view, currency: link.currency } } : null;
}

/** The estimate view only; null for any other kind of link. */
export async function lookupQuoteLink(driver: Driver, token: string): Promise<QuoteLinkView | null> {
  const l = await lookupWorkshopLink(driver, token);
  return l?.kind === "quotation" ? l.view : null;
}

export type LinkResult = { ok: true } | { ok: false; reason: "invalid" } | { ok: false; reason: "bad_input"; message: string; fields?: Record<string, string> };
export type QuoteLinkResult = LinkResult;

const DEAD = /link is not valid/;
const REFUSED = /add at least one line|too many lines|enter the invoice number|not in the approved quotation/;   // the workshop can fix these; the link is not used up

function badInput(error: { issues: { path: PropertyKey[]; message: string }[] }, fallback: string): LinkResult {
  const fields: Record<string, string> = {};
  for (const i of error.issues) fields[i.path.join(".")] ||= i.message;
  return { ok: false, reason: "bad_input", message: error.issues[0]?.message ?? fallback, fields };
}

/** Accepts one estimate. The database function marks the link used and saves the estimate in one step, so a failure burns nothing. */
/** `comment` is only ever set by the signed-in staff route (ADR-033), so the history names the person who typed an emailed estimate in. The public form cannot set it. */
export async function submitViaQuoteLink(driver: Driver, token: string, input: unknown, opts: { comment?: string } = {}): Promise<LinkResult> {
  const parsed = quotationSchema.safeParse(input);
  if (!parsed.success) return badInput(parsed.error, "Check the estimate.");
  const link = await resolve(driver, token, "quotation");
  if (!link) return { ok: false, reason: "invalid" };
  try {
    await withLinkContext(driver, link.schema, async (q) => {
      await q.query("select submit_quotation_via_link($1, $2, $3::jsonb, $4)", [link.jobId, link.vendorId, JSON.stringify({ ...parsed.data, comment: opts.comment }), hashToken(token)]);
    }, "quotation_link");
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && DEAD.test(e.message)) return { ok: false, reason: "invalid" };
    if (e instanceof Error && REFUSED.test(e.message)) return { ok: false, reason: "bad_input", message: e.message.replace(/^error:\s*/i, "") };
    throw e;
  }
}

/** Accepts one invoice against the approved quotation, the same way. Sending it also records the work as done, since the workshop is not a user. */
export async function submitViaInvoiceLink(driver: Driver, token: string, input: unknown, opts: { comment?: string } = {}): Promise<LinkResult> {
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) return badInput(parsed.error, "Check the invoice.");
  const link = await resolve(driver, token, "invoice");
  if (!link) return { ok: false, reason: "invalid" };
  try {
    await withLinkContext(driver, link.schema, async (q) => {
      await q.query("select submit_invoice_via_link($1, $2, $3::jsonb, $4)", [link.jobId, link.vendorId, JSON.stringify({ ...parsed.data, comment: opts.comment }), hashToken(token)]);
    }, "quotation_link");
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && DEAD.test(e.message)) return { ok: false, reason: "invalid" };
    if (e instanceof Error && REFUSED.test(e.message)) return { ok: false, reason: "bad_input", message: e.message.replace(/^error:\s*/i, "") };
    throw e;
  }
}
