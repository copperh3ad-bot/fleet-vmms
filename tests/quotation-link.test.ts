import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withLinkContext, withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import * as vf from "@/lib/vendorflow/service";
import { hashToken } from "@/lib/odometer/link";
import { lookupQuoteLink, submitViaQuoteLink } from "@/lib/vendorflow/link";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number, vehicleScope: "all" | "own" = "all"): Membership => ({ ...t, userId: U(n), role, vehicleScope });
const owner = () => mem("tenant_admin", 1);
const driver = () => mem("requester", 11, "own");
const mgr = () => mem("fleet_manager", 12);
const mgr2 = () => mem("fleet_manager", 13);
const vendorA = () => mem("vendor", 21);

let veh: string, reason: string, vA: string;
const raw = <T,>(m: Membership, fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, m, fn);

const estimate = (over: Record<string, unknown> = {}) => ({
  details: "Pads and discs", days_needed: "2", warranty_months: "6",
  lines: [{ kind: "part", description: "Brake pads", qty: "2", unit_cost: "1500" }, { kind: "labour", description: "Fit", qty: "1", unit_cost: "800" }], ...over,
});

async function assigned(): Promise<string> {
  const { id } = await jc.createJobCard(d, driver(), { vehicle_id: veh, reason_code_id: reason, cause_text: "Front brake pads worn to the metal", lines: [] }, true);
  await jc.transitionJobCard(d, mgr2(), id, "approved");
  await jc.transitionJobCard(d, mgr(), id, "vendor_assigned", { vendorId: vA });
  return id;
}
const statusOf = (id: string) => raw(owner(), async (q) => (await q.query<{ status: string }>("select status from job_cards where id = $1", [id])).rows[0].status);

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  for (const [n, name] of [[11, "Driver One"], [12, "Manager One"], [13, "Manager Two"]] as const) {
    const e = await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` });
    await raw(owner(), (q) => q.query("update employees set user_id = $1 where id = $2", [U(n), e.id]));
  }
  vA = (await master.saveVendor(d, owner(), { name: "Quick Fix Motors", categories: ["brakes"] })).id;
  await raw(owner(), (q) => q.query("update vendors set user_id = $1, phone = '0300 1234567' where id = $2", [U(21), vA]));
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[11, "requester"], [12, "fleet_manager"], [13, "fleet_manager"], [21, "vendor"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  const emp11 = await raw(owner(), async (q) => (await q.query<{ id: string }>("select id from employees where user_id = $1", [U(11)])).rows[0].id);
  veh = (await master.addVehicle(d, owner(), { registration_no: "BKL-245", employee_id: emp11, holding_since: "2026-01-01" })).id;
  reason = (await raw(owner(), async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'WEAR_BRAKES'")).rows[0])).id;
});
beforeEach(async () => { await withPlatform(d, (q) => q.query("update public.quotation_links set revoked_at = now() where revoked_at is null")); });

describe("making a link", () => {
  it("is made for the workshop on a card waiting for an estimate, and goes to the workshop's number", async () => {
    const job = await assigned();
    const l = await vf.createQuoteLink(d, mgr(), job);
    expect(l.phone.e164).toBe("+923001234567");
    expect(l.vendor_name).toBe("Quick Fix Motors");
    const rows = await withPlatform(d, async (q) => (await q.query<Record<string, unknown>>("select * from public.quotation_links where token_hash = $1", [hashToken(l.token)])).rows);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain(l.token);          // only the hash is stored
  });
  it("is refused for people who may not assign or decide, and for a card that is not waiting", async () => {
    const job = await assigned();
    await expect(vf.createQuoteLink(d, driver(), job)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(vf.createQuoteLink(d, vendorA(), job)).rejects.toBeInstanceOf(ForbiddenError);
    const { id } = await jc.createJobCard(d, driver(), { vehicle_id: veh, reason_code_id: reason, cause_text: "Another card, not yet assigned", lines: [] }, true);
    await expect(vf.createQuoteLink(d, mgr(), id)).rejects.toBeInstanceOf(UserError);
  });
  it("is refused when the workshop has no number a message can reach", async () => {
    const job = await assigned();
    await raw(owner(), (q) => q.query("update vendors set phone = null where id = $1", [vA]));
    await expect(vf.createQuoteLink(d, mgr(), job)).rejects.toThrow(/mobile number/);
    await raw(owner(), (q) => q.query("update vendors set phone = '0300 1234567' where id = $1", [vA]));
  });
  it("a new link stops the old one", async () => {
    const job = await assigned();
    const a = await vf.createQuoteLink(d, mgr(), job);
    const b = await vf.createQuoteLink(d, mgr(), job);
    expect(await lookupQuoteLink(d, a.token)).toBeNull();
    expect((await lookupQuoteLink(d, b.token))?.job_no).toMatch(/^JC-/);
  });
});

describe("using a link without signing in", () => {
  it("shows the job and vehicle only, and records the estimate against the job card number", async () => {
    const job = await assigned();
    const { token } = await vf.createQuoteLink(d, mgr(), job);
    const view = await lookupQuoteLink(d, token);
    expect(view?.registration_no).toBe("BKL-245");
    expect(Object.keys(view!).sort()).toEqual(["cause_text", "description", "job_no", "make", "model", "needed_by", "registration_no", "vendor_name", "year"]);
    expect(await submitViaQuoteLink(d, token, estimate())).toEqual({ ok: true });
    expect(await statusOf(job)).toBe("quotation_received");
    const flow = await vf.getJobFlow(d, mgr(), job);
    expect(flow.quotations).toHaveLength(1);
    expect(flow.quotations[0].vendor_name).toBe("Quick Fix Motors");
    expect(Number(flow.quotations[0].amount)).toBe(3800);
    expect(flow.quotations[0].lines).toHaveLength(2);
    expect((await vf.listQuotations(d, mgr(), { status: "submitted" })).some((x) => x.job_card_id === job)).toBe(true);
    const note = await raw(owner(), async (q) => (await q.query<{ n: string }>("select count(*)::text n from notifications where kind = 'quotation.received' and payload->>'job_card_id' = $1", [job])).rows[0].n);
    expect(Number(note)).toBeGreaterThan(0);                             // the people who decide are told
  });
  it("works once", async () => {
    const job = await assigned();
    const { token } = await vf.createQuoteLink(d, mgr(), job);
    expect(await submitViaQuoteLink(d, token, estimate())).toEqual({ ok: true });
    expect(await submitViaQuoteLink(d, token, estimate())).toEqual({ ok: false, reason: "invalid" });
    expect(await lookupQuoteLink(d, token)).toBeNull();
  });
  it("a refused estimate does not burn the link", async () => {
    const job = await assigned();
    const { token } = await vf.createQuoteLink(d, mgr(), job);
    const bad = await submitViaQuoteLink(d, token, estimate({ lines: [] }));
    expect(bad.ok).toBe(false);
    expect(await submitViaQuoteLink(d, token, estimate())).toEqual({ ok: true });
  });
  it("unknown, expired and revoked links look the same", async () => {
    expect(await lookupQuoteLink(d, "x".repeat(43))).toBeNull();
    expect(await lookupQuoteLink(d, "short")).toBeNull();
    const job = await assigned();
    const { token } = await vf.createQuoteLink(d, mgr(), job);
    await withPlatform(d, (q) => q.query("update public.quotation_links set expires_at = now() - interval '1 minute' where token_hash = $1", [hashToken(token)]));
    expect(await lookupQuoteLink(d, token)).toBeNull();
    expect(await submitViaQuoteLink(d, token, estimate())).toEqual({ ok: false, reason: "invalid" });
  });
  it("stops working once the job has moved on", async () => {
    const job = await assigned();
    const { token } = await vf.createQuoteLink(d, mgr(), job);
    await vf.submitQuotation(d, vendorA(), job, estimate());              // the workshop quoted by signing in instead
    expect(await lookupQuoteLink(d, token)).toBeNull();
    expect(await submitViaQuoteLink(d, token, estimate())).toEqual({ ok: false, reason: "invalid" });
  });
  it("the link's database role can call two functions and read nothing", async () => {
    await expect(withLinkContext(d, t.schema, (q) => q.query("select * from quotations"), "quotation_link")).rejects.toThrow(/permission denied/);
    await expect(withLinkContext(d, t.schema, (q) => q.query("select * from job_cards"), "quotation_link")).rejects.toThrow(/permission denied/);
    await expect(withLinkContext(d, t.schema, (q) => q.query("select * from public.quotation_links"), "quotation_link")).rejects.toThrow(/permission denied/);
    await expect(withLinkContext(d, t.schema, (q) => q.query("select submit_odometer_via_link(gen_random_uuid(), 1, 'x')"), "quotation_link")).rejects.toThrow(/permission denied/);
  });
});
