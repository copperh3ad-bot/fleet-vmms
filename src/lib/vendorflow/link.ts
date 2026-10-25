// The unauthenticated workshop estimate link (ADR-030). Everything here runs without a signed-in user, so it stays small:
// look a link up, show the job, accept one estimate. Unknown, used, expired and revoked links are indistinguishable.
import type { Driver } from "@/lib/db/types";
import { withLinkContext, withOrgPlatform } from "@/lib/db/tenant";
import { findTenantByToken } from "@/lib/orgs";
import { hashToken } from "@/lib/odometer/link";
import { quotationSchema } from "./service";

export const QUOTE_LINK_HOURS = 168;
/** The one message for unknown, used, expired and revoked links, so nobody can tell them apart. */
export const DEAD_QUOTE_LINK = "This link is not working. Ask the fleet office for a new one.";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type QuoteLinkView = {
  job_no: string; registration_no: string; make: string | null; model: string | null; year: number | null;
  description: string | null; cause_text: string | null; needed_by: string | null; vendor_name: string; currency: string;
};

async function resolve(driver: Driver, token: string): Promise<{ schema: string; jobId: string; vendorId: string; currency: string } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const hash = hashToken(token);
  const t = await findTenantByToken(driver, "quotation", hash);       // the control plane says which organization's database to ask
  if (!t) return null;
  const row = (await withOrgPlatform(driver, t.schema, (q) => q.query<{ job_card_id: string; vendor_id: string; currency: string | null }>(
    `select l.job_card_id, l.vendor_id, t.currency
       from public.quotation_links l join public.tenants t on t.id = l.tenant_id
      where l.token_hash = $1 and l.used_at is null and l.revoked_at is null and l.expires_at > now() and t.status = 'active'`, [hash]))).rows[0];
  return row ? { schema: t.schema, jobId: row.job_card_id, vendorId: row.vendor_id, currency: row.currency || "PKR" } : null;
}

/** What the page shows, or null if the link does not work for any reason. */
export async function lookupQuoteLink(driver: Driver, token: string): Promise<QuoteLinkView | null> {
  const link = await resolve(driver, token);
  if (!link) return null;
  const view = await withLinkContext(driver, link.schema, async (q) =>
    (await q.query<Omit<QuoteLinkView, "currency">>("select job_no, registration_no, make, model, year, description, cause_text, needed_by::text, vendor_name from quote_link_info($1, $2)", [link.jobId, link.vendorId])).rows[0] ?? null,
  "quotation_link");
  return view ? { ...view, currency: link.currency } : null;
}

export type QuoteLinkResult = { ok: true } | { ok: false; reason: "invalid" } | { ok: false; reason: "bad_input"; message: string; fields?: Record<string, string> };

/** Accepts one estimate. The database function marks the link used and saves the estimate in one step, so a failure burns nothing. */
export async function submitViaQuoteLink(driver: Driver, token: string, input: unknown): Promise<QuoteLinkResult> {
  const parsed = quotationSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) fields[i.path.join(".")] ||= i.message;
    return { ok: false, reason: "bad_input", message: parsed.error.issues[0]?.message ?? "Check the estimate.", fields };
  }
  const link = await resolve(driver, token);
  if (!link) return { ok: false, reason: "invalid" };
  try {
    await withLinkContext(driver, link.schema, async (q) => {
      await q.query("select submit_quotation_via_link($1, $2, $3::jsonb, $4)", [link.jobId, link.vendorId, JSON.stringify(parsed.data), hashToken(token)]);
    }, "quotation_link");
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && /link is not valid|add at least one line|too many lines/.test(e.message)) return { ok: false, reason: "invalid" };
    throw e;
  }
}
