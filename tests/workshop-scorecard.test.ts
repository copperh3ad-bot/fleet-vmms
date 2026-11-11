import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import * as vf from "@/lib/vendorflow/service";
import * as sc from "@/lib/vendorflow/scorecard";

// Owner decisions C2 to C4 (2026-11-11): workshop scorecard (last 12 months), Fleet Manager rating and flag, warn when a quotation is over the estimate or the budget.
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
const quote = (unit = "1500") => ({ details: "Pads", days_needed: "2", warranty_months: "6", lines: [{ kind: "part", description: "Brake pads", qty: "2", unit_cost: unit }] });

async function quoted(estimate: number | null, unit = "1500"): Promise<{ job: string; qid: string }> {
  const { id } = await jc.createJobCard(d, driver(), { vehicle_id: veh, reason_code_id: reason, cause_text: "Front brake pads worn to the metal", lines: [] }, true);
  if (estimate !== null) await raw(owner(), (q) => q.query("update job_cards set estimated_cost = $2 where id = $1", [id, estimate]));
  await jc.transitionJobCard(d, mgr2(), id, "approved");
  await jc.transitionJobCard(d, mgr(), id, "vendor_assigned", { vendorId: vA });
  await vf.submitQuotation(d, vendorA(), id, quote(unit));
  const qid = await raw(owner(), async (q) => (await q.query<{ id: string }>("select id from quotations where job_card_id = $1", [id])).rows[0].id);
  return { job: id, qid };
}

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Score Ltd", slug: "score", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  for (const [n, name] of [[11, "Driver One"], [12, "Manager One"], [13, "Manager Two"]] as const) {
    const e = await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` });
    await raw(owner(), (q) => q.query("update employees set user_id = $1 where id = $2", [U(n), e.id]));
  }
  vA = (await master.saveVendor(d, owner(), { name: "Quick Fix Motors", categories: ["brakes"] })).id;
  await raw(owner(), (q) => q.query("update vendors set user_id = $1 where id = $2", [U(21), vA]));
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[11, "requester"], [12, "fleet_manager"], [13, "fleet_manager"], [21, "vendor"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  const emp11 = await raw(owner(), async (q) => (await q.query<{ id: string }>("select id from employees where user_id = $1", [U(11)])).rows[0].id);
  veh = (await master.addVehicle(d, owner(), { registration_no: "SCR-001", employee_id: emp11, holding_since: "2026-01-01" })).id;
  reason = (await raw(owner(), async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'WEAR_BRAKES'")).rows[0])).id;
});

describe("quotation warnings (C3)", () => {
  it("does not warn when the quotation is within 10% of the estimate", async () => {
    const { job } = await quoted(3200);                     // quotation is 3,000
    const flow = await vf.getJobFlow(d, mgr(), job);
    expect(flow.quotations[0].warnings).toEqual([]);
  });

  it("warns when it is more than 10% above the estimate, and approval then needs a written reason", async () => {
    const { job, qid } = await quoted(2000);                // 3,000 against 2,000 = 50% over
    const flow = await vf.getJobFlow(d, mgr(), job);
    expect(flow.quotations[0].warnings.join()).toMatch(/50% above the estimate of 2,000/);
    await expect(vf.decideQuotation(d, mgr(), qid, "approve")).rejects.toThrow(/Write why you still approve/);
    await expect(vf.decideQuotation(d, mgr(), qid, "approve", "ok")).rejects.toThrow(/Write why you still approve/);
    await vf.decideQuotation(d, mgr(), qid, "approve", "Only workshop with the part in stock");
    const comment = await raw(owner(), async (q) => (await q.query<{ comment: string }>("select comment from job_card_events where job_card_id = $1 and to_status = 'quotation_approved'", [job])).rows[0].comment);
    expect(comment).toMatch(/^Warning accepted \(.*above the estimate.*\): Only workshop with the part in stock$/);
  });

  it("follows the company percentage", async () => {
    await raw(owner(), (q) => q.query("update settings set value = '60' where key = 'quote_over_estimate_pct'"));
    const { job } = await quoted(2000);
    expect((await vf.getJobFlow(d, mgr(), job)).quotations[0].warnings).toEqual([]);
    await raw(owner(), (q) => q.query("update settings set value = '10' where key = 'quote_over_estimate_pct'"));
  });

  it("warns when the quotation would take the vehicle over its budget", async () => {
    await raw(owner(), (q) => q.query("insert into budgets(vehicle_id, period_start, period_end, amount, reason) values ($1, current_date - 30, current_date + 300, 1000, 'test')", [veh]));
    const { job } = await quoted(null);
    expect((await vf.getJobFlow(d, mgr(), job)).quotations[0].warnings.join()).toMatch(/over its budget/);
    await raw(owner(), (q) => q.query("delete from budgets where vehicle_id = $1", [veh]));
  });
});

describe("workshop scorecard and rating (C2, C4)", () => {
  it("starts empty", async () => {
    const s = await sc.vendorScorecard(d, mgr(), vA);
    expect(s).toMatchObject({ jobs: 0, avg_days: null, on_time_pct: null, bill_vs_quote_pct: null, rework: 0, rating: null, ratings: 0, flagged: false });
  });

  it("counts finished jobs, on-time delivery and repeat repairs in the last 12 months", async () => {
    const { job, qid } = await quoted(3000);
    await vf.decideQuotation(d, mgr(), qid, "approve", "Fine");
    const wo = await raw(owner(), async (q) => (await q.query<{ id: string }>("select id from work_orders where job_card_id = $1", [job])).rows[0].id);
    await vf.startWork(d, vendorA(), wo);
    await vf.completeWork(d, vendorA(), wo, "Done");
    const first = await sc.vendorScorecard(d, mgr(), vA);
    expect(first).toMatchObject({ jobs: 1, on_time_pct: 100, rework: 0 });
    expect(first!.avg_days).not.toBeNull();
    // the same fault comes back on the same vehicle within 30 days
    await jc.createJobCard(d, driver(), { vehicle_id: veh, reason_code_id: reason, cause_text: "Front brake pads worn again quickly", lines: [] }, true);
    expect((await sc.vendorScorecard(d, mgr(), vA))!.rework).toBe(1);
    // work finished more than 12 months ago does not count
    await raw(owner(), (q) => q.query("update work_orders set issued_at = now() - interval '14 months', completed_at = now() - interval '14 months' where id = $1", [wo]));
    expect((await sc.vendorScorecard(d, mgr(), vA))!.jobs).toBe(0);
  });

  it("lets the Fleet Manager rate and flag, and refuses everyone else", async () => {
    await sc.rateVendor(d, mgr(), vA, { stars: 4 });
    await sc.rateVendor(d, mgr(), vA, { stars: 2 });
    expect(await sc.vendorScorecard(d, mgr(), vA)).toMatchObject({ rating: 3, ratings: 2, flagged: false });
    await expect(sc.rateVendor(d, mgr(), vA, { stars: 2, flagged: true })).rejects.toThrow(/why you flag/);
    await expect(sc.rateVendor(d, mgr(), vA, { stars: 9 })).rejects.toThrow(/1 to 5/);
    await sc.rateVendor(d, mgr(), vA, { stars: 1, flagged: true, note: "Left the car unfinished twice" });
    expect(await sc.vendorScorecard(d, mgr(), vA)).toMatchObject({ flagged: true, flag_note: "Left the car unfinished twice" });
    await expect(sc.rateVendor(d, driver(), vA, { stars: 5 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(sc.rateVendor(d, vendorA(), vA, { stars: 5 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("shows the scorecard beside each quotation", async () => {
    const { job } = await quoted(3000);
    const q1 = (await vf.getJobFlow(d, mgr(), job)).quotations[0];
    expect(q1.score).toMatchObject({ vendor_id: vA, flagged: true });
  });
});
