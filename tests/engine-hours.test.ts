import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import * as ctl from "@/lib/control/service";
import * as hrs from "@/lib/hours/service";
import * as fu from "@/lib/analytics/fleet-use";
import { exportCsv } from "@/lib/exports/service";
import { getVehicleRecord } from "@/lib/master/record";

// ADR-048 phase 48b: engine hours. A vehicle with an hour meter has readings, hour-based service rules, and a cost per hour.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const mgr = () => mem("fleet_manager", 12);
const log = () => mem("logistics", 20);
const req = () => mem("requester", 11);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);

let emps: Record<number, string>;
let reasonId: string;
let fork: string, opsFork: string, plain: string;
const hoursAgo = (vehicle: string, h: number, daysAgo: number, status = "accepted") => raw((q) => q.query(
  "insert into engine_hour_readings(vehicle_id, reading_hours, read_at, source, status) values ($1,$2, now() - ($3 || ' days')::interval, 'manual', $4)", [vehicle, h, String(daysAgo), status]));
const age = (vehicle: string, days: number) => raw((q) => q.query("update engine_hour_readings set read_at = read_at - ($2 || ' days')::interval where vehicle_id = $1", [vehicle, String(days)]));   // the meter ran over days, not minutes
const onVehicle = (id: string) => raw(async (q) => (await q.query<{ h: string | null }>("select engine_hours::text h from vehicles where id = $1", [id])).rows[0].h);
const card = (vehicle: string, extra: Record<string, unknown> = {}) => ({ vehicle_id: vehicle, requested_by: emps[12], reason_code_id: reasonId, cause_text: "Worked on during the test run", lines: [{ kind: "service", description: "Work", qty: "1", unit_cost: "100" }], ...extra });

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  emps = {};
  for (const [n, name, dept] of [[11, "Requester One", "Sales"], [12, "Manager One", null], [20, "Logistics One", "Logistics"]] as const) {
    emps[n] = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}`, department: dept ?? undefined })).id;
    await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), emps[n]]));
  }
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[11, "requester"], [12, "fleet_manager"], [20, "logistics"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  fork = (await master.addVehicle(d, owner(), { registration_no: "FRK-1", make: "Komatsu", model: "FD25", vehicle_class: "forklift" })).id;
  opsFork = (await master.addVehicle(d, owner(), { registration_no: "OPS-FRK-1", make: "Komatsu", model: "FD30", vehicle_class: "forklift" })).id;
  plain = (await master.addVehicle(d, owner(), { registration_no: "CAR-1", make: "Toyota", model: "Corolla", vehicle_class: "car" })).id;
  await master.setVehicleDepartment(d, owner(), fork, "Logistics");
  await master.setVehicleDepartment(d, owner(), opsFork, "Operations");
  reasonId = await raw(async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'WEAR_BRAKES'")).rows[0].id);
  await withTenant(d, owner(), (q) => q.query("update role_departments set sees_all_vehicles = false where role_key = 'logistics'"));   // these tests cover a department role limited to its own department; Logistics sees the whole fleet by default (ADR-075, tests/dept-whole-fleet.test.ts)
});

describe("hour tracking and readings", () => {
  it("is switched on per vehicle by people who manage vehicles, and logistics only on its own", async () => {
    await expect(hrs.setTracksHours(d, req(), fork, true)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(hrs.recordEngineHours(d, req(), fork, "10")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(hrs.setTracksHours(d, log(), opsFork, true)).rejects.toThrow(/not found/);              // another department's forklift
    await hrs.setTracksHours(d, log(), fork, true);
    await hrs.setTracksHours(d, mgr(), opsFork, true);
    await hrs.setTracksHours(d, mgr(), plain, true);
    await hrs.setTracksHours(d, mgr(), plain, false);
    expect((await hrs.getHours(d, log(), fork))?.tracks).toBe(true);
    expect(await hrs.getHours(d, log(), opsFork)).toBeNull();
  });

  it("needs hour tracking on, and takes a plain number", async () => {
    await expect(hrs.recordEngineHours(d, mgr(), plain, "10")).rejects.toThrow(/Switch on hour tracking/);
    for (const bad of ["", "abc", "-5", "12.55", "1e3"]) expect(await hrs.recordEngineHours(d, mgr(), fork, bad).catch((e) => e)).toBeInstanceOf(UserError);
    expect(await onVehicle(fork)).toBeNull();
  });

  it("records a reading, moves the vehicle, and refuses a lower number or an impossible jump", async () => {
    await hrs.recordEngineHours(d, log(), fork, "1000");
    expect(await onVehicle(fork)).toBe("1000.0");
    await hrs.recordEngineHours(d, log(), fork, "1012.5");
    expect(await onVehicle(fork)).toBe("1012.5");
    const low = await hrs.recordEngineHours(d, log(), fork, "900").catch((e) => e);
    expect(low).toBeInstanceOf(UserError);
    expect(low.fields.hours).toMatch(/at least/);
    const jump = await hrs.recordEngineHours(d, log(), fork, "1200").catch((e) => e);        // 187 hours in under a day
    expect(jump.fields.hours).toMatch(/Too many hours/);
    expect(await onVehicle(fork)).toBe("1012.5");
    const info = await hrs.getHours(d, mgr(), fork);
    expect(info?.readings.map((r) => [r.reading_hours, r.source])).toEqual([[1012.5, "manual"], [1000, "baseline"]]);
  });

  it("holds a bad reading in the database too, and it does not move the vehicle", async () => {
    await raw((q) => q.query("insert into engine_hour_readings(vehicle_id, reading_hours, source) values ($1, 5, 'manual')", [fork]));
    const r = await raw(async (q) => (await q.query<{ status: string; flag_reason: string }>("select status, flag_reason from engine_hour_readings where vehicle_id = $1 and reading_hours = 5", [fork])).rows[0]);
    expect(r).toEqual({ status: "flagged", flag_reason: "lower_than_previous" });
    expect(await onVehicle(fork)).toBe("1012.5");
  });

  it("will not let a department user write a reading for another department's vehicle", async () => {
    await expect(withTenant(d, log(), (q) => q.query("insert into engine_hour_readings(vehicle_id, reading_hours, source) values ($1, 10, 'manual')", [opsFork]))).rejects.toThrow(/another department/);
  });
});

describe("service rules in hours", () => {
  it("saves an hours-only rule and rejects one with no interval at all", async () => {
    const none = await ctl.saveServiceRule(d, owner(), { label: "Nothing", is_preventive: true, active: true }).catch((e) => e);
    expect(none).toBeInstanceOf(UserError);
    expect(none.fields.interval_months).toMatch(/hours/);
    const key = await ctl.saveServiceRule(d, owner(), { label: "Hydraulic service", interval_hours: "250", is_preventive: true, active: true, applies_to_classes: ["forklift"] });
    expect(key).toBe("hydraulic_service");
    expect((await ctl.listServiceRules(d, owner())).find((r) => r.key === key)?.interval_hours).toBe("250.0");
    await ctl.saveServiceRule(d, owner(), { key, label: "Hydraulic service", interval_hours: "100", is_preventive: true, active: true, applies_to_classes: ["forklift"] });
    expect((await ctl.listServiceRules(d, owner())).find((r) => r.key === key)?.interval_hours).toBe("100.0");
  });

  it("marks a service due soon, then overdue, as the hour meter runs on, and ignores hours for a vehicle that does not track them", async () => {
    // baseline: serviced at 1000 hours, rule every 100 hours; the meter reads 1012.5
    await raw((q) => q.query("insert into vehicle_service_baselines(vehicle_id, service_type_key, last_done_on, last_hours) values ($1, 'hydraulic_service', current_date, 1000)", [fork]));
    const row = () => raw(async (q) => (await q.query<{ due_hours: string; hours_remaining: string; pm_status: string }>(
      "select due_hours::text, hours_remaining::text, pm_status from v_pm_status where vehicle_id = $1 and service_type_key = 'hydraulic_service'", [fork])).rows[0]);
    expect(await row()).toEqual({ due_hours: "1100.0", hours_remaining: "87.5", pm_status: "ok" });
    await ctl.saveSettings(d, owner(), { pm_warning_hours: "100" });
    expect((await row()).pm_status).toBe("due_soon");
    await ctl.saveSettings(d, owner(), { pm_warning_hours: "25" });
    await age(fork, 30);
    await hrs.recordEngineHours(d, mgr(), fork, "1100");
    expect((await row()).pm_status).toBe("due_soon");                                      // 0 hours left is within the warning, not yet past it
    await age(fork, 30);
    await hrs.recordEngineHours(d, mgr(), fork, "1130");
    expect(await row()).toMatchObject({ hours_remaining: "-30.0", pm_status: "overdue" });
    // a vehicle that stops tracking hours drops the hours rule
    await hrs.setTracksHours(d, mgr(), fork, false);
    expect((await row())).toMatchObject({ due_hours: null, pm_status: "ok" });
    await hrs.setTracksHours(d, mgr(), fork, true);
  });

  it("shows the hours on the vehicle record", async () => {
    const r = await getVehicleRecord(d, mgr(), fork);
    expect(r).toMatchObject({ tracksHours: true, engineHours: 1130 });
    expect(r?.services.find((s) => s.label === "Hydraulic service")?.hours_remaining).toBe(-30);
  });

  it("accepts a pm_warning_hours setting and refuses a bad one", async () => {
    await expect(ctl.saveSettings(d, owner(), { pm_warning_hours: "abc" })).rejects.toBeInstanceOf(UserError);
    await expect(raw((q) => q.query("update settings set value = 'abc' where key = 'pm_warning_hours'"))).rejects.toThrow(/must be a number/);
  });
});

describe("hours on a job card", () => {
  it("records the hour meter from the card for a vehicle that tracks hours, and refuses a lower number", async () => {
    const low = await jc.createJobCard(d, mgr(), card(fork, { odometer_km: "0", engine_hours: "1000" }), true).catch((e) => e);
    expect(low).toBeInstanceOf(UserError);
    expect(low.fields.engine_hours).toMatch(/at least/);
    const { id } = await jc.createJobCard(d, mgr(), card(fork, { odometer_km: "0", engine_hours: "1131" }), true);
    expect(await onVehicle(fork)).toBe("1131.0");
    const src = await raw(async (q) => (await q.query<{ source: string }>("select source from engine_hour_readings where vehicle_id = $1 order by created_at desc limit 1", [fork])).rows[0].source);
    expect(src).toBe("job_card");
    expect((await jc.getJobCard(d, mgr(), id))?.engine_hours).toBe("1131.0");
  });

  it("ignores hours for a vehicle that does not track them, and a card without hours leaves the meter alone", async () => {
    await jc.createJobCard(d, mgr(), card(plain, { odometer_km: "100", engine_hours: "55" }), true);
    expect(await onVehicle(plain)).toBeNull();
    await jc.createJobCard(d, mgr(), card(fork, { odometer_km: "0" }), true);
    expect(await onVehicle(fork)).toBe("1131.0");
  });

  it("tells the form whether the vehicle tracks hours", async () => {
    const c = await jc.getJobContext(d, mgr(), fork);
    expect(c?.vehicle).toMatchObject({ tracks_hours: true, engine_hours: 1131 });
  });
});

describe("cost per hour", () => {
  const cost = async (vehicle: string, amount: number, daysAgo = 5) => {
    const { id } = await jc.createJobCard(d, mgr(), { vehicle_id: vehicle, requested_by: emps[12], reason_code_id: reasonId, cause_text: "Worked on during the test run", lines: [{ kind: "service", description: "Work", qty: "1", unit_cost: String(amount) }] }, true);
    await raw((q) => q.query("update job_cards set created_at = now() - ($2 || ' days')::interval where id = $1", [id, String(daysAgo)]));
  };

  it("divides the cost by the hours between the reading before the period and the last one in it, for vehicles that track hours", async () => {
    const v = (await master.addVehicle(d, owner(), { registration_no: "HR-1", vehicle_class: "forklift" })).id;
    await hrs.setTracksHours(d, owner(), v, true);
    await hoursAgo(v, 100, 500); await hoursAgo(v, 300, 60); await hoursAgo(v, 500, 1); await hoursAgo(v, 9999, 0, "flagged");
    await cost(v, 4000);
    const r = await fu.costPerHour(d, mgr(), 12);
    expect(r.rows.find((x) => x.registration_no === "HR-1")).toMatchObject({ cost: 4000, hours: 400, per_hour: 10, jobs: 1 });
    expect(r.rows.some((x) => x.registration_no === "CAR-1")).toBe(false);                    // does not track hours
  });

  it("shows no hours with fewer than two readings", async () => {
    const v = (await master.addVehicle(d, owner(), { registration_no: "HR-2", vehicle_class: "forklift" })).id;
    await hrs.setTracksHours(d, owner(), v, true);
    await hoursAgo(v, 700, 20); await cost(v, 500);
    expect((await fu.costPerHour(d, mgr(), 12)).rows.find((x) => x.registration_no === "HR-2")).toMatchObject({ cost: 500, hours: null, per_hour: null });
  });

  it("needs report.view, a department user sees only its own vehicles, and the export carries the figures", async () => {
    await expect(fu.costPerHour(d, req(), 12)).rejects.toBeInstanceOf(ForbiddenError);
    const csv = (await exportCsv(d, mgr(), "cost-per-hour", { months: "12" })).csv;
    expect(csv).toContain("Cost per hour");
    expect(csv).toMatch(/HR-1,1,4000\.00,400\.0,10\.00/);
    await expect(exportCsv(d, req(), "cost-per-hour")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
