// The unauthenticated odometer link (ADR-006). Everything here runs without a signed-in user, so it stays small:
// look a link up, show the plate, accept one number. Unknown, used, expired and revoked links are indistinguishable.
import { createHash, randomBytes } from "node:crypto";
import type { Driver } from "@/lib/db/types";
import { withLinkContext, withPlatform } from "@/lib/db/tenant";

export const LINK_HOURS = 48;
/** The one message for unknown, used, expired and revoked links, so nobody can tell them apart. */
export const DEAD_LINK = "This link is not working. Ask your fleet office for a new one.";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type LinkView = { plate: string; period: string; due_on: string };

async function schemaOf(driver: Driver, token: string): Promise<{ schema: string; submissionId: string } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const row = (await withPlatform(driver, (q) => q.query<{ schema_name: string; submission_id: string }>(
    `select t.schema_name, l.submission_id
       from public.odometer_links l join public.tenants t on t.id = l.tenant_id
      where l.token_hash = $1 and l.used_at is null and l.revoked_at is null and l.expires_at > now() and t.status = 'active'`,
    [hashToken(token)]))).rows[0];
  return row ? { schema: row.schema_name, submissionId: row.submission_id } : null;
}

/** What the page shows, or null if the link does not work for any reason. */
export async function lookupLink(driver: Driver, token: string): Promise<LinkView | null> {
  const link = await schemaOf(driver, token);
  if (!link) return null;
  return withLinkContext(driver, link.schema, async (q) => {
    const r = (await q.query<{ registration_no: string; period: string; due_on: string }>(
      "select registration_no, period::text, due_on::text from link_submission_info($1)", [link.submissionId])).rows[0];
    return r ? { plate: r.registration_no, period: r.period, due_on: r.due_on } : null;
  });
}

export type LinkResult = "ok" | "invalid" | "bad_value";

/** Accepts one reading. The link is marked used in the same transaction as the reading, so a failure burns nothing. */
export async function submitViaLink(driver: Driver, token: string, raw: string): Promise<LinkResult> {
  const text = raw.trim().replace(/,/g, "");
  if (!/^\d{1,7}(\.\d)?$/.test(text)) return "bad_value";
  const reading = Number(text);
  const link = await schemaOf(driver, token);
  if (!link) return "invalid";
  try {
    return await withLinkContext(driver, link.schema, async (q) => {
      const used = await q.query(
        `update public.odometer_links set used_at = now()
          where token_hash = $1 and used_at is null and revoked_at is null and expires_at > now() returning id`, [hashToken(token)]);
      if (used.rows.length === 0) return "invalid" as const;
      await q.query("select submit_odometer_via_link($1, $2)", [link.submissionId, reading]);
      return "ok" as const;
    });
  } catch (e) {
    if (e instanceof Error && /is not open for input|reading out of range/.test(e.message)) return "invalid";
    throw e;
  }
}
