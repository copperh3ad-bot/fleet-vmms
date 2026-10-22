import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { getOverview } from "@/lib/dashboard/overview";
import { seedDemo } from "@/lib/demo/seed";

let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, userId = "00000000-0000-0000-0000-0000000000aa"): Membership => ({ ...t, userId, role, vehicleScope: "all" });
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, mem("tenant_admin"), fn);

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Demo Workspace", slug: "demo" }, tenantMigrations(), { transform: stripExt });
  await seedDemo(d, t);
});

describe("dashboard overview on the demo data", () => {
  it("counts what the design's cards show", async () => {
    const approver = (await raw(async (q) => (await q.query<{ user_id: string }>("select user_id from employees where employee_no = 'E-202'")).rows[0])).user_id;
    const o = await getOverview(d, mem("fleet_manager", approver));
    expect(o.activeVehicles).toBe(7);
    expect(o.currency).toBe("PKR");
    expect(o.openCards.count).toBeGreaterThanOrEqual(8);
    expect(o.openCards.atWorkshop).toBe(2);                                                    // the bumper quotation and the handbrake job
    expect(o.docsExpiring.count).toBeGreaterThanOrEqual(5);                                     // expired token tax, fitness papers due, insurance due
    expect(o.docsExpiring.rows[0].days_left).toBeLessThanOrEqual(o.docsExpiring.rows.at(-1)!.days_left);   // soonest first
    expect(o.spendByMonth).toHaveLength(12);
    expect(o.spendByMonth.reduce((s, x) => s + x.cost, 0)).toBeGreaterThan(100000);
    expect(o.spendMonth.monthlyBudget).toBe(75000);                                             // 900,000 a year
    expect(["over", "ok"]).toContain(o.spendMonth.pacing);
    expect(o.serviceDue.overdue + o.serviceDue.soon).toBeGreaterThan(0);
    expect(o.serviceDue.rows.length).toBeLessThanOrEqual(5);
    expect(o.serviceDue.rows[0].status).toBe("overdue");                                        // worst first
  });

  it("the approval queue excludes cards the person is the requester of, and marks repeats", async () => {
    const approver = (await raw(async (q) => (await q.query<{ user_id: string }>("select user_id from employees where employee_no = 'E-202'")).rows[0])).user_id;
    const theirs = await getOverview(d, mem("fleet_manager", approver));
    expect(theirs.approvals!.count).toBe(5);
    expect(theirs.approvals!.rows.length).toBeLessThanOrEqual(5);
    expect(theirs.approvals!.rows.some((r) => r.registration_no === "BKL-302" && r.repeat)).toBe(true);   // the brake job that came back
    expect(theirs.approvals!.oldestDays).toBeGreaterThan(0);
    // Usman raised two of those five cards. Give him a login as a manager: he cannot approve his own, so he sees three.
    const usman = "00000000-0000-0000-0000-0000000000c1";
    await raw((q) => q.query("update employees set user_id = $1 where employee_no = 'E-104'", [usman]));
    expect((await getOverview(d, mem("fleet_manager", usman))).approvals!.count).toBe(3);
    // finance can read reports but cannot approve, so no queue
    expect((await getOverview(d, mem("finance"))).approvals).toBeNull();
  });

  it("the workshop scorecard measures days, quote against bill, and rework", async () => {
    const o = await getOverview(d, mem("auditor"));
    const alNoor = o.scorecard.find((s) => s.name === "Al-Noor Auto Works")!;
    expect(alNoor.jobs).toBeGreaterThanOrEqual(2);
    expect(alNoor.avg_days).not.toBeNull();
    expect(alNoor.rework_pct).toBeGreaterThan(0);                                               // the BKL-302 brake job came back
    expect(alNoor.quote_vs_bill_pct).toBeGreaterThanOrEqual(0);                                 // an extra line was billed
  });

  it("costliest vehicles carry their budget percentage, and reasons add up to 100", async () => {
    const o = await getOverview(d, mem("auditor"));
    expect(o.costliest.length).toBeGreaterThan(0);
    expect(o.costliest[0].spent).toBeGreaterThanOrEqual(o.costliest.at(-1)!.spent);
    const withBudget = o.costliest.find((c) => c.registration_no === "BKL-302")!;
    expect(withBudget.budget).toBe(60000);
    expect(withBudget.pct).toBeGreaterThan(0);
    const total = o.whyJobs.reduce((s, w) => s + w.pct, 0);
    expect(total).toBeGreaterThanOrEqual(95);
    expect(total).toBeLessThanOrEqual(105);                                                     // rounding
  });

  it("needs report.view", async () => {
    for (const role of ["requester", "vendor"]) await expect(getOverview(d, mem(role))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("another workspace sees an empty overview", async () => {
    const other = await provisionTenant(d, { name: "Other", slug: "other" }, tenantMigrations(), { transform: stripExt });
    const o = await getOverview(d, { ...other, userId: "00000000-0000-0000-0000-0000000000bb", role: "fleet_manager", vehicleScope: "all" });
    expect(o.activeVehicles).toBe(0);
    expect(o.openCards.count).toBe(0);
    expect(o.scorecard).toEqual([]);
    expect(o.spendMonth.monthlyBudget).toBeNull();
    expect(o.spendMonth.pacing).toBeNull();
  });
});
