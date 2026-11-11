import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import * as vf from "@/lib/vendorflow/service";
import { lookupQuoteLink, submitViaQuoteLink } from "@/lib/vendorflow/link";

// ADR-090, owner decision C1: ask two or three workshops for an estimate on the same job card and compare them.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number, vehicleScope: "all" | "own" = "all"): Membership => ({ ...t, userId: U(n), role, vehicleScope });
const owner = () => mem("tenant_admin", 1);
const driver = () => mem("requester", 11, "own");
const mgr = () => mem("fleet_manager", 12);
const mgr2 = () => mem("fleet_manager", 13);
const vendorOf = (i: 0 | 1 | 2 | 3) => mem("vendor", 21 + i);
let veh: string, reason: string;
let V: string[];
const raw = <T,>(m: Membership, fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, m, fn);
const statusOf = (id: string) => raw(owner(), async (q) => (await q.query<{ status: string }>("select status from job_cards where id = $1", [id])).rows[0].status);
const vendorOnCard = (id: string) => raw(owner(), async (q) => (await q.query<{ vendor_id: string }>("select vendor_id from job_cards where id = $1", [id])).rows[0].vendor_id);
const estimate = (unit: string) => ({ details: "Pads", days_needed: "2", warranty_months: "6", lines: [{ kind: "part", description: "Brake pads", qty: "2", unit_cost: unit }] });

async function assigned(): Promise<string> {
  const { id } = await jc.createJobCard(d, driver(), { vehicle_id: veh, reason_code_id: reason, cause_text: "Front brake pads worn to the metal", lines: [] }, true);
  await jc.transitionJobCard(d, mgr2(), id, "approved");
  await jc.transitionJobCard(d, mgr(), id, "vendor_assigned", { vendorId: V[0] });
  return id;
}
const quotationIdOf = (job: string, vendor: string) => raw(owner(), async (q) => (await q.query<{ id: string }>("select id from quotations where job_card_id = $1 and vendor_id = $2 order by created_at desc limit 1", [job, vendor])).rows[0].id);

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Multi Ltd", slug: "multi", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  for (const [n, name] of [[11, "Driver One"], [12, "Manager One"], [13, "Manager Two"]] as const) {
    const e = await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` });
    await raw(owner(), (q) => q.query("update employees set user_id = $1 where id = $2", [U(n), e.id]));
  }
  V = [];
  for (const [i, name] of ["Alpha Motors", "Bravo Garage", "Charlie Auto", "Delta Works"].entries()) {
    const id = (await master.saveVendor(d, owner(), { name, categories: ["brakes"] })).id;
    await raw(owner(), (q) => q.query("update vendors set user_id = $1, phone = $3 where id = $2", [U(21 + i), id, `0300 000000${i}`]));
    V.push(id);
  }
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[11, "requester"], [12, "fleet_manager"], [13, "fleet_manager"], [21, "vendor"], [22, "vendor"], [23, "vendor"], [24, "vendor"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  const emp11 = await raw(owner(), async (q) => (await q.query<{ id: string }>("select id from employees where user_id = $1", [U(11)])).rows[0].id);
  veh = (await master.addVehicle(d, owner(), { registration_no: "MUL-001", employee_id: emp11, holding_since: "2026-01-01" })).id;
  reason = (await raw(owner(), async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'WEAR_BRAKES'")).rows[0])).id;
});
beforeEach(async () => { await withPlatform(d, (q) => q.query("update public.quotation_links set revoked_at = now() where revoked_at is null")); });

describe("asking more than one workshop", () => {
  it("lets a manager ask up to three workshops, never more, never the same twice", async () => {
    const job = await assigned();
    await vf.inviteWorkshop(d, mgr(), job, V[1]);
    await expect(vf.inviteWorkshop(d, mgr(), job, V[1])).rejects.toThrow(/already asked/i);
    await expect(vf.inviteWorkshop(d, mgr(), job, V[0])).rejects.toThrow(/already asked/i);       // the workshop on the card counts
    await vf.inviteWorkshop(d, mgr(), job, V[2]);
    await expect(vf.inviteWorkshop(d, mgr(), job, V[3])).rejects.toThrow(/at most three/i);
    const flow = await vf.getJobFlow(d, mgr(), job);
    expect(flow.workshops.map((w) => [w.name, w.first])).toEqual([["Alpha Motors", true], ["Bravo Garage", false], ["Charlie Auto", false]]);
  });

  it("is for people who assign workshops, and only while the card waits for estimates", async () => {
    const job = await assigned();
    await expect(vf.inviteWorkshop(d, driver(), job, V[1])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(vf.inviteWorkshop(d, vendorOf(0), job, V[1])).rejects.toBeInstanceOf(ForbiddenError);
    const { id } = await jc.createJobCard(d, driver(), { vehicle_id: veh, reason_code_id: reason, cause_text: "Another card, not assigned yet", lines: [] }, true);
    await expect(vf.inviteWorkshop(d, mgr(), id, V[1])).rejects.toBeInstanceOf(UserError);
  });

  it("takes back a request that has not been answered, and not one that has", async () => {
    const job = await assigned();
    await vf.inviteWorkshop(d, mgr(), job, V[1]);
    await vf.inviteWorkshop(d, mgr(), job, V[2]);
    await vf.uninviteWorkshop(d, mgr(), job, V[2]);
    expect((await vf.getJobFlow(d, mgr(), job)).workshops).toHaveLength(2);
    await vf.submitQuotation(d, vendorOf(1), job, estimate("1500"));
    await expect(vf.uninviteWorkshop(d, mgr(), job, V[1])).rejects.toThrow(/already sent/i);
    await expect(vf.uninviteWorkshop(d, mgr(), job, V[0])).rejects.toThrow(/not asked as an extra/i);   // the first workshop is changed by assigning again
  });

  it("gives each asked workshop its own link, and a new link for one leaves the others working", async () => {
    const job = await assigned();
    await vf.inviteWorkshop(d, mgr(), job, V[1]);
    const a = await vf.createWorkshopLink(d, mgr(), job, "quotation");
    const b = await vf.createWorkshopLink(d, mgr(), job, "quotation", { vendorId: V[1] });
    expect([a.vendor_name, b.vendor_name]).toEqual(["Alpha Motors", "Bravo Garage"]);
    expect(await lookupQuoteLink(d, a.token)).not.toBeNull();
    expect(await lookupQuoteLink(d, b.token)).not.toBeNull();
    const a2 = await vf.createWorkshopLink(d, mgr(), job, "quotation");          // replaces Alpha's link only
    expect(await lookupQuoteLink(d, a.token)).toBeNull();
    expect(await lookupQuoteLink(d, a2.token)).not.toBeNull();
    expect(await lookupQuoteLink(d, b.token)).not.toBeNull();
    await expect(vf.createWorkshopLink(d, mgr(), job, "quotation", { vendorId: V[3] })).rejects.toBeInstanceOf(UserError);   // never asked
  });
});

describe("estimates from several workshops", () => {
  it("accepts one estimate from each, moves the card on the first, and shows them side by side", async () => {
    const job = await assigned();
    await vf.inviteWorkshop(d, mgr(), job, V[1]);
    await vf.inviteWorkshop(d, mgr(), job, V[2]);
    // the first through its sign-in, the second through its link, the third through its sign-in
    await vf.submitQuotation(d, vendorOf(0), job, estimate("1500"));
    expect(await statusOf(job)).toBe("quotation_received");
    const link = await vf.createWorkshopLink(d, mgr(), job, "quotation", { vendorId: V[1] });
    const r = await submitViaQuoteLink(d, link.token, estimate("1200"));
    expect(r).toEqual({ ok: true });
    await vf.submitQuotation(d, vendorOf(2), job, estimate("1800"));
    const flow = await vf.getJobFlow(d, mgr(), job);
    expect(flow.quotations.map((x) => [x.vendor_name, x.amount]).sort()).toEqual([["Alpha Motors", "3000.00"], ["Bravo Garage", "2400.00"], ["Charlie Auto", "3600.00"]]);
    expect(await statusOf(job)).toBe("quotation_received");
    const events = await raw(owner(), async (q) => (await q.query<{ to_status: string }>("select to_status from job_card_events where job_card_id = $1 order by seq", [job])).rows.map((x) => x.to_status));
    expect(events.filter((s) => s === "quotation_received")).toHaveLength(1);
  });

  it("lets a workshop send only one estimate at a time, and a workshop that was not asked none", async () => {
    const job = await assigned();
    await vf.inviteWorkshop(d, mgr(), job, V[1]);
    await vf.submitQuotation(d, vendorOf(0), job, estimate("1500"));
    await expect(vf.submitQuotation(d, vendorOf(0), job, estimate("1400"))).rejects.toThrow(/already sent/i);
    await expect(vf.submitQuotation(d, vendorOf(3), job, estimate("1000"))).rejects.toThrow(/not found/);
    const link = await vf.createWorkshopLink(d, mgr(), job, "quotation", { vendorId: V[1] });
    await submitViaQuoteLink(d, link.token, estimate("1000"));
    await expect(vf.createWorkshopLink(d, mgr(), job, "quotation", { vendorId: V[1] })).rejects.toThrow(/already sent/i);
  });

  it("shows an asked workshop the request in its own list, and nobody else", async () => {
    const job = await assigned();
    await vf.inviteWorkshop(d, mgr(), job, V[1]);
    expect((await vf.vendorOverview(d, vendorOf(1))).requests.map((x) => x.job_card_id)).toContain(job);
    expect((await vf.vendorOverview(d, vendorOf(3))).requests.map((x) => x.job_card_id)).not.toContain(job);
  });
});

describe("deciding between them", () => {
  it("approving one declines the others, makes its workshop the card's workshop, and tells the others", async () => {
    const job = await assigned();
    await vf.inviteWorkshop(d, mgr(), job, V[1]);
    await vf.inviteWorkshop(d, mgr(), job, V[2]);
    await vf.submitQuotation(d, vendorOf(0), job, estimate("1500"));
    await vf.submitQuotation(d, vendorOf(1), job, estimate("1200"));
    await vf.submitQuotation(d, vendorOf(2), job, estimate("1800"));
    const winner = await quotationIdOf(job, V[1]);
    await vf.decideQuotation(d, mgr(), winner, "approve", "Cheapest and quickest");
    expect(await statusOf(job)).toBe("quotation_approved");
    expect(await vendorOnCard(job)).toBe(V[1]);
    const states = await raw(owner(), async (q) => (await q.query<{ vendor_id: string; status: string }>("select vendor_id, status from quotations where job_card_id = $1", [job])).rows);
    expect(Object.fromEntries(states.map((s) => [s.vendor_id, s.status]))).toEqual({ [V[0]]: "rejected", [V[1]]: "approved", [V[2]]: "rejected" });
    const flow = await vf.getJobFlow(d, mgr(), job);
    expect(flow.workOrder).toMatchObject({ approved_amount: "2400.00" });
    const wo = await raw(owner(), async (q) => (await q.query<{ vendor_id: string }>("select vendor_id from work_orders where job_card_id = $1", [job])).rows[0].vendor_id);
    expect(wo).toBe(V[1]);
    expect((await jc.listNotifications(d, vendorOf(0))).some((n) => n.kind === "quotation.rejected" && n.payload.job_card_id === job)).toBe(true);
    expect((await jc.listNotifications(d, vendorOf(2))).some((n) => n.kind === "quotation.rejected" && n.payload.job_card_id === job)).toBe(true);
    // the winner can now be asked for the invoice, and the losers can no longer quote
    expect((await vf.createWorkshopLink(d, mgr(), job, "invoice")).vendor_name).toBe("Bravo Garage");
    await expect(vf.submitQuotation(d, vendorOf(0), job, estimate("1"))).rejects.toThrow();
  });

  it("declining one keeps the card open while another estimate waits, and sends it back when none is left", async () => {
    const job = await assigned();
    await vf.inviteWorkshop(d, mgr(), job, V[1]);
    await vf.submitQuotation(d, vendorOf(0), job, estimate("1500"));
    await vf.submitQuotation(d, vendorOf(1), job, estimate("1200"));
    await vf.decideQuotation(d, mgr(), await quotationIdOf(job, V[0]), "reject", "Too expensive for brake pads");
    expect(await statusOf(job)).toBe("quotation_received");
    const history = await raw(owner(), async (q) => (await q.query<{ comment: string }>("select comment from job_card_events where job_card_id = $1 and comment like 'Estimate from%'", [job])).rows);
    expect(history[0].comment).toMatch(/Estimate from Alpha Motors declined: Too expensive/);
    await vf.decideQuotation(d, mgr(), await quotationIdOf(job, V[1]), "reject", "Cannot do it this week");
    expect(await statusOf(job)).toBe("vendor_assigned");
    // both may quote again
    await vf.submitQuotation(d, vendorOf(1), job, estimate("1300"));
    expect(await statusOf(job)).toBe("quotation_received");
  });

  it("keeps a card with one workshop working exactly as before", async () => {
    const job = await assigned();
    await vf.submitQuotation(d, vendorOf(0), job, estimate("1500"));
    await vf.decideQuotation(d, mgr(), await quotationIdOf(job, V[0]), "reject", "Please check the price");
    expect(await statusOf(job)).toBe("vendor_assigned");
    await vf.submitQuotation(d, vendorOf(0), job, estimate("1400"));
    await vf.decideQuotation(d, mgr(), await quotationIdOf(job, V[0]), "approve", "Fine");
    expect(await statusOf(job)).toBe("quotation_approved");
    expect(await vendorOnCard(job)).toBe(V[0]);
  });
});
