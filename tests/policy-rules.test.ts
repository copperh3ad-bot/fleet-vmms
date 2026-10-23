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
import { accidentCover } from "@/lib/compliance/cover";
import { getPolicyImpact } from "@/lib/master/policy-rules";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let a: { tenantId: string; schema: string }, b: { tenantId: string; schema: string };
const mem = (t: { tenantId: string; schema: string }, role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem(a, "tenant_admin", 1);
const mgr = () => mem(a, "fleet_manager", 12);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>, t = a) => withTenant(d, mem(t, "tenant_admin", 1), fn);
const set = (m: Membership, values: Record<string, string>) => ct.saveSettings(d, m, values);

let emp: string, drv1: string, drv2: string, reasons: Record<string, string>;
const car: Record<string, string> = {};
const thisYear = new Date().getUTCFullYear();

async function job(vehicle: string, reason: string, cost: number, driver: string) {
  const { id } = await jc.createJobCard(d, mgr(), { vehicle_id: vehicle, requested_by: emp, reason_code_id: reasons[reason], cause_text: "Worked on during the test run", lines: [{ kind: "service", description: "Work", qty: "1", unit_cost: String(cost) }] }, true);
  await raw((q) => q.query("update job_cards set custodian_id = $2 where id = $1", [id, driver]));
  return id;
}
async function accident(vehicle: string, driver: string, at: string) {
  const id = await cs.addAccident(d, mgr(), { vehicle_id: vehicle, occurred_at: at, description: "Hit a barrier while parking", severity: "minor" });
  await raw((q) => q.query("update accidents set employee_id = $2 where id = $1", [id, driver]));
  return id;
}

beforeAll(async () => {
  d = await testDriver();
  a = await provisionTenant(d, { name: "Alpha Haulage", slug: "alpha", ownerUserId: U(1), ownerName: "Owner A" }, tenantMigrations(), { transform: stripExt });
  b = await provisionTenant(d, { name: "Bravo Transport", slug: "bravo", ownerUserId: U(2), ownerName: "Owner B" }, tenantMigrations(), { transform: stripExt });
  const e = await master.saveEmployee(d, owner(), { full_name: "Manager", employee_no: "E-12" });
  await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(12), e.id]));
  emp = e.id;
  drv1 = (await master.saveEmployee(d, owner(), { full_name: "Driver One", employee_no: "E-21" })).id;
  drv2 = (await master.saveEmployee(d, owner(), { full_name: "Driver Two", employee_no: "E-22" })).id;
  reasons = Object.fromEntries((await raw(async (q) => (await q.query<{ id: string; code: string }>("select id, code from reason_codes")).rows)).map((r) => [r.code, r.id]));
  car.old = (await master.addVehicle(d, owner(), { registration_no: "OLD-1", year: String(thisYear - 8) })).id;
  car.mid = (await master.addVehicle(d, owner(), { registration_no: "MID-1", year: String(thisYear - 3) })).id;
  car.none = (await master.addVehicle(d, owner(), { registration_no: "NOYEAR-1" })).id;
});

describe("every rule starts switched off", () => {
  it("a new company has the rules at 0 and nothing is flagged, judged or charged", async () => {
    const s = await ct.getSettings(d, owner());
    expect(Object.fromEntries(s.filter((x) => x.group === "policy").map((x) => [x.key, x.value]))).toEqual({
      policy_replace_years: "0", policy_free_accidents: "0", policy_accident_gap_months: "12", policy_driver_share_pct: "0" });
    expect((await an.getFlags(d, mgr())).some((f) => f.flag === "replacement_due")).toBe(false);
    await accident(car.mid, drv1, "2026-01-10T10:00");
    expect((await cs.listAccidents(d, mgr())).every((x) => x.cover === null)).toBe(true);
    expect(await getPolicyImpact(d, mgr())).toMatchObject({ replaceYears: 0, replaceDue: [], freeAccidents: 0, sharePct: 0, shares: null });
  });
});

describe("the rules are the company's to set", () => {
  it("managers and admins save them; anyone else is refused, and bad numbers say which field", async () => {
    await expect(set(mem(a, "requester", 4), { policy_replace_years: "5" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(set(mem(a, "finance", 5), { policy_replace_years: "5" })).rejects.toBeInstanceOf(ForbiddenError);
    const e = await set(mgr(), { policy_driver_share_pct: "150", policy_replace_years: "abc" }).catch((x) => x as UserError);
    expect(Object.keys((e as UserError).fields ?? {}).sort()).toEqual(["policy_driver_share_pct", "policy_replace_years"]);
    expect(await set(mgr(), { policy_replace_years: "6" })).toBe(1);
  });

  it("the database refuses a share above 100 percent even if the form check is skipped", async () => {
    await expect(raw((q) => q.query("update settings set value = '101' where key = 'policy_driver_share_pct'"))).rejects.toThrow(/cannot be above 100/);
  });

  it("one company's settings never change another's", async () => {
    expect((await ct.getSettings(d, mem(b, "tenant_admin", 2))).find((x) => x.key === "policy_replace_years")?.value).toBe("0");
    await set(mem(b, "tenant_admin", 2), { policy_replace_years: "10" });
    expect((await ct.getSettings(d, owner())).find((x) => x.key === "policy_replace_years")?.value).toBe("6");
  });
});

describe("replacement age", () => {
  it("flags vehicles at or past the age, ignores newer ones and ones with no model year, and follows the setting", async () => {
    const flagged = async () => (await an.getFlags(d, mgr())).filter((f) => f.flag === "replacement_due").map((f) => f.registration_no);
    expect(await flagged()).toEqual(["OLD-1"]);                       // 8 years old, policy 6
    expect((await an.getFlags(d, mgr())).find((f) => f.flag === "replacement_due")?.detail).toMatch(/8 years old.*replaces at 6/);
    await set(mgr(), { policy_replace_years: "3" });
    expect((await flagged()).sort()).toEqual(["MID-1", "OLD-1"]);
    await set(mgr(), { policy_replace_years: "0" });
    expect(await flagged()).toEqual([]);
    await set(mgr(), { policy_replace_years: "6" });
  });
});

describe("accident cover", () => {
  const A = (id: string, employee_id: string | null, occurred_at: string) => ({ id, employee_id, occurred_at });

  it("covers a driver's first accidents when enough months have passed, and not after", () => {
    const h = [A("1", "x", "2025-01-10T00:00:00Z"), A("2", "x", "2025-03-01T00:00:00Z"), A("3", "x", "2026-04-01T00:00:00Z"), A("4", "y", "2025-06-01T00:00:00Z"), A("5", null, "2025-06-01T00:00:00Z")];
    const c = accidentCover(h, 2, 12);
    expect(c.get("1")).toEqual({ cover: "covered", nth: 1 });
    expect(c.get("2")).toEqual({ cover: "driver_pays", nth: 2 });     // only 2 months after the first
    expect(c.get("3")).toEqual({ cover: "driver_pays", nth: 3 });     // beyond the free number
    expect(c.get("4")).toEqual({ cover: "covered", nth: 1 });         // each driver counted on their own
    expect(c.has("5")).toBe(false);                                   // no driver, no judgement
    expect(accidentCover(h, 0, 12).size).toBe(0);                     // rule off
    expect(accidentCover(h, 2, 0).get("2")).toEqual({ cover: "covered", nth: 2 });   // no waiting period
  });

  it("shows on the real accident list and detail once the company sets the rule", async () => {
    await raw((q) => q.query("delete from accidents where true"));
    const x1 = await accident(car.mid, drv1, "2026-01-10T10:00");
    const x2 = await accident(car.mid, drv1, "2026-06-10T10:00");
    const y1 = await accident(car.old, drv2, "2026-02-10T10:00");
    await set(mgr(), { policy_free_accidents: "2", policy_accident_gap_months: "12" });
    const rows = new Map((await cs.listAccidents(d, mgr())).map((r) => [r.id, r.cover]));
    expect(rows.get(x1)).toMatchObject({ cover: "covered", nth: 1, free: 2 });
    expect(rows.get(x2)).toMatchObject({ cover: "driver_pays", nth: 2 });
    expect(rows.get(y1)).toMatchObject({ cover: "covered", nth: 1 });
    expect((await cs.getAccident(d, mgr(), x2))?.cover).toMatchObject({ cover: "driver_pays" });
    await set(mgr(), { policy_accident_gap_months: "3" });
    expect((await cs.getAccident(d, mgr(), x2))?.cover).toMatchObject({ cover: "covered", nth: 2 });
    expect((await getPolicyImpact(d, mgr())).freeAccidents).toBe(2);
  });
});

describe("the driver's share of repairs", () => {
  it("counts repairs only, not routine service, wear items or accident repairs, and splits by driver", async () => {
    await raw(async (q) => { for (const t of ["invoices", "work_orders", "quotations", "job_cards"]) await q.query(`delete from ${t} where true`); });
    await job(car.mid, "DEFECT_PART", 1000, drv1);
    await job(car.mid, "MISUSE_OVERLOAD", 500, drv1);
    await job(car.mid, "SVC_ROUTINE", 300, drv1);          // routine service: company pays
    await job(car.mid, "WEAR_TYRES", 700, drv1);           // wear item: company pays
    await job(car.mid, "ACC_COLLISION", 900, drv1);        // accident: handled by the accident rule
    await job(car.old, "DEFECT_PART", 200, drv2);
    expect((await getPolicyImpact(d, mgr())).shares).toBeNull();                       // rule off: nothing computed
    await set(mgr(), { policy_driver_share_pct: "40" });
    const impact = await getPolicyImpact(d, mgr());
    expect(impact.sharePct).toBe(40);
    expect(impact.shares).toEqual([{ driver: "Driver One", jobs: 2, cost: 1500, share: 600 }, { driver: "Driver Two", jobs: 1, cost: 200, share: 80 }]);
  });

  it("people without access to money see the rule but not the figures", async () => {
    const asRequester = await getPolicyImpact(d, mem(a, "requester", 4));
    expect(asRequester.sharePct).toBe(40);
    expect(asRequester.shares).toBeNull();
    await expect(getPolicyImpact(d, mem(a, "vendor", 6))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("another company sees none of these figures", async () => {
    const other = await getPolicyImpact(d, mem(b, "tenant_admin", 2));
    expect(JSON.stringify(other)).not.toContain("Driver One");
    expect(other.sharePct).toBe(0);
    expect(other.replaceDue).toEqual([]);
  });
});
