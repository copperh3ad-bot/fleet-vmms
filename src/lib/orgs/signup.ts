// Self-serve sign-up (ADR-014). Filling in the form only records a waiting row; nothing is built until the person has
// confirmed their email and is signed in, so a stranger typing addresses cannot create databases. One waiting row per
// address, and one organization per address through this door (more people join through invitations).
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Driver } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";
import { insertOrganization, type NewOrganization, type OrgKind } from "./provision";
import { isCountryCode } from "./countries";

/** Shown with the terms the person accepted. Change it when the terms change. */
export const TERMS_VERSION = "2026-10-23-draft";
export const FLEET_SIZES = ["1-5", "6-20", "21-50", "51-200", "200+"] as const;

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const signupSchema = z.object({
  org_name: z.string().trim().min(2, "Enter your company name").max(80, "That name is too long"),
  contact_name: z.string().trim().min(2, "Enter your name").max(80, "That name is too long"),
  email: z.email("Enter a valid email address").max(200).transform((s) => s.toLowerCase()),
  phone: z.preprocess(blank, z.string().trim().max(30, "That phone number is too long").optional()),
  fleet_size: z.preprocess(blank, z.enum(FLEET_SIZES, "Choose a fleet size").optional()),
  // Where the company is. It decides which tax applies, so it is asked at sign-up; the operator can correct it. Empty means unknown, taxed as before (not at all).
  country: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim().toUpperCase() : v), z.string().refine(isCountryCode, "Choose your country").optional()),
  terms: z.preprocess((v) => v === "on" || v === "true" || v === true, z.literal(true, "Accept the terms to continue")),
});
export type SignupInput = z.output<typeof signupSchema>;

export function parseSignup(raw: Record<string, unknown>): SignupInput {
  const r = signupSchema.safeParse(raw);
  if (!r.success) throw new UserError("Fix the highlighted fields.", fieldErrors(r.error));
  return r.data;
}

export type SignupRow = { id: string; email: string; org_name: string; contact_name: string; phone: string | null; fleet_size: string | null; status: "pending" | "started" | "done"; tenant_id: string | null };

/**
 * Records (or replaces) the waiting row for this address. If the address already has an organization the call does
 * nothing and says nothing, so the form cannot be used to find out which addresses are customers.
 */
export function recordSignup(driver: Driver, input: SignupInput): Promise<void> {
  return withPlatform(driver, async (q) => {
    await q.query(
      `insert into public.signups(email, org_name, contact_name, phone, fleet_size, country, terms_version) values (lower($1), $2, $3, $4, $5, $6, $7)
       on conflict (lower(email)) do update set org_name = excluded.org_name, contact_name = excluded.contact_name, phone = excluded.phone,
         fleet_size = excluded.fleet_size, country = excluded.country, terms_version = excluded.terms_version, updated_at = now()
       where public.signups.status = 'pending'`,
      [input.email, input.org_name, input.contact_name, input.phone ?? null, input.fleet_size ?? null, input.country ?? null, TERMS_VERSION]);
    // Waiting rows nobody came back for are tidied away now and then.
    if (Math.random() < 0.02) await q.query("delete from public.signups where status = 'pending' and updated_at < now() - interval '14 days'");
  });
}

export function pendingSignupFor(driver: Driver, email: string): Promise<SignupRow | null> {
  return withPlatform(driver, async (q) =>
    (await q.query<SignupRow>(
      "select id, email, org_name, contact_name, phone, fleet_size, status, tenant_id from public.signups where lower(email) = lower($1) and status in ('pending', 'started')", [email])).rows[0] ?? null);
}

const RESERVED = new Set(["about", "contact", "admin", "api", "app", "auth", "billing", "invite", "login", "o", "privacy", "setup", "signup", "terms", "w", "www"]);

/** "Acme Transport (Pvt) Ltd" -> "acme-transport-pvt-ltd". Letters and digits only, 2 to 40 characters. */
export function slugFrom(name: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/, "");
  return base.length >= 2 && !RESERVED.has(base) ? base : `org-${base}`.replace(/-+$/, "").slice(0, 30) || "org";
}

export type Claimer = { id: string; email?: string | null; emailConfirmed: boolean };

/**
 * Turns a confirmed person's waiting row into an organization that is ready to be provisioned. Safe to repeat: the
 * second call returns the same organization. Refuses an unconfirmed address, and an organization that was started for
 * someone else. The organization row and the waiting row change in one transaction.
 */
export async function claimSignup(driver: Driver, user: Claimer, opts: { kind?: OrgKind } = {}): Promise<{ tenantId: string; schema: string } | null> {
  if (!user.email || !user.emailConfirmed) throw new UserError("Confirm your email address first.");
  // Two companies with the same name can sign up at the very same moment and both see the web address as free. The database
  // lets only one win; the other is told so by a unique-key error, and simply tries again with a random ending.
  for (let attempt = 0; ; attempt++) {
    try { return await claimOnce(driver, user, opts, attempt > 0); }
    catch (e) { if (attempt >= 4 || !(e instanceof Error && /tenants_slug_key/.test(e.message))) throw e; }
  }
}

function claimOnce(driver: Driver, user: Claimer, opts: { kind?: OrgKind }, suffixed: boolean): Promise<{ tenantId: string; schema: string } | null> {
  const email = user.email!;
  return withPlatform(driver, async (q) => {
    const s = (await q.query<SignupRow & { terms_version: string; country: string | null }>(
      "select id, email, org_name, contact_name, phone, fleet_size, country, status, tenant_id, terms_version from public.signups where lower(email) = lower($1) for update", [email])).rows[0];
    if (!s || s.status === "done") return null;
    if (s.tenant_id) {
      const t = (await q.query<{ id: string; schema_name: string; provision_owner: { userId?: string } | null }>(
        "select id, schema_name, provision_owner from public.tenants where id = $1", [s.tenant_id])).rows[0];
      if (!t) return null;
      if (t.provision_owner?.userId && t.provision_owner.userId !== user.id) throw new UserError("This sign-up belongs to a different login.");
      return { tenantId: t.id, schema: t.schema_name };
    }
    const owner: NewOrganization = { name: s.org_name, slug: "", ownerUserId: user.id, ownerName: s.contact_name, ownerEmail: email, kind: opts.kind ?? "dedicated", region: opts.kind === "shared" ? undefined : process.env.NEON_REGION };
    let slug = suffixed ? `${slugFrom(s.org_name).slice(0, 34)}-${randomBytes(2).toString("hex")}` : slugFrom(s.org_name);
    for (let i = 0; ; i++) {
      const taken = (await q.query("select 1 from public.tenants where slug = $1", [slug])).rows.length > 0;
      if (!taken) break;
      if (i >= 8) throw new UserError("We could not pick a web address for your company. Try a slightly different name.");
      slug = `${slugFrom(s.org_name).slice(0, 34)}-${randomBytes(2).toString("hex")}`;
    }
    const t = await insertOrganization(q, { ...owner, slug });
    await q.query("update public.signups set status = 'started', tenant_id = $2, updated_at = now() where id = $1", [s.id, t.tenantId]);
    // the customer's own tax record starts with the country it gave, so the right tax scenario applies from its first invoice
    if (s.country) await q.query("insert into public.org_tax(tenant_id, country) values ($1, $2) on conflict (tenant_id) do update set country = excluded.country", [t.tenantId, s.country]);
    return t;
  });
}
