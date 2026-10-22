import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import * as cs from "@/lib/compliance/service";
import * as an from "@/lib/analytics/service";
import * as ct from "@/lib/control/service";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const mgr = () => mem("fleet_manager", 12);
const mgr2 = () => mem("fleet_manager", 13);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);
const setSetting = (k: string, v: string) => raw((q) => q.query("update settings set value = $2 where key = $1", [k, v]));

let reasons: Record<string, string>;
let emp: string;
const car: Record<string, string> = {};

/** A submitted job card of a given cost, back-dated. Cost comes from one estimate line. */
async function job(vehicle: string, reason: string, daysAgo: number, cost: number, opts: { vendor?: string; driver?: string } = {}) {
  const { id } = await jc.createJobCard(d, mgr(), { vehicle_id: vehicle, requested_by: emp, reason_code_id: reasons[reason], cause_text: "Worked on during the test run", lines: [{ kind: "service", description: "Work", qty: "1", unit_cost: String(cost) }] }, true);
  await raw((q) => q.query("update job_cards set created_at = now() - ($2 || ' days')::interval, vendor_id = coalesce($3::uuid, vendor_id), custodian_id = coalesce($4::uuid, custodian_id) where id = $1", [id, String(daysAgo), opts.vendor ?? null, opts.driver ?? null]));
  return id;
}
const flagsOf = async (plate: string) => (await an.getFlags(d, mgr())).filter((f) => f.registration_no === plate).map((f) => f.flag).sort();
const clearJobs = () => raw(async (q) => { for (const t of ["invoices", "work_orders", "quotations", "job_cards"]) await q.query(`delete from ${t} where true`); });

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  for (const n of [12, 13]) {
    const e = await master.saveEmployee(d, owner(), { full_name: `Manager ${n}`, employee_no: `E-${n}` });
    await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), e.id]));
    if (n === 12) emp = e.id;
  }
  reasons = Object.fromEntries((await raw(async (q) => (await q.query<{ id: string; code: string }>("select id, code from reason_codes")).rows)).map((r) => [r.code, r.id]));
  for (const [plate, make, model] of [["H-1", "Toyota", "Hilux"], ["H-2", "Toyota", "Hilux"], ["H-3", "Toyota", "Hilux"], ["I-1", "Isuzu", "D-Max"]] as const)
    car[plate] = (await master.addVehicle(d, owner(), { registration_no: plate, make, model, vehicle_class: "pickup" })).id;
});

describe("repeat repairs", () => {
  it("counts the same fault coming back inside the window, never routine service, never a different fault", async () => {
    await clearJobs();
    await job(car["H-1"], "WEAR_BRAKES", 100, 500);
    await job(car["H-1"], "WEAR_BRAKES", 60, 500);          // 40 days after the first: repeat at 60 days
    await job(car["H-1"], "WEAR_TYRES", 55, 500);           // different fault
    await job(car["H-1"], "SVC_ROUTINE", 50, 100);
    await job(car["H-1"], "SVC_ROUTINE", 45, 100);          // routine service, 5 days apart: still not a repeat
    const rows = await raw(async (q) => (await q.query<{ reason: string; days_since: number }>("select reason, days_since from flag_repeat_days")).rows);
    expect(rows).toEqual([{ reason: "Brake wear", days_since: 40 }]);
    await setSetting("flag_repeat_days", "30");
    expect(await raw(async (q) => (await q.query("select 1 from flag_repeat_days")).rows)).toHaveLength(0);
    await setSetting("flag_repeat_days", "60");
    expect(await flagsOf("H-1")).toContain("repeat_repair");
  });

  it("names the workshop whose earlier job came back", async () => {
    await clearJobs();
    const v = (await master.saveVendor(d, owner(), { name: "Quick Fix Motors" })).id;
    await job(car["H-2"], "WEAR_BRAKES", 70, 800, { vendor: v });
    await job(car["H-2"], "WEAR_BRAKES", 20, 800);
    const w = await an.whyItKeepsBreaking(d, mgr());
    expect(w.repeats).toHaveLength(1);
    expect(w.repeats[0]).toMatchObject({ registration_no: "H-2", reason: "Brake wear", days_since: 50, previous_vendor: "Quick Fix Motors", vendor: null });
    expect(w.cameBackByVendor).toEqual([{ vendor: "Quick Fix Motors", repeats: 1 }]);
    expect(w.repeatThresholdDays).toBe(60);
    expect(w.busiest[0]).toMatchObject({ registration_no: "H-2", jobs: 2, top_reason: "Brake wear" });
  });
});

describe("flags", () => {
  it("too many jobs in 90 days uses the setting and ignores older jobs", async () => {
    await clearJobs();
    await job(car["H-1"], "WEAR_BRAKES", 5, 10); await job(car["H-1"], "WEAR_TYRES", 30, 10); await job(car["H-1"], "DEFECT_PART", 100, 10);
    expect(await flagsOf("H-1")).not.toContain("too_many_jobs");          // only 2 inside 90 days
    await job(car["H-1"], "OTHER", 80, 10);
    expect(await flagsOf("H-1")).toContain("too_many_jobs");
    await setSetting("flag_jobs_90d", "4");
    expect(await flagsOf("H-1")).not.toContain("too_many_jobs");
    await setSetting("flag_jobs_90d", "3");
  });

  it("cost compared with similar vehicles needs three peers and a real gap", async () => {
    await clearJobs();
    await job(car["H-1"], "WEAR_BRAKES", 30, 1000); await job(car["H-2"], "WEAR_BRAKES", 30, 1000); await job(car["H-3"], "WEAR_BRAKES", 30, 5000);
    await job(car["I-1"], "WEAR_BRAKES", 30, 90000);                         // the only Isuzu: nothing to compare with
    const f = await raw(async (q) => (await q.query<{ registration_no: string; multiple: string; peers: number }>("select registration_no, multiple::text, peers from flag_cost_multiple")).rows);
    expect(f).toEqual([{ registration_no: "H-3", multiple: "5.0", peers: 3 }]);
    expect(await flagsOf("I-1")).not.toContain("cost_vs_peers");
    await setSetting("flag_cost_multiple", "6");
    expect(await raw(async (q) => (await q.query("select 1 from flag_cost_multiple")).rows)).toHaveLength(0);
    await setSetting("flag_cost_multiple", "2.0");
    await job(car["H-1"], "WEAR_TYRES", 400, 99999);                         // older than 12 months: not counted
    expect((await flagsOf("H-1"))).not.toContain("cost_vs_peers");
  });

  it("expired and soon-to-expire documents show up as flags", async () => {
    await cs.addDocument(d, mgr(), { vehicle_id: car["H-3"], doc_type: "fitness", expires_on: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10) });
    await cs.addDocument(d, mgr(), { vehicle_id: car["H-2"], doc_type: "registration", expires_on: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10) });
    expect(await flagsOf("H-3")).toContain("document_expired");
    expect(await flagsOf("H-2")).toContain("document_due");
    expect((await an.getFlags(d, mgr()))[0].severity).toBe("high");           // high first
  });
});

describe("budgets", () => {
  const year = new Date().getUTCFullYear();
  const B = (extra: Record<string, unknown> = {}) => ({ period_start: `${year}-01-01`, period_end: `${year}-12-31`, amount: "100000", ...extra });

  it("tracks spending against a fleet budget and a vehicle budget, and flags at the set levels", async () => {
    await clearJobs();
    await job(car["H-1"], "WEAR_BRAKES", 3, 6000); await job(car["H-2"], "WEAR_BRAKES", 3, 2000);
    const fleet = await ct.saveBudget(d, mgr(), B({ amount: "10000" }));
    const own = await ct.saveBudget(d, mgr(), B({ vehicle_id: car["H-1"], amount: "5000" }));
    const rows = await ct.listBudgets(d, mgr());
    const f = rows.find((r) => r.id === fleet)!, o = rows.find((r) => r.id === own)!;
    expect(f).toMatchObject({ registration_no: null, when: "current", over_budget: false });
    expect(Number(f.spent)).toBe(8000);
    expect(Number(f.pct_used)).toBe(80);
    expect(Number(o.spent)).toBe(6000); expect(o.over_budget).toBe(true);
    const flags = await an.getFlags(d, mgr());
    expect(flags.find((x) => x.flag === "near_budget" && x.vehicle_id === null)?.detail).toMatch(/80/);        // fleet at the 80% warning level
    expect(flags.find((x) => x.flag === "over_budget" && x.registration_no === "H-1")?.severity).toBe("high");
    await setSetting("budget_warn_pct", "90");
    expect((await an.getFlags(d, mgr())).some((x) => x.flag === "near_budget")).toBe(false);
    await setSetting("budget_warn_pct", "80");
  });

  it("refuses overlaps, bad dates and negative amounts", async () => {
    await expect(ct.saveBudget(d, mgr(), B({ amount: "1", period_start: `${year}-06-01`, period_end: `${year + 1}-01-31` }))).rejects.toThrow(/overlaps/);
    expect((await ct.saveBudget(d, mgr(), B({ period_start: `${year}-05-01`, period_end: `${year}-04-01` })).catch((x) => x)).fields.period_end).toBeTruthy();
    expect((await ct.saveBudget(d, mgr(), B({ amount: "-5", vehicle_id: car["H-3"] })).catch((x) => x)).fields.amount).toBeTruthy();
    await ct.saveBudget(d, mgr(), B({ vehicle_id: car["H-3"], amount: "7000" }));                      // another vehicle, same period: fine
  });

  it("changing an amount needs a new reason", async () => {
    const id = await ct.saveBudget(d, mgr(), { period_start: `${year + 5}-01-01`, period_end: `${year + 5}-12-31`, amount: "1000", reason: "Initial plan" });
    const e = await ct.saveBudget(d, mgr(), { id, period_start: `${year + 5}-01-01`, period_end: `${year + 5}-12-31`, amount: "2000" }).catch((x) => x);
    expect(e).toBeInstanceOf(UserError); expect(e.fields.reason).toBeTruthy();
    await expect(ct.saveBudget(d, mgr(), { id, period_start: `${year + 5}-01-01`, period_end: `${year + 5}-12-31`, amount: "2000", reason: "Initial plan" })).rejects.toThrow(/different reason/);
    await ct.saveBudget(d, mgr(), { id, period_start: `${year + 5}-01-01`, period_end: `${year + 5}-12-31`, amount: "2000", reason: "Two more vehicles joined" });
    expect(Number((await ct.listBudgets(d, mgr())).find((r) => r.id === id)!.amount)).toBe(2000);
    expect((await ct.listBudgets(d, mgr())).find((r) => r.id === id)!.when).toBe("future");
  });

  it("who may write: admin, fleet manager, finance; auditors only read", async () => {
    const forbidden = (p: Promise<unknown>) => p.then(() => false, (e) => e instanceof ForbiddenError);
    const body = (n: number) => ({ period_start: `${year + 10 + n}-01-01`, period_end: `${year + 10 + n}-12-31`, amount: "1" });
    let n = 0;
    for (const [role, write, read] of [["tenant_admin", true, true], ["fleet_manager", true, true], ["finance", true, true], ["auditor", false, true], ["requester", false, false], ["vendor", false, false]] as const) {
      expect(!(await forbidden(ct.saveBudget(d, mem(role, 60), body(n++)))), `${role} write`).toBe(write);
      expect(!(await forbidden(ct.listBudgets(d, mem(role, 60)))), `${role} read`).toBe(read);
    }
  });
});

describe("cost report", () => {
  it("adds up by month, reason, vehicle, workshop and driver, with empty months filled in", async () => {
    await clearJobs();
    const v = (await master.saveVendor(d, owner(), { name: "Al-Noor Garage" })).id;
    const driver1 = emp;
    await job(car["H-1"], "WEAR_BRAKES", 2, 1000, { vendor: v, driver: driver1 });
    await job(car["H-1"], "WEAR_TYRES", 2, 500);
    await job(car["H-2"], "WEAR_BRAKES", 130, 300);
    await job(car["H-3"], "WEAR_BRAKES", 700, 99999);                       // outside 12 months
    const r = await an.costOverview(d, mgr(), 12);
    expect(r.byMonth).toHaveLength(12);
    expect(r.total).toBe(1800); expect(r.jobs).toBe(3); expect(r.average).toBe(600);
    expect(r.byMonth.reduce((s, x) => s + x.cost, 0)).toBe(1800);
    expect(r.byCategory.find((c) => c.label === "wear_and_tear")).toMatchObject({ cost: 1800, jobs: 3 });
    expect(r.byVehicle.map((x) => [x.label, x.cost])).toEqual([["H-1", 1500], ["H-2", 300]]);
    expect(r.byVendor.find((x) => x.label === "Al-Noor Garage")).toMatchObject({ cost: 1000, jobs: 1 });
    expect(r.byVendor.find((x) => x.label === "No vendor")?.cost).toBe(800);
    expect(r.byDriver.find((x) => x.label.startsWith("Manager 12"))?.cost).toBe(1000);
    expect((await an.costOverview(d, mgr(), 3)).total).toBe(1500);          // the 130-day-old job is outside the last 3 whole months
    expect((await an.costOverview(d, mgr(), 6)).total).toBe(1800);
    expect((await an.costOverview(d, mgr(), 999)).months).toBe(12);          // odd input falls back
  });

  it("uses the verified payable amount over the estimate", async () => {
    await clearJobs();
    const id = await job(car["H-1"], "WEAR_BRAKES", 1, 1000);
    await raw(async (q) => {
      const vid = (await q.query<{ id: string }>("insert into vendors(name) values ('V') returning id")).rows[0].id;
      const wo = (await q.query<{ id: string }>("insert into work_orders(wo_no, job_card_id, vendor_id, approved_amount) values ('WO-X', $1, $2, 900) returning id", [id, vid])).rows[0].id;
      await q.query("insert into invoices(work_order_id, invoice_no, invoice_date, amount, tax_amount, status, payable_amount) values ($1, 'I-1', current_date, 1100, 0, 'verified', 900)", [wo]);
    });
    expect((await an.costOverview(d, mgr(), 3)).total).toBe(900);
  });
});

describe("who changed the reason", () => {
  it("shows where the manager re-tagged what the requester picked", async () => {
    await clearJobs();
    const a = (await jc.createJobCard(d, mgr(), { vehicle_id: car["H-1"], requested_by: emp, reason_code_id: reasons.WEAR_BRAKES, cause_text: "Brakes squeal and pull to the left", lines: [] }, true)).id;
    await jc.createJobCard(d, mgr(), { vehicle_id: car["H-2"], requested_by: emp, reason_code_id: reasons.WEAR_BRAKES, cause_text: "Brakes squeal and pull to the left", lines: [] }, true);
    await jc.transitionJobCard(d, mgr2(), a, "approved", { reasonCodeId: reasons.MISUSE_OVERLOAD });
    const w = await an.whyItKeepsBreaking(d, mgr());
    expect(w.retagged.total).toBe(2); expect(w.retagged.changed).toBe(1);
    expect(w.retagged.examples[0]).toMatchObject({ registration_no: "H-1", requested: "Brake wear", final: "Overloading / rough use" });
  });
});

describe("report permissions", () => {
  it("report.view only", async () => {
    const forbidden = (p: Promise<unknown>) => p.then(() => false, (e) => e instanceof ForbiddenError);
    for (const [role, ok] of [["tenant_admin", true], ["fleet_manager", true], ["finance", true], ["auditor", true], ["requester", false], ["vendor", false]] as const) {
      const m = mem(role, 61);
      expect(!(await forbidden(an.getFlags(d, m))), role).toBe(ok);
      expect(!(await forbidden(an.costOverview(d, m))), role).toBe(ok);
      expect(!(await forbidden(an.whyItKeepsBreaking(d, m))), role).toBe(ok);
    }
  });
  it("another workspace sees none of it", async () => {
    const other = await provisionTenant(d, { name: "Other Co", slug: "other", ownerUserId: U(2), ownerName: "O" }, tenantMigrations(), { transform: stripExt });
    const o: Membership = { ...other, userId: U(70), role: "fleet_manager", vehicleScope: "all" };
    expect(await an.getFlags(d, o)).toEqual([]);
    expect((await an.costOverview(d, o)).total).toBe(0);
    expect(await ct.listBudgets(d, o)).toEqual([]);
  });
});

describe("settings", () => {
  it("checks each value and cleans the reminder list", async () => {
    const e = await ct.saveSettings(d, mgr(), { flag_jobs_90d: "abc", flag_repeat_days: "0", flag_cost_multiple: "1.5" }).catch((x) => x);
    expect(e).toBeInstanceOf(UserError);
    expect(Object.keys(e.fields).sort()).toEqual(["flag_jobs_90d", "flag_repeat_days"]);
    expect(await ct.saveSettings(d, mgr(), { flag_repeat_days: "45", flag_cost_multiple: "1.5" })).toBe(2);
    expect(await ct.saveSettings(d, mgr(), { flag_repeat_days: "45" })).toBe(0);                // unchanged: nothing written
    await ct.saveSettings(d, owner(), { doc_reminder_days: "14, 60,30,60" });
    expect((await ct.getSettings(d, owner())).find((s) => s.key === "doc_reminder_days")!.value).toBe("60,30,14");
    await expect(ct.saveSettings(d, owner(), { doc_reminder_days: "60;30" })).rejects.toBeInstanceOf(UserError);
    await ct.saveSettings(d, mgr(), { flag_repeat_days: "60", flag_cost_multiple: "2.0" });
  });
  it("each key needs its own permission, even when sent together", async () => {
    await expect(ct.saveSettings(d, mgr(), { flag_jobs_90d: "4", doc_reminder_days: "10" })).rejects.toBeInstanceOf(ForbiddenError);   // fleet managers cannot change reminder days
    expect((await ct.getSettings(d, mgr())).find((s) => s.key === "flag_jobs_90d")!.value).toBe("3");                                // and nothing was half-saved
    const v = await ct.getSettings(d, mgr());
    expect(v.find((s) => s.key === "doc_reminder_days")!.editable).toBe(false);
    expect(v.find((s) => s.key === "flag_jobs_90d")!.editable).toBe(true);
    await expect(ct.saveSettings(d, mem("auditor", 15), { flag_jobs_90d: "9" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ct.saveSettings(d, mem("requester", 11), { flag_jobs_90d: "9" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ct.saveSettings(d, mgr(), { made_up: "1" })).rejects.toThrow(/Unknown setting/);
  });
  it("the warning level cannot be above the over-limit level", async () => {
    await expect(ct.saveSettings(d, mgr(), { budget_warn_pct: "120" })).rejects.toThrow(/must not be above/);
    await expect(ct.saveSettings(d, mgr(), { budget_warn_pct: "60", budget_flag_pct: "50" })).rejects.toThrow(/must not be above/);
    expect((await ct.getSettings(d, mgr())).find((s) => s.key === "budget_warn_pct")!.value).toBe("80");
  });
});

describe("service rules", () => {
  it("adds a rule with a key from its name, edits it, and limits it to some vehicle classes", async () => {
    const trucks = (await master.addVehicle(d, owner(), { registration_no: "TRK-1", vehicle_class: "truck" })).id;
    const key = await ct.saveServiceRule(d, mgr(), { label: "Grease the chassis", is_preventive: true, interval_months: "1", applies_to_classes: ["truck"], active: true });
    expect(key).toBe("grease_the_chassis");
    const plates = async () => (await raw(async (q) => (await q.query<{ registration_no: string }>("select registration_no from v_pm_status where service_type_key = $1 order by 1", [key])).rows)).map((r) => r.registration_no);
    expect(await plates()).toEqual(["TRK-1"]);
    await ct.saveServiceRule(d, mgr(), { key, label: "Grease the chassis", is_preventive: true, interval_months: "1", applies_to_classes: ["truck", "pickup"], active: true });
    expect((await plates()).length).toBeGreaterThan(1);
    await ct.saveServiceRule(d, mgr(), { key, label: "Chassis grease", is_preventive: true, interval_months: "2", active: false });
    expect((await ct.listServiceRules(d, mgr())).find((r) => r.key === key)).toMatchObject({ label: "Chassis grease", interval_months: 2, active: false, applies_to_classes: null });
    expect(await plates()).toEqual([]);                                                          // inactive rules drop out of due lists
    expect(trucks).toBeTruthy();
  });
  it("needs an interval, a unique name and the right permission", async () => {
    expect((await ct.saveServiceRule(d, mgr(), { label: "No interval", is_preventive: true, active: true }).catch((x) => x)).fields.interval_months).toBeTruthy();
    await ct.saveServiceRule(d, mgr(), { label: "Tyre rotation", is_preventive: true, interval_km: "10000", active: true });
    await expect(ct.saveServiceRule(d, mgr(), { label: "tyre  rotation", is_preventive: true, interval_km: "5000", active: true })).rejects.toThrow(/already exists/);
    await expect(ct.saveServiceRule(d, mem("finance", 14), { label: "Finance rule", is_preventive: true, interval_km: "5000", active: true })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ct.saveServiceRule(d, mgr(), { key: "nope_nope", label: "Missing", is_preventive: true, interval_km: "5000", active: true })).rejects.toThrow(/not found/);
  });
});
