import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { breakingReport } from "@/lib/analytics/breaking";
import { seedDemo } from "@/lib/demo/seed";

let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string): Membership => ({ ...t, userId: "00000000-0000-0000-0000-0000000000aa", role, vehicleScope: "all" });
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, mem("tenant_admin"), fn);

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Demo Workspace", slug: "demo" }, tenantMigrations(), { transform: stripExt });
  await seedDemo(d, t);
});

describe("why it keeps breaking", () => {
  it("counts jobs and spend for the period, and the dates it covers", async () => {
    const r = await breakingReport(d, mem("auditor"), { days: 365 });
    expect(r.jobs).toBeGreaterThanOrEqual(9);
    expect(r.cost).toBeGreaterThan(100000);
    expect(r.days).toBe(365);
    expect(r.to >= r.from).toBe(true);
    const short = await breakingReport(d, mem("auditor"), { days: 30 });
    expect(short.jobs).toBeLessThan(r.jobs);
    expect((await breakingReport(d, mem("auditor"), { days: 7 })).days).toBe(90);              // odd values fall back
  });

  it("data quality: share of 'other', short notes, jobs without a reason", async () => {
    const r = await breakingReport(d, mem("auditor"), { days: 365 });
    expect(r.quality.otherPct).toBeGreaterThan(0);                                              // the AC job is tagged "other"
    expect(r.quality.otherOk).toBe(r.quality.otherPct < 10);
    expect(r.quality.noReason).toBe(0);
    await raw((q) => q.query("update job_cards set cause_text = 'tyre bad now' where id = (select id from job_cards order by created_at limit 1)"));
    expect((await breakingReport(d, mem("auditor"), { days: 365 })).quality.shortNotes).toBeGreaterThanOrEqual(1);
  });

  it("jobs by reason add up, share and running total end at 100, and the notes read right", async () => {
    const r = await breakingReport(d, mem("auditor"), { days: 365 });
    expect(r.reasons.reduce((s, x) => s + x.jobs, 0)).toBe(r.jobs);
    expect(r.reasons.reduce((s, x) => s + x.cost, 0)).toBeCloseTo(r.cost, 0);
    expect(r.reasons.at(-1)!.running).toBe(100);
    expect(r.reasons[0].jobs).toBeGreaterThanOrEqual(r.reasons.at(-1)!.jobs);                  // most common first
    for (let i = 1; i < r.reasons.length; i++) expect(r.reasons[i].running).toBeGreaterThanOrEqual(r.reasons[i - 1].running);
    expect(r.reasonNote!.top).toBe(r.reasons[0].category);
  });

  it("repeat repairs: same vehicle and reason, how many times, the closest gap, what it cost", async () => {
    const r = await breakingReport(d, mem("auditor"), { days: 365 });
    const brakes = r.repeats.rows.find((x) => x.registration_no === "BKL-302")!;
    expect(brakes).toMatchObject({ reason: "Brake wear", times: 2 });
    expect(brakes.gapDays).toBe(58);
    expect(brakes.cost).toBeGreaterThan(30000);
    expect(r.repeats.jobs).toBe(r.repeats.rows.reduce((s, x) => s + x.times, 0));
    expect(r.repeats.rows.some((x) => x.reason.toLowerCase().includes("scheduled") || x.reason.toLowerCase().includes("routine"))).toBe(false);   // routine service is expected to repeat
  });

  it("groups by driver, vehicle or workshop, and the same cost adds up each way", async () => {
    const by = async (g: string) => (await breakingReport(d, mem("auditor"), { days: 365, group: g }));
    const driver = await by("driver"), vehicle = await by("vehicle"), shop = await by("workshop");
    expect(driver.group).toBe("driver"); expect(vehicle.group).toBe("vehicle"); expect(shop.group).toBe("workshop");
    expect(driver.groups.length).toBeGreaterThan(0);
    expect(driver.groups[0]).toHaveProperty("vehicle");
    expect(vehicle.groups[0].cost).toBeGreaterThanOrEqual(vehicle.groups.at(-1)!.cost);         // costliest first
    expect(vehicle.groups.reduce((s, g) => s + g.cost, 0)).toBeLessThanOrEqual(vehicle.cost + 1);
    expect(shop.groups.some((g) => g.label === "Al-Noor Auto Works")).toBe(true);
    expect(shop.groups.some((g) => g.label === "No workshop")).toBe(true);                       // jobs not yet assigned
    expect((await by("nonsense")).group).toBe("driver");
  });

  it("jobs per 10,000 km come from accepted readings while the person held the vehicle", async () => {
    const id = await raw(async (q) => (await q.query<{ id: string }>("select id from vehicles where registration_no = 'BKL-300'")).rows[0].id);
    await raw(async (q) => {
      await q.query("insert into odometer_readings(vehicle_id, reading_km, source, read_at) values ($1, 31200, 'manual', now() - interval '60 days')", [id]);
      await q.query("insert into odometer_readings(vehicle_id, reading_km, source, read_at) values ($1, 36200, 'manual', now() - interval '5 days')", [id]);
    });
    const r = await breakingReport(d, mem("auditor"), { days: 90, group: "vehicle" });
    const row = r.groups.find((g) => g.label === "BKL-300")!;
    expect(row.per10k).not.toBeNull();
    expect(row.per10k).toBeCloseTo((row.jobs / 5000) * 10000, 0);
  });

  it("misuse jobs are counted per driver", async () => {
    const id = await raw(async (q) => (await q.query<{ id: string }>("select id from job_cards where status = 'submitted' limit 1")).rows[0].id);
    await raw((q) => q.query("update job_cards set reason_code_id = (select id from reason_codes where code = 'MISUSE_OVERLOAD') where id = $1", [id]));
    const r = await breakingReport(d, mem("auditor"), { days: 365, group: "driver" });
    expect(r.groups.reduce((s, g) => s + g.misuse, 0)).toBeGreaterThanOrEqual(1);
  });

  it("what drivers wrote is grouped by keyword, with quotes that name the vehicle", async () => {
    const r = await breakingReport(d, mem("auditor"), { days: 365 });
    expect(r.keywords.length).toBeGreaterThan(0);
    expect(r.keywords[0].count).toBeGreaterThanOrEqual(r.keywords.at(-1)!.count);
    expect(r.keywords.map((k) => k.label)).toContain("Brakes");
    expect(r.quotes.length).toBeLessThanOrEqual(4);
    expect(r.quotes.every((x) => x.text.length >= 25 && /^[A-Z]{3}-\d{3}$/.test(x.registration_no))).toBe(true);
  });

  it("needs report.view, and another workspace sees nothing", async () => {
    for (const role of ["requester", "vendor"]) await expect(breakingReport(d, mem(role))).rejects.toBeInstanceOf(ForbiddenError);
    const other = await provisionTenant(d, { name: "Other", slug: "other" }, tenantMigrations(), { transform: stripExt });
    const r = await breakingReport(d, { ...other, userId: "00000000-0000-0000-0000-0000000000bb", role: "fleet_manager", vehicleScope: "all" });
    expect(r).toMatchObject({ jobs: 0, cost: 0, reasons: [], groups: [], keywords: [], reasonNote: null });
    expect(r.repeats.rows).toEqual([]);
    expect(r.quality.otherPct).toBe(0);
  });
});
