// Shared set-up for the billing tests: a control database, an operator, and customers that can be made on demand.
import { randomBytes } from "node:crypto";
import { expect } from "vitest";
import { secretBox } from "@/lib/crypto/secretbox";
import { routingDriver, type RoutingDriver } from "@/lib/db/router";
import type { Membership } from "@/lib/auth/can";
import { submitClaim, getInvoice, listInvoices } from "@/lib/billing/payments";
import { confirmClaim } from "@/lib/billing/operator";
import { savePlatformSetting } from "@/lib/billing/settings";
import { saveTaxRule, saveTaxProfile } from "@/lib/billing/tax-data";
import { advanceProvisioning, type ProvisionDeps } from "@/lib/orgs/provision";
import { claimSignup, parseSignup, recordSignup } from "@/lib/orgs/signup";
import type { BlobStore } from "@/lib/jobcards/attachments";
import { farm, newControl, platformMigrations, stripExt, tenantMigrations } from "./helpers";

export const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
export const OP = U(900), NOT_OP = U(901);
export const today = () => new Date().toISOString().slice(0, 10);
export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
export const noStore: BlobStore = { async put() {}, async remove() {}, async signedUrl() { return null; } };
export const claim = (over: Record<string, unknown> = {}) => ({ amount: "149", currency: "USD", paid_on: today(), bank_reference: `TRX-${Math.random().toString(36).slice(2, 8)}`, months: "1", ...over });

export type Org = { tenantId: string; schema: string; admin: Membership; requester: Membership };

export async function harness() {
  const control = await newControl();
  const f = farm();
  const box = secretBox(randomBytes(32));
  const deps: ProvisionDeps = { control, provider: f.provider(), openDb: f.open, box, platformMigrations: platformMigrations(), tenantMigrations: tenantMigrations(), transform: stripExt, connectRetries: { tries: 1, delayMs: 1 } };
  const router: RoutingDriver = routingDriver({ control, makeDriver: f.open, decrypt: box.decrypt });
  await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("insert into public.platform_admins(user_id) values ($1)", [OP]); });

  let n = 100;
  /** A customer in a country (or none), with its tax details filled in if asked. */
  async function org(name: string, o: { country?: string; profile?: Record<string, unknown> } = {}): Promise<Org> {
    n += 1;
    const email = `harness${n}@example.com`;
    await recordSignup(control, parseSignup({ org_name: name, contact_name: `Owner ${n}`, email, terms: "on", country: o.country }));
    const t = (await claimSignup(control, { id: U(n), email, emailConfirmed: true }))!;
    expect((await advanceProvisioning(deps, t.tenantId)).state).toBe("ready");
    const base = { tenantId: t.tenantId, schema: t.schema, vehicleScope: "all" as const };
    const made: Org = { ...t, admin: { ...base, userId: U(n), role: "tenant_admin" }, requester: { ...base, userId: U(n + 5000), role: "requester" } };
    if (o.profile) await saveTaxProfile(router, made.admin, o.profile);
    return made;
  }
  const set = (k: string, v: string) => savePlatformSetting(control, OP, k, v);
  /** Sets the seller up the way the owner would: registration, a fallback rate, and one authority. */
  async function sellerReady(rate = "280") {
    await set("seller_legal_name", "Test Seller"); await set("seller_ntn", "1111111-1"); await set("seller_tax_reg", "PRA-0001"); await set("pkr_per_usd", rate);
    await saveTaxRule(control, OP, { code: "PRA", label: "Punjab", sales_tax_pct: "16", active: true });
  }
  const pk = (over: Record<string, unknown> = {}) => ({ country: "PK", tax_rule_code: "PRA", legal_name: "Customer Pvt Ltd", ntn: "1234567-8", strn: "", address: "Lahore", withholding_agent: false, ...over });
  const pay = async (o: Org, over: Record<string, unknown> = {}, months?: number) => {
    const id = (await submitClaim(router, noStore, o.admin, claim(over))).id;
    return { id, ...(await confirmClaim(control, OP, id, { months })) };
  };
  const lastInvoice = async (o: Org) => (await getInvoice(router, o.admin, (await listInvoices(router, o.admin))[0].id))!;
  return { control, router, org, set, sellerReady, pk, pay, lastInvoice };
}
