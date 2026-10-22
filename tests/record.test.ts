import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { getVehicleRecord } from "@/lib/master/record";
import { seedDemo } from "@/lib/demo/seed";

let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const U = "00000000-0000-0000-0000-0000000000aa";
const mem = (role: string, vehicleScope: "all" | "own" = "all", userId = U): Membership => ({ ...t, userId, role, vehicleScope });
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, mem("tenant_admin"), fn);
const idOf = (plate: string) => raw(async (q) => (await q.query<{ id: string }>("select id from vehicles where registration_no = $1", [plate])).rows[0].id);
const rec = async (plate: string, m = mem("fleet_manager")) => (await getVehicleRecord(d, m, await idOf(plate)))!;

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Demo Workspace", slug: "demo" }, tenantMigrations(), { transform: stripExt });
  await seedDemo(d, t);
});

describe("vehicle record", () => {
  it("header, holder and servicing", async () => {
    const r = await rec("BKL-245");
    expect(r).toMatchObject({ registration_no: "BKL-245", make: "Isuzu", model: "D-Max", year: 2021, vehicle_class: "pickup", odometer_km: 48210 });
    expect(r.holder).toMatchObject({ name: "Imran Ali", department: "Logistics" });
    expect(r.services.length).toBeGreaterThan(0);
    expect(r.nextService).toEqual(r.services[0]);
    expect(r.lastService).toMatchObject({ label: "Oil change" });
    expect(r.sinceServiceKm).toBe(3000);                                  // seeded 3,000 km after the last oil change
    expect(r.serviceRuleText).toMatch(/every 3 months/);
  });

  it("budget, spending and repeat repairs on the vehicle that has a budget", async () => {
    const r = await rec("BKL-302");
    expect(r.budget).toBe(60000);
    expect(r.period.fromBudget).toBe(true);
    expect(r.spend).toBeGreaterThan(30000);
    expect(r.pct).toBeCloseTo((r.spend / 60000) * 100, 0);
    expect(r.repeats.count).toBe(1);
    expect(r.repeats.text).toBe("Brake wear twice in 58 days");
    const repeatJobs = r.jobs.filter((j) => j.repeat);
    expect(repeatJobs).toHaveLength(1);
    expect(repeatJobs[0].reason).toBe("Brake wear");
    expect(r.jobs[0].created_at >= r.jobs.at(-1)!.created_at).toBe(true);   // newest first
    expect(r.jobs.every((j) => j.status !== "draft" && j.status !== "cancelled")).toBe(true);
    expect(r.reasons.reduce((s, x) => s + x.cost, 0)).toBe(r.spend);        // the breakdown adds up to the spend
  });

  it("finds the day a budget ran out", async () => {
    const id = await idOf("BKL-300");
    await raw((q) => q.query("insert into budgets(vehicle_id, period_start, period_end, amount) values ($1, date_trunc('year', now())::date, (date_trunc('year', now()) + interval '1 year - 1 day')::date, 20000)", [id]));
    const r = await rec("BKL-300");
    expect(r.budget).toBe(20000);
    expect(r.pct).toBeGreaterThan(100);
    expect(r.budgetUsedUpOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const tyreJob = r.jobs.find((j) => j.reason === "Tyre wear")!;
    expect(r.budgetUsedUpOn).toBe(tyreJob.created_at.slice(0, 10));
    expect(r.monthsRemaining).toBeGreaterThanOrEqual(0);
    const none = await rec("BKL-301");
    expect(none.budget).toBeNull();                                         // falls back to the calendar year, no used-up date
    expect(none.budgetUsedUpOn).toBeNull();
    expect(none.period.fromBudget).toBe(false);
  });

  it("holders carry the cost of the jobs raised while they held the vehicle", async () => {
    const id = await idOf("BKL-245");
    const emp = await raw(async (q) => (await q.query<{ id: string }>("select id from employees where employee_no = 'E-105'")).rows[0].id);
    // an earlier holder, with a job card dated in that period
    await raw(async (q) => {
      await q.query("update vehicle_custody set from_date = current_date - 30 where vehicle_id = $1 and to_date is null", [id]);
      await q.query("insert into vehicle_custody(vehicle_id, employee_id, from_date, to_date) values ($1, $2, current_date - 400, current_date - 31)", [id, emp]);
    });
    const r = await rec("BKL-245");
    expect(r.holders.map((h) => h.name)).toEqual(["Imran Ali", "Farah Naz"]);       // newest first
    expect(r.holders[0].to_date).toBeNull();
    expect(r.holders.reduce((s, h) => s + h.cost, 0)).toBeLessThanOrEqual(r.jobs.reduce((s, j) => s + j.cost, 0));
  });

  it("documents and odometer history", async () => {
    const r = await rec("BKL-300");
    expect(r.docs.some((x) => x.doc_type === "token_tax" && x.doc_status === "expired")).toBe(true);
    expect(r.docs.some((x) => x.doc_type === "insurance")).toBe(true);
    expect(r.readings.length).toBeGreaterThan(0);
    expect(r.readings[0].reading_km).toBe(31200);
  });

  it("job and fleet numbers", async () => {
    const r = await rec("BKL-302");
    expect(r.jobs90).toBe(1);
    expect(r.fleetAvgJobs90).toBeGreaterThan(0);
  });

  it("a person limited to their own vehicle cannot open another one, and others need vehicle.read", async () => {
    const own = "00000000-0000-0000-0000-0000000000d2";
    await raw((q) => q.query("update employees set user_id = $1 where employee_no = 'E-103'", [own]));
    expect(await getVehicleRecord(d, mem("requester", "own", own), await idOf("BKL-301"))).not.toBeNull();   // Hira holds BKL-301
    expect(await getVehicleRecord(d, mem("requester", "own", own), await idOf("BKL-245"))).toBeNull();
    await expect(getVehicleRecord(d, mem("vendor"), await idOf("BKL-245"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("another workspace cannot open it", async () => {
    const other = await provisionTenant(d, { name: "Other", slug: "other" }, tenantMigrations(), { transform: stripExt });
    expect(await getVehicleRecord(d, { ...other, userId: U, role: "fleet_manager", vehicleScope: "all" }, await idOf("BKL-245"))).toBeNull();
  });
});
