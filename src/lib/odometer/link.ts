// The unauthenticated odometer link (ADR-006). Everything here runs without a signed-in user, so it stays small:
// look a link up, show the plate, accept one number. Unknown, used, expired and revoked links are indistinguishable.
import { createHash, randomBytes } from "node:crypto";
import type { Driver } from "@/lib/db/types";
import { withLinkContext, withOrgPlatform } from "@/lib/db/tenant";
import { findTenantByToken } from "@/lib/orgs";

export const LINK_HOURS = 48;
/** The one message for unknown, used, expired and revoked links, so nobody can tell them apart. */
export const DEAD_LINK = "This link is not working. Ask your fleet office for a new one.";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type LinkView = { plate: string; period: string; due_on: string; /** the vehicle has an hour meter, so the page also asks for the hours (ADR-048) */ tracksHours: boolean };

async function schemaOf(driver: Driver, token: string): Promise<{ schema: string; submissionId: string } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const hash = hashToken(token);
  const t = await findTenantByToken(driver, "odometer", hash);       // the control plane says which organization's database to ask
  if (!t) return null;
  const row = (await withOrgPlatform(driver, t.schema, (q) => q.query<{ submission_id: string }>(
    `select l.submission_id
       from public.odometer_links l join public.tenants t on t.id = l.tenant_id
      where l.token_hash = $1 and l.used_at is null and l.revoked_at is null and l.expires_at > now() and t.status = 'active'`, [hash]))).rows[0];
  return row ? { schema: t.schema, submissionId: row.submission_id } : null;
}

/** What the page shows, or null if the link does not work for any reason. */
export async function lookupLink(driver: Driver, token: string): Promise<LinkView | null> {
  const link = await schemaOf(driver, token);
  if (!link) return null;
  return withLinkContext(driver, link.schema, async (q) => {
    const r = (await q.query<{ registration_no: string; period: string; due_on: string; tracks_hours: boolean }>(
      "select registration_no, period::text, due_on::text, tracks_hours from link_submission_info($1)", [link.submissionId])).rows[0];
    return r ? { plate: r.registration_no, period: r.period, due_on: r.due_on, tracksHours: r.tracks_hours } : null;
  });
}

export type LinkResult = "ok" | "invalid" | "bad_value";

/** Accepts one submission: the odometer, the hour meter, or both. The database function marks the link used and saves it in one step, so a failure burns nothing. */
export async function submitViaLink(driver: Driver, token: string, raw: string, rawHours = ""): Promise<LinkResult> {
  const num = (v: string): number | null | undefined => {          // null: left empty; undefined: not a number
    const t = v.trim().replace(/,/g, "");
    if (t === "") return null;
    return /^\d{1,7}(\.\d)?$/.test(t) ? Number(t) : undefined;
  };
  const reading = num(raw), hours = num(rawHours);
  if (reading === undefined || hours === undefined || (reading === null && hours === null)) return "bad_value";
  const link = await schemaOf(driver, token);
  if (!link) return "invalid";
  try {
    return await withLinkContext(driver, link.schema, async (q) => {
      await q.query("select submit_odometer_via_link($1, $2::numeric, $3, $4::numeric)", [link.submissionId, reading, hashToken(token), hours]);
      return "ok" as const;
    });
  } catch (e) {
    if (e instanceof Error && /is not open for input|reading out of range|link is not valid/.test(e.message)) return "invalid";
    throw e;
  }
}
