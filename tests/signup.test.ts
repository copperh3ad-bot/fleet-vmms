// Self-serve sign-up and the trial (ADR-014): the waiting row, claiming it after email confirmation, provisioning, and
// what a locked organization can no longer do.
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { secretBox } from "@/lib/crypto/secretbox";
import { routingDriver, type RoutingDriver } from "@/lib/db/router";
import { listWorkspaces, resolveMembership } from "@/lib/auth/can";
import { loadAccess } from "@/lib/billing/state";
import { UserError } from "@/lib/master/service";
import { advanceProvisioning, type ProvisionDeps } from "@/lib/orgs/provision";
import { claimSignup, parseSignup, pendingSignupFor, recordSignup, slugFrom, TERMS_VERSION } from "@/lib/orgs/signup";
import { findTenantByToken, routeToken } from "@/lib/orgs";
import { runDocumentReminders } from "@/lib/compliance/reminders";
import { farm, newControl, platformMigrations, stripExt, tenantMigrations } from "./helpers";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
const box = secretBox(randomBytes(32));
const form = (over: Record<string, unknown> = {}) => ({ org_name: "Acme Transport", contact_name: "Sara Khan", email: "Sara@Acme.example", phone: "", fleet_size: "21-50", terms: "on", ...over });
const user = (n: number, email: string, confirmed = true) => ({ id: U(n), email, emailConfirmed: confirmed });

let control: Awaited<ReturnType<typeof newControl>>;
let f: ReturnType<typeof farm>;
let deps: ProvisionDeps;
let router: RoutingDriver;

beforeAll(async () => {
  control = await newControl();
  f = farm();
  deps = { control, provider: f.provider(), openDb: f.open, box, platformMigrations: platformMigrations(), tenantMigrations: tenantMigrations(), transform: stripExt, connectRetries: { tries: 1, delayMs: 1 } };
  router = routingDriver({ control, makeDriver: f.open, decrypt: box.decrypt });
});

describe("the form", () => {
  it("checks each field, lowercases the email, and needs the terms", () => {
    expect(parseSignup(form())).toEqual({ org_name: "Acme Transport", contact_name: "Sara Khan", email: "sara@acme.example", fleet_size: "21-50", terms: true });
    const e = (() => { try { parseSignup(form({ org_name: "A", contact_name: "", email: "nope", fleet_size: "huge", terms: undefined })); } catch (x) { return x as UserError; } })()!;
    expect(Object.keys(e.fields ?? {}).sort()).toEqual(["contact_name", "email", "fleet_size", "org_name", "terms"]);
    expect(() => parseSignup(form({ org_name: "x".repeat(81) }))).toThrow(UserError);
    expect(parseSignup(form({ phone: " +92 300 1234567 " })).phone).toBe("+92 300 1234567");
  });

  it("makes a web address from the company name", () => {
    expect(slugFrom("Acme Transport (Pvt) Ltd")).toBe("acme-transport-pvt-ltd");
    expect(slugFrom("  Al-Noor & Sons!! ")).toBe("al-noor-sons");
    expect(slugFrom("ÄÖÜ Logistik")).toMatch(/^[a-z0-9-]{2,40}$/);
    expect(slugFrom("???")).toBe("org");
    expect(slugFrom("Admin")).toBe("org-admin");                           // not a word the site itself uses
    expect(slugFrom("x".repeat(100)).length).toBeLessThanOrEqual(30);
    expect(slugFrom("A")).toMatch(/^org/);
  });
});

describe("waiting rows", () => {
  it("one row per address; filling the form again replaces what was waiting", async () => {
    await recordSignup(control, parseSignup(form({ email: "dup@example.com", org_name: "First Name" })));
    await recordSignup(control, parseSignup(form({ email: "DUP@example.com", org_name: "Second Name" })));
    const row = await pendingSignupFor(control, "dup@EXAMPLE.com");
    expect(row).toMatchObject({ org_name: "Second Name", status: "pending", tenant_id: null });
    expect((await control.transaction(async (q) => (await q.query("select terms_version from public.signups where lower(email) = 'dup@example.com'")).rows))).toEqual([{ terms_version: TERMS_VERSION }]);
    expect(await pendingSignupFor(control, "nobody@example.com")).toBeNull();
  });
});

describe("claiming after the email is confirmed", () => {
  it("does nothing for an unconfirmed address, or one with no sign-up", async () => {
    await recordSignup(control, parseSignup(form({ email: "unconfirmed@example.com" })));
    expect(() => claimSignup(control, user(1, "unconfirmed@example.com", false))).toThrow(/Confirm your email/);
    expect(await claimSignup(control, user(2, "never.signed.up@example.com"))).toBeNull();
  });

  it("creates the organization once, even if asked twice, and only for the login the address belongs to", async () => {
    await recordSignup(control, parseSignup(form({ email: "twice@example.com", org_name: "Twice Fleet" })));
    const a = await claimSignup(control, user(3, "twice@example.com"));
    const b = await claimSignup(control, user(3, "TWICE@example.com"));
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
    expect(await pendingSignupFor(control, "twice@example.com")).toMatchObject({ status: "started", tenant_id: a!.tenantId });
    await expect(claimSignup(control, user(4, "twice@example.com"))).rejects.toThrow(/different login/);
    const t = await control.transaction(async (q) => (await q.query<{ slug: string; db_kind: string; provision_state: string; provision_owner: { email: string } }>("select slug, db_kind, provision_state, provision_owner from public.tenants where id = $1", [a!.tenantId])).rows[0]);
    expect(t).toMatchObject({ slug: "twice-fleet", db_kind: "dedicated", provision_state: "creating_database", provision_owner: { email: "twice@example.com" } });
  });

  it("picks a different address when the web address is taken", async () => {
    await recordSignup(control, parseSignup(form({ email: "same1@example.com", org_name: "Same Name Co" })));
    await recordSignup(control, parseSignup(form({ email: "same2@example.com", org_name: "Same Name Co" })));
    const a = await claimSignup(control, user(5, "same1@example.com")), b = await claimSignup(control, user(6, "same2@example.com"));
    const slugs = await control.transaction(async (q) => (await q.query<{ slug: string }>("select slug from public.tenants where id = any($1::uuid[]) order by created_at", [[a!.tenantId, b!.tenantId]])).rows.map((r) => r.slug));
    expect(slugs[0]).toBe("same-name-co");
    expect(slugs[1]).toMatch(/^same-name-co-[0-9a-f]{4}$/);
  });
});

describe("from the form to a working trial", () => {
  it("provisions the database, starts a 3-day trial at USD 149, and the person can enter; a second go with the same address does nothing", async () => {
    await recordSignup(control, parseSignup(form({ email: "trial@example.com", org_name: "Trial Haulage", contact_name: "Tariq Mehmood" })));
    const claimed = (await claimSignup(control, user(7, "trial@example.com")))!;
    expect((await advanceProvisioning(deps, claimed.tenantId)).state).toBe("ready");

    // access: a trial that ends in three days
    const access = await loadAccess(control, claimed.tenantId);
    expect(access).toMatchObject({ state: "trial", full: true, daysLeft: 3, priceCents: 14900, currency: "USD" });
    const billing = await control.transaction(async (q) => (await q.query<{ plan_key: string; status: string; comped: boolean; hours: number }>(
      "select plan_key, status, comped, round(extract(epoch from trial_ends_at - now()) / 3600)::int as hours from public.org_billing where tenant_id = $1", [claimed.tenantId])).rows[0]);
    expect(billing).toMatchObject({ plan_key: "standard", status: "trialing", comped: false });
    expect(billing.hours).toBeGreaterThanOrEqual(71); expect(billing.hours).toBeLessThanOrEqual(72);

    // the owner is in their own database and finds it after signing in
    const slug = (await control.transaction(async (q) => (await q.query<{ slug: string }>("select slug from public.tenants where id = $1", [claimed.tenantId])).rows[0])).slug;
    expect(await resolveMembership(router, U(7), slug)).toMatchObject({ role: "tenant_admin", tenantName: "Trial Haulage" });
    expect(await listWorkspaces(router, U(7))).toEqual([{ slug, name: "Trial Haulage", role: "tenant_admin" }]);

    // the waiting row is finished: the same address cannot start another trial
    expect(await pendingSignupFor(control, "trial@example.com")).toBeNull();
    expect(await claimSignup(control, user(7, "trial@example.com"))).toBeNull();
    await recordSignup(control, parseSignup(form({ email: "trial@example.com", org_name: "Another Trial" })));
    expect(await pendingSignupFor(control, "trial@example.com")).toBeNull();                        // ignored, quietly
  });

  it("when the trial runs out the organization is locked: its links and invitations stop, reminders stop, the data stays", async () => {
    await recordSignup(control, parseSignup(form({ email: "lock@example.com", org_name: "Lock Logistics" })));
    const t = (await claimSignup(control, user(8, "lock@example.com")))!;
    await advanceProvisioning(deps, t.tenantId);
    const hash = "h".repeat(64);
    await routeToken(router, "odometer", t.tenantId, hash, new Date(Date.now() + 86_400_000).toISOString());
    expect((await findTenantByToken(router, "odometer", hash))?.id).toBe(t.tenantId);

    await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.org_billing set trial_ends_at = now() - interval '1 minute' where tenant_id = $1", [t.tenantId]); });
    expect(await loadAccess(control, t.tenantId)).toMatchObject({ state: "locked", full: false, lockedReason: "trial_ended" });
    expect(await findTenantByToken(router, "odometer", hash)).toBeNull();
    // the person can still sign in and be recognised (so they can reach the billing page and export), and the data is untouched
    expect(await resolveMembership(router, U(8), "lock-logistics")).not.toBeNull();
    const runs = await runDocumentReminders(router);
    expect(runs.map((r) => r.schema)).not.toContain(t.schema);                                     // skipped, not failed

    // paying (the operator extends the period) opens it again
    await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.org_billing set status = 'active', current_period_end = now() + interval '30 days' where tenant_id = $1", [t.tenantId]); });
    expect(await loadAccess(control, t.tenantId)).toMatchObject({ state: "active", full: true });
    expect((await findTenantByToken(router, "odometer", hash))?.id).toBe(t.tenantId);
  });

  it("organizations that existed before billing are never locked", async () => {
    const id = await control.transaction(async (q) => {
      await q.query("set local search_path = public");
      return (await q.query<{ id: string }>("insert into public.tenants(name, slug, schema_name) values ('Old Co', 'old-co', 'tenant_oldco') returning id")).rows[0].id;
    });
    // migration 0002 gave every existing shared organization a comped row; a new shared one made by the operator's script does too
    await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("insert into public.org_billing(tenant_id, plan_key, status, price_cents, comped) values ($1, 'legacy', 'active', 0, true)", [id]); });
    expect(await loadAccess(control, id)).toMatchObject({ state: "comped", full: true });
  });
});
