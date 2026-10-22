// Smoke test: seed the demo workspace, then run the data behind every screen as each kind of person.
// Managers and administrators must get an answer from every loader; other roles must either get one or be refused
// with ForbiddenError, never any other error (a broken query, a missing column, an unhandled null).
import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { seedDemo } from "@/lib/demo/seed";
import * as master from "@/lib/master/service";
import * as board from "@/lib/master/board";
import * as record from "@/lib/master/record";
import * as jc from "@/lib/jobcards/service";
import * as vf from "@/lib/vendorflow/service";
import * as od from "@/lib/odometer/service";
import * as cs from "@/lib/compliance/service";
import * as an from "@/lib/analytics/service";
import { breakingReport } from "@/lib/analytics/breaking";
import * as ct from "@/lib/control/service";
import * as admin from "@/lib/admin/service";
import { getOverview } from "@/lib/dashboard/overview";
import { getDashboard, getNavCounts } from "@/lib/dashboard/service";

let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
let manager: string;
const mem = (role: string, userId = "00000000-0000-0000-0000-0000000000aa"): Membership => ({ ...t, userId, role, vehicleScope: "all" });
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, mem("tenant_admin"), fn);

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Demo Workspace", slug: "demo" }, tenantMigrations(), { transform: stripExt });
  await seedDemo(d, t);
  manager = (await raw(async (q) => (await q.query<{ user_id: string }>("select user_id from employees where employee_no = 'E-202'")).rows[0])).user_id;
});

/** Every screen's loaders, given real ids from the seeded data. */
async function loaders(m: Membership) {
  const vehicles = await master.listVehicles(d, m);
  const jobs = await jc.listJobCards(d, m);
  const fin = mem("finance");
  const invoices = await vf.listInvoices(d, fin);
  const cycles = await od.listCycles(d, m);
  const docs = await cs.listDocuments(d, m);
  const acc = await cs.listAccidents(d, m);
  const challans = await cs.listChallans(d, m);
  return [
    ["overview", () => getOverview(d, m)], ["dashboard", () => getDashboard(d, m)], ["nav counts", () => getNavCounts(d, m)],
    ["board", () => board.getBoard(d, m, {})], ["board filtered", () => board.getBoard(d, m, { q: "BKL", filter: "attention" })],
    ["vehicle record", () => Promise.all(vehicles.map((v) => record.getVehicleRecord(d, m, v.id)))],
    ["employees", () => master.listEmployees(d, m)], ["vendors", () => master.listVendors(d, m)], ["service types", () => master.listServiceTypes(d, m)],
    ["job context", () => Promise.all(vehicles.map((v) => jc.getJobContext(d, m, v.id)))],
    ["job review", () => Promise.all(jobs.map((j) => jc.getReviewContext(d, m, j.id)))], ["job card", () => Promise.all(jobs.map((j) => jc.getJobCard(d, m, j.id)))],
    ["job flow", () => Promise.all(jobs.map((j) => vf.getJobFlow(d, m, j.id)))], ["reasons", () => jc.listReasonCodes(d, m)], ["notifications", () => jc.listNotifications(d, m)],
    ["invoices", () => Promise.all([vf.listInvoices(d, fin, { status: "submitted" }), ...invoices.map((i) => vf.getInvoiceReview(d, fin, i.id))])],
    ["odometer", () => Promise.all([od.listCycles(d, m), ...cycles.map((c) => od.getCycle(d, m, c.id))])],
    ["documents", () => Promise.all([cs.listDocuments(d, m, { status: "expired" }), cs.listMissingDocuments(d, m, ["registration", "insurance"]), ...docs.slice(0, 5).map((x) => cs.getDocument(d, m, x.entity_type, x.entity_id))])],
    ["accidents", () => Promise.all(acc.map((a) => cs.getAccident(d, m, a.id)))], ["challans", () => Promise.resolve(challans)],
    ["flags", () => an.getFlags(d, m)], ["costs", () => an.costOverview(d, m, 12)], ["breaking", () => Promise.all([30, 90, 365].flatMap((days) => ["driver", "vehicle", "workshop"].map((group) => breakingReport(d, m, { days, group }))))],
    ["budgets", () => Promise.all([ct.listBudgets(d, m), ct.getBudgetBoard(d, m, { filter: "all" }), ct.getBudgetBoard(d, m)])],
    ["settings", () => Promise.all([ct.getSettings(d, m), ct.listServiceRules(d, m)])],
    ["users", () => Promise.all([admin.listMembers(d, m), admin.listRoles(d, m), admin.listInvitations(d, m), admin.planUsage(d, m)])],
  ] as const;
}

describe("every screen's data on the seeded demo workspace", () => {
  it("is not empty where the demo has data", async () => {
    const m = mem("fleet_manager", manager);
    expect((await master.listVehicles(d, m)).length).toBeGreaterThanOrEqual(7);
    expect((await jc.listJobCards(d, m)).length).toBeGreaterThanOrEqual(9);
    expect((await cs.listDocuments(d, m)).length).toBeGreaterThan(0);
    expect((await od.listCycles(d, m)).length).toBeGreaterThan(0);
    expect((await ct.getBudgetBoard(d, m, { filter: "all" })).total).toBeGreaterThan(0);
  });

  it("every loader answers for at least one role, and no role ever gets anything but an answer or a refusal", async () => {
    const answered = new Set<string>(), all = new Set<string>();
    for (const role of ["fleet_manager", "tenant_admin", "finance", "auditor", "requester", "vendor"]) {
      const m = mem(role, role === "fleet_manager" ? manager : undefined);
      const list = await loaders(m).catch((e: unknown) => { expect(`${role} preload: ${e instanceof ForbiddenError ? "refused" : (e as Error).message}`).toBe(`${role} preload: refused`); return []; });
      for (const [name, run] of list) {
        all.add(name);
        const r = await run().then(() => "ok", (e: unknown) => (e instanceof ForbiddenError ? "refused" : `${role} ${name}: ${(e as Error).message}`));
        expect(r === "ok" || r === "refused" ? "fine" : r).toBe("fine");
        if (r === "ok") answered.add(name);
      }
    }
    expect([...all].filter((n) => !answered.has(n))).toEqual([]);
  });
});
