import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import * as lic from "@/lib/compliance/licences";
import * as fu from "@/lib/analytics/fleet-use";
import { exportCsv } from "@/lib/exports/service";
import { runDocumentReminders } from "@/lib/compliance/reminders";

// ADR-044: driving licences, cost per kilometre, time in the workshop.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const mgr = () => mem("fleet_manager", 12);
const requester = () => mem("requester", 11);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);
const day = (offset: number, from = new Date()) => new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + offset)).toISOString().slice(0, 10);

let emps: Record<number, string>;
let reasonId: string;

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  emps = {};
  for (const [n, name] of [[11, "Driver One"], [12, "Manager One"], [14, "Driver Three"]] as const) {
    emps[n] = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` })).id;
    await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), emps[n]]));
  }
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[11, "requester"], [12, "fleet_manager"], [14, "requester"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  reasonId = (await raw(async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'WEAR_BRAKES'")).rows[0].id));
});

const L = (extra: Record<string, unknown> = {}) => ({ licence_no: "LHR-5678-9012", licence_class: "LTV", expires_on: day(400), ...extra });

describe("driving licences", () => {
  it("saves one licence per employee in place, and checks the fields", async () => {
    const bad = await lic.saveLicence(d, mgr(), emps[11], { licence_no: "x", expires_on: "" }).catch((e) => e);
    expect(bad).toBeInstanceOf(UserError);
    expect(Object.keys(bad.fields).sort()).toEqual(["expires_on", "licence_no"]);
    const early = await lic.saveLicence(d, mgr(), emps[11], L({ issued_on: day(10), expires_on: day(5) })).catch((e) => e);
    expect(early.fields.expires_on).toMatch(/before the issue date/);
    await lic.saveLicence(d, mgr(), emps[11], L({ emergency_contact_name: "Brother", emergency_contact_phone: "0300 1234567" }));
    await lic.saveLicence(d, mgr(), emps[11], L({ licence_class: "HTV" }));                 // changed in place, not added
    const all = await lic.listLicences(d, mgr());
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ employee_id: emps[11], licence_no: "LHR-5678-9012", licence_class: "HTV" });
    expect((await lic.saveLicence(d, mgr(), "00000000-0000-0000-0000-0000000000ff", L()).catch((e) => e)).message).toMatch(/not found/);
  });

  it("is for people who manage employees or compliance, nobody else", async () => {
    await expect(lic.listLicences(d, requester())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(lic.saveLicence(d, requester(), emps[11], L())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(lic.removeLicence(d, requester(), emps[11])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(lic.listExpiringLicences(d, requester())).rejects.toBeInstanceOf(ForbiddenError);
    expect(await lic.listLicences(d, owner())).toHaveLength(1);
  });

  it("lists expired and soon-to-expire licences of active employees, with the number masked", async () => {
    await lic.saveLicence(d, mgr(), emps[12], L({ licence_no: "KHI-1111-2222", expires_on: day(-3) }));
    await lic.saveLicence(d, mgr(), emps[14], L({ licence_no: "ISB-3333-4444", expires_on: day(60) }));
    const rows = await lic.listExpiringLicences(d, mgr());
    expect(rows.map((r) => [r.full_name, r.status])).toEqual([["Manager One", "expired"], ["Driver Three", "due_90"]]);   // Driver One expires in 400 days
    expect(rows[0].licence_masked).toBe("…2222");
    expect(JSON.stringify(rows)).not.toContain("KHI-1111");
    await raw((q) => q.query("update employees set active = false where id = $1", [emps[12]]));
    expect((await lic.listExpiringLicences(d, mgr())).map((r) => r.full_name)).toEqual(["Driver Three"]);
    await raw((q) => q.query("update employees set active = true where id = $1", [emps[12]]));
    expect(lic.maskLicence("AB")).toBe("…AB");
  });

  it("never keeps the whole number in the audit trail", async () => {
    await lic.saveLicence(d, mgr(), emps[11], L({ licence_no: "SECRETNO-90210", emergency_contact_phone: "0300 7654321" }));
    const rows = await raw(async (q) => (await q.query<{ action: string; new_data: Record<string, unknown> | null; old_data: Record<string, unknown> | null }>(
      "select action, new_data, old_data from audit_log where table_name = 'driver_licences' order by at, id")).rows);
    expect(rows.length).toBeGreaterThan(0);
    const text = JSON.stringify(rows);
    expect(text).not.toContain("SECRETNO");
    expect(text).not.toContain("7654321");
    expect(rows[rows.length - 1].new_data?.licence_no).toBe("…0210");
  });

  describe("reminders", () => {
    const TODAY = "2032-05-01";
    const at = (n: number) => day(n, new Date(`${TODAY}T00:00:00Z`));
    const notes = (user: number, emp: string) => raw(async (q) => (await q.query<{ kind: string; payload: Record<string, unknown> }>(
      "select kind, payload from notifications where user_id = $1 and kind like 'licence.%' and payload->>'employee_id' = $2 order by created_at, id", [U(user), emp])).rows);
    const run = (today: string) => runDocumentReminders(d, today);

    it("sends each threshold once, to the managers and the driver, with no licence number in the notice", async () => {
      await lic.saveLicence(d, mgr(), emps[11], L({ expires_on: at(20) }));
      await run(TODAY);
      expect((await notes(12, emps[11])).map((n) => n.kind)).toEqual(["licence.expiring"]);
      expect((await notes(11, emps[11])).map((n) => n.kind)).toEqual(["licence.expiring"]);       // the driver is told too
      const first = (await notes(12, emps[11]))[0];
      expect(first.payload.days_left).toBe(20);
      expect(String(first.payload.text)).toBe("Driver One's driving licence expires in 20 days");
      expect(JSON.stringify(first.payload)).not.toMatch(/SECRETNO|LHR/);
      await run(TODAY); await run(at(3));                                                           // same day, a few days later: nothing new
      expect(await notes(12, emps[11])).toHaveLength(1);
      await run(at(8));                                                                             // 12 days left: crosses 14
      expect((await notes(12, emps[11])).map((n) => n.payload.days_left)).toEqual([20, 12]);
      await run(at(21)); await run(at(30));                                                         // expired: one notice, not one a day
      expect((await notes(12, emps[11])).map((n) => n.kind)).toEqual(["licence.expiring", "licence.expiring", "licence.expired"]);
    });

    it("starts again when the licence is renewed with a later expiry", async () => {
      await lic.saveLicence(d, mgr(), emps[11], L({ expires_on: at(300) }));
      expect(await raw(async (q) => (await q.query("select 1 from document_reminders where entity_type = 'driver_licence' and entity_id = (select id from driver_licences where employee_id = $1)", [emps[11]])).rows)).toHaveLength(0);
      const before = (await notes(12, emps[11])).length;
      await run(at(290));                                                                            // 10 days left
      expect((await notes(12, emps[11])).length).toBe(before + 1);
    });

    it("says nothing about an employee who is no longer active", async () => {
      const before = (await notes(12, emps[14])).length;                                            // earlier runs may already have told them about the old expiry
      await lic.saveLicence(d, mgr(), emps[14], L({ expires_on: at(5) }));
      await raw((q) => q.query("update employees set active = false where id = $1", [emps[14]]));
      await run(TODAY);
      expect(await notes(12, emps[14])).toHaveLength(before);
    });
  });

  it("removes a licence", async () => {
    await lic.removeLicence(d, mgr(), emps[14]);
    expect((await lic.listLicences(d, mgr())).some((l) => l.employee_id === emps[14])).toBe(false);
  });
});

describe("cost per kilometre", () => {
  const reading = (vehicle: string, km: number, daysAgo: number, status = "accepted") => raw((q) => q.query(
    "insert into odometer_readings(vehicle_id, reading_km, read_at, source, status) values ($1,$2, now() - ($3 || ' days')::interval, 'manual', $4)", [vehicle, km, String(daysAgo), status]));
  const cost = async (vehicle: string, amount: number, daysAgo = 5) => {
    const { id } = await jc.createJobCard(d, mgr(), { vehicle_id: vehicle, requested_by: emps[12], reason_code_id: reasonId, cause_text: "Worked on during the test run", lines: [{ kind: "service", description: "Work", qty: "1", unit_cost: String(amount) }] }, true);
    await raw((q) => q.query("update job_cards set created_at = now() - ($2 || ' days')::interval where id = $1", [id, String(daysAgo)]));
  };
  const car = async (plate: string) => (await master.addVehicle(d, owner(), { registration_no: plate })).id;
  const rowOf = async (plate: string, months = 12) => (await fu.costPerKm(d, mgr(), months)).rows.find((r) => r.registration_no === plate);

  it("divides the cost by the distance between the reading before the period and the last one in it", async () => {
    const v = await car("KM-1");
    await reading(v, 1000, 500);              // before the 12-month window
    await reading(v, 3000, 60);
    await reading(v, 5000, 1);
    await reading(v, 9999, 0, "flagged");     // a flagged reading is ignored
    await cost(v, 8000);
    expect(await rowOf("KM-1")).toMatchObject({ cost: 8000, km: 4000, per_km: 2, jobs: 1 });
  });

  it("starts from the first reading in the period when there is none before it", async () => {
    const v = await car("KM-2");
    await reading(v, 200, 90); await reading(v, 700, 10);
    await cost(v, 1000);
    expect(await rowOf("KM-2")).toMatchObject({ km: 500, per_km: 2 });
  });

  it("shows no distance, never a made-up one, with fewer than two readings or a backwards odometer", async () => {
    const one = await car("KM-3"); await reading(one, 4000, 20); await cost(one, 500);
    expect(await rowOf("KM-3")).toMatchObject({ cost: 500, km: null, per_km: null });
    const none = await car("KM-4"); await cost(none, 300);
    expect(await rowOf("KM-4")).toMatchObject({ km: null, per_km: null });
    const back = await car("KM-5"); await reading(back, 9000, 400); await reading(back, 8000, 5); await cost(back, 100);
    expect(await rowOf("KM-5")).toMatchObject({ km: null, per_km: null });
    const idle = await car("KM-6"); await reading(idle, 100, 400); await reading(idle, 100, 5); await cost(idle, 100);
    expect(await rowOf("KM-6")).toMatchObject({ km: 0, per_km: null });
  });

  it("leaves out vehicles with no spending and no distance, orders worst first, and totals the fleet", async () => {
    await car("KM-7");
    const r = await fu.costPerKm(d, mgr(), 12);
    expect(r.rows.some((x) => x.registration_no === "KM-7")).toBe(false);
    expect(r.rows[0].registration_no).toBe("KM-1");                               // 2.00 per km is the worst of the figures above
    const withFigure = r.rows.filter((x) => x.per_km !== null).map((x) => x.per_km as number);
    expect([...withFigure].sort((a, b) => b - a)).toEqual(withFigure);
    expect(r.rows.slice(withFigure.length).every((x) => x.per_km === null)).toBe(true);
    expect(r.fleet.per_km).toBeCloseTo(r.fleet.cost / r.fleet.km, 6);
  });

  it("uses only the months asked for, and only report.view", async () => {
    const v = await car("KM-8");                                              // 200 and 150 days ago are inside 12 months; only the 10-day-old reading is inside 3 months
    await reading(v, 1000, 200); await reading(v, 2000, 150); await reading(v, 2600, 10); await cost(v, 600);
    expect(await rowOf("KM-8", 12)).toMatchObject({ km: 1600, per_km: 600 / 1600 });
    expect(await rowOf("KM-8", 3)).toMatchObject({ km: 600, per_km: 1 });        // measured from the last reading before the window
    expect(fu.periodMonths(5)).toBe(12);
    await expect(fu.costPerKm(d, requester(), 12)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("exports the same figures as a CSV", async () => {
    const r = await exportCsv(d, mgr(), "cost-per-km", { months: "12" });
    expect(r.csv).toContain("Cost per km");
    expect(r.csv).toMatch(/KM-1,1,8000\.00,4000\.0,2\.00/);
    expect(r.csv).toMatch(/KM-3,1,500\.00,Not enough readings,/);
    await expect(exportCsv(d, requester(), "cost-per-km")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("time in the workshop", () => {
  const noon = (daysAgo: number) => `((current_date - ${daysAgo})::timestamptz + interval '12 hours')`;
  const setHistory = (vehicle: string, rows: [string, number, number | null][]) => raw(async (q) => {
    await q.query("delete from vehicle_status_history where vehicle_id = $1", [vehicle]);
    for (const [status, from, to] of rows)
      await q.query(`insert into vehicle_status_history(vehicle_id, status, from_at, to_at) values ($1, $2, ${noon(from)}, ${to === null ? "null" : noon(to)})`, [vehicle, status]);
  });
  const car = async (plate: string) => (await master.addVehicle(d, owner(), { registration_no: plate })).id;

  it("records every status change in a trigger, one open row at a time", async () => {
    const v = await car("DT-1");
    const rows = () => raw(async (q) => (await q.query<{ status: string; open: boolean }>("select status, to_at is null as open from vehicle_status_history where vehicle_id = $1 order by from_at, id", [v])).rows);
    expect(await rows()).toEqual([{ status: "active", open: true }]);
    await raw((q) => q.query("update vehicles set status = 'in_workshop' where id = $1", [v]));
    await raw((q) => q.query("update vehicles set status = 'active' where id = $1", [v]));
    await raw((q) => q.query("update vehicles set registration_no = 'DT-1B' where id = $1", [v]));        // not a status change: nothing recorded
    expect(await rows()).toEqual([{ status: "active", open: false }, { status: "in_workshop", open: false }, { status: "active", open: true }]);
  });

  it("is written by the job card flow too, not only by direct updates", async () => {
    const v = await car("DT-2");
    const { id } = await jc.createJobCard(d, mgr(), { vehicle_id: v, requested_by: emps[12], reason_code_id: reasonId, cause_text: "Worked on during the test run", lines: [{ kind: "service", description: "Work", qty: "1", unit_cost: "10" }] }, true);
    const before = await raw(async (q) => (await q.query("select 1 from vehicle_status_history where vehicle_id = $1", [v])).rows.length);
    await raw((q) => q.query("update vehicles set status = 'in_workshop' where id = $1", [v]));
    expect(await raw(async (q) => (await q.query("select 1 from vehicle_status_history where vehicle_id = $1", [v])).rows.length)).toBe(before + 1);
    expect(id).toBeTruthy();
  });

  it("backfills vehicles that existed before, and running the migration again changes nothing", async () => {
    const v = await car("DT-3");
    await raw((q) => q.query("delete from vehicle_status_history where vehicle_id = $1", [v]));
    const sql = tenantMigrations().find((m) => m.name.startsWith("0027"))!.sql;
    await raw((q) => q.query(sql));
    await raw((q) => q.query(sql));
    const rows = await raw(async (q) => (await q.query<{ status: string; same: boolean }>(
      "select h.status, h.from_at = v.created_at as same from vehicle_status_history h join vehicles v on v.id = h.vehicle_id where h.vehicle_id = $1", [v])).rows);
    expect(rows).toEqual([{ status: "active", same: true }]);
  });

  it("counts workshop days, visits, the longest visit and availability", async () => {
    const v = await car("DT-4");
    await setHistory(v, [["active", 40, 30], ["in_workshop", 30, 25], ["active", 25, 10], ["in_workshop", 10, 9], ["active", 9, null]]);
    const r = await fu.downtime(d, mgr(), 12);
    const row = r.rows.find((x) => x.registration_no === "DT-4")!;
    expect(row).toMatchObject({ workshop_days: 8, visits: 2, longest_days: 6, days: 41 });         // days -30..-25 and -10..-9; 41 days since first seen
    expect(row.availability).toBeCloseTo(1 - 8 / 41, 6);
    expect(r.fleet.workshop_days).toBeGreaterThanOrEqual(8);
  });

  it("counts a visit still open today, and cuts a visit at the start of the period", async () => {
    const open = await car("DT-5");
    await setHistory(open, [["active", 20, 3], ["in_workshop", 3, null]]);
    expect((await fu.downtime(d, mgr(), 12)).rows.find((x) => x.registration_no === "DT-5")).toMatchObject({ workshop_days: 4, visits: 1, longest_days: 4 });   // -3..today
    const old = await car("DT-6");
    await setHistory(old, [["in_workshop", 800, 5], ["active", 5, null]]);
    const r = (await fu.downtime(d, mgr(), 3)).rows.find((x) => x.registration_no === "DT-6")!;
    expect(r.visits).toBe(1);
    expect(r.workshop_days).toBeLessThan(120);                                                        // not the 795 days the visit really lasted
    expect(r.workshop_days).toBeGreaterThan(60);
  });

  it("does not count a disposed vehicle's days as available time, and omits vehicles that never visited", async () => {
    const v = await car("DT-7");
    await setHistory(v, [["active", 30, 20], ["in_workshop", 20, 18], ["disposed", 18, null]]);
    const row = (await fu.downtime(d, mgr(), 12)).rows.find((x) => x.registration_no === "DT-7")!;
    expect(row).toMatchObject({ workshop_days: 3, days: 13 });                                      // -30..-18, disposed days left out
    await car("DT-8");
    expect((await fu.downtime(d, mgr(), 12)).rows.some((x) => x.registration_no === "DT-8")).toBe(false);
  });

  it("is for report.view only and exports as a CSV", async () => {
    await expect(fu.downtime(d, requester(), 12)).rejects.toBeInstanceOf(ForbiddenError);
    const r = await exportCsv(d, mgr(), "workshop-time", { months: "12" });
    expect(r.csv).toContain("Days in the workshop");
    expect(r.csv).toMatch(/DT-4,8,2,6,41,80\.5/);
    await expect(exportCsv(d, requester(), "workshop-time")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
