// The data behind every screen, as a list of named loaders, for tests that need to run all of them (the smoke test over a
// seeded workspace, and the check that one organization never sees another's data).
import type { Driver } from "@/lib/db/types";
import type { Membership } from "@/lib/auth/can";
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

/** `fin` is a finance membership of the same workspace: invoices are finance's screen, not the manager's. */
export async function allLoaders(d: Driver, m: Membership, fin: Membership) {
  const vehicles = await master.listVehicles(d, m);
  const jobs = await jc.listJobCards(d, m);
  const invoices = await vf.listInvoices(d, fin);
  const cycles = await od.listCycles(d, m);
  const docs = await cs.listDocuments(d, m);
  const acc = await cs.listAccidents(d, m);
  const challans = await cs.listChallans(d, m);
  return [
    ["overview", () => getOverview(d, m)], ["dashboard", () => getDashboard(d, m)], ["nav counts", () => getNavCounts(d, m)],
    ["board", () => board.getBoard(d, m, {})], ["board filtered", () => board.getBoard(d, m, { q: "BKL", filter: "attention" })],
    ["vehicle record", () => Promise.all(vehicles.map((v) => record.getVehicleRecord(d, m, v.id)))],
    ["employees", () => master.listEmployees(d, m)], ["employee options", () => master.listEmployeeOptions(d, m)], ["vendors", () => master.listVendors(d, m)], ["service types", () => master.listServiceTypes(d, m)],
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
    ["users", () => Promise.all([admin.listMembers(d, m), admin.listRoles(d, m), admin.listInvitations(d, m), admin.planUsage(d, m), admin.getRoleMatrix(d, m)])],
  ] as const;
}
