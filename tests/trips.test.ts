import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as trips from "@/lib/trips/service";
import * as ctl from "@/lib/control/service";
import { listNotifications } from "@/lib/jobcards/service";

// ADR-045 phase 5a: trip requests, approval, start and return.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const mgr = () => mem("fleet_manager", 12);
const req = () => mem("requester", 11);
const req2 = () => mem("requester", 14);
const guard = () => mem("security", 15);
const auditor = () => mem("auditor", 16);
const logi = () => mem("logistics", 19);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);

let emps: Record<number, string>;
let van: string, car: string, workshopVan: string;
// Times are written in UTC with a fixed offset so the tests do not depend on the machine's clock zone.
const at = (day: number, hour: number) => `2031-03-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;
const T = (extra: Record<string, unknown> = {}) => ({ purpose: "Deliver samples to Karachi", from_place: "Lahore", to_place: "Karachi", start_at: at(10, 8), end_at: at(10, 18), ...extra });

async function approved(requester = req(), extra: Record<string, unknown> = {}, vehicle = van, driver = 14) {
  const id = await trips.requestTrip(d, requester, T(extra));
  await trips.transitionTrip(d, mgr(), id, "approved", { vehicleId: vehicle, driverId: emps[driver] });
  return id;
}

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  emps = {};
  for (const [n, name] of [[11, "Requester One"], [12, "Manager One"], [14, "Driver Three"], [17, "Driver Four"]] as const) {
    emps[n] = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` })).id;
    if (n !== 17) await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), emps[n]]));
  }
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[11, "requester"], [12, "fleet_manager"], [14, "requester"], [15, "security"], [16, "auditor"], [19, "logistics"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  van = (await master.addVehicle(d, owner(), { registration_no: "TRP-001", make: "Toyota", model: "Hiace" })).id;
  car = (await master.addVehicle(d, owner(), { registration_no: "TRP-002", make: "Honda", model: "City" })).id;
  workshopVan = (await master.addVehicle(d, owner(), { registration_no: "TRP-003", make: "Suzuki", model: "Bolan" })).id;
  await raw((q) => q.query("update vehicles set status = 'in_workshop' where id = $1", [workshopVan]));
  await withTenant(d, owner(), (q) => q.query("update role_departments set sees_all_vehicles = false where role_key = 'logistics'"));   // these tests cover a department role limited to its own department; Logistics sees the whole fleet by default (ADR-075, tests/dept-whole-fleet.test.ts)
});

describe("the trips module switch", () => {
  it("is off by default: pages and actions say not available, nothing is written", async () => {
    expect(await trips.tripsEnabled(d, owner())).toBe(false);
    const e = await trips.requestTrip(d, req(), T()).catch((x) => x);
    expect(e).toBeInstanceOf(UserError);
    expect(e.message).toMatch(/not switched on/);
    await expect(trips.listTrips(d, mgr())).rejects.toBeInstanceOf(UserError);
    expect((await raw((q) => q.query("select count(*)::int c from trips"))).rows[0].c).toBe(0);
  });

  it("is switched on in Settings by someone with admin.settings, and only with 0 or 1", async () => {
    await expect(ctl.saveSettings(d, mgr(), { module_trips: "1" })).rejects.toBeInstanceOf(ForbiddenError);
    const bad = await ctl.saveSettings(d, owner(), { module_trips: "2" }).catch((x) => x);
    expect(bad).toBeInstanceOf(UserError);
    await ctl.saveSettings(d, owner(), { module_trips: "1" });
    expect(await trips.tripsEnabled(d, req())).toBe(true);
    await expect(raw((q) => q.query("update settings set value = 'yes' where key = 'module_trips'"))).rejects.toThrow(/module_trips must be 0 or 1/);
  });
});

describe("asking for a trip", () => {
  it("checks the fields, and the end must be after the start", async () => {
    const bad = await trips.requestTrip(d, req(), { purpose: "x", from_place: "", to_place: "", start_at: "", end_at: "" }).catch((e) => e);
    expect(bad).toBeInstanceOf(UserError);
    expect(Object.keys(bad.fields).sort()).toEqual(["end_at", "from_place", "purpose", "start_at", "to_place"]);
    const back = await trips.requestTrip(d, req(), T({ end_at: at(10, 7) })).catch((e) => e);
    expect(back.fields.end_at).toMatch(/after the start/);
  });

  it("needs trip.request, an employee record, and gives each trip a TR- number and a first event", async () => {
    await expect(trips.requestTrip(d, guard(), T())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(trips.requestTrip(d, auditor(), T())).rejects.toBeInstanceOf(ForbiddenError);
    const noEmp = await trips.requestTrip(d, mem("requester", 18), T()).catch((e) => e);        // a login with no employee record
    expect(noEmp.message).toMatch(/employee record linked to your login/);
    const id = await trips.requestTrip(d, req(), T({ passengers: "3", preferred_vehicle_id: car }));
    const tr = (await trips.getTrip(d, req(), id))!;
    expect(tr.trip_no).toMatch(/^TR-\d{6}$/);
    expect(tr).toMatchObject({ status: "requested", passengers: 3, preferred_vehicle: "TRP-002", requester_name: "Requester One" });
    expect(tr.events.map((e) => e.to_status)).toEqual(["requested"]);
  });

  it("tells the people who can approve, not the person who asked", async () => {
    const id = await trips.requestTrip(d, req(), T({ purpose: "Site visit" }));
    const mine = await listNotifications(d, mgr());
    expect(mine.some((n) => n.kind === "trip.requested" && n.payload.trip_id === id)).toBe(true);
    expect((await listNotifications(d, req())).some((n) => n.kind === "trip.requested" && n.payload.trip_id === id)).toBe(false);
  });
});

describe("who sees which trips", () => {
  it("a requester sees only their own, a manager and an auditor see all, the gate sees none", async () => {
    const id = await trips.requestTrip(d, req2(), T({ purpose: "Bank run" }));
    expect((await trips.listTrips(d, req())).some((r) => r.id === id)).toBe(false);
    expect(await trips.getTrip(d, req(), id)).toBeNull();
    expect((await trips.listTrips(d, req2())).some((r) => r.id === id)).toBe(true);
    expect((await trips.listTrips(d, mgr())).some((r) => r.id === id)).toBe(true);
    expect((await trips.listTrips(d, auditor())).some((r) => r.id === id)).toBe(true);
    await expect(trips.listTrips(d, guard())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("approving, rejecting, cancelling", () => {
  it("an approval needs a vehicle and a driver, and a person cannot approve their own request", async () => {
    const id = await trips.requestTrip(d, req(), T({ start_at: at(11, 8), end_at: at(11, 18) }));
    await expect(trips.transitionTrip(d, req(), id, "approved", { vehicleId: van, driverId: emps[14] })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await trips.transitionTrip(d, mgr(), id, "approved", { driverId: emps[14] }).catch((e) => e)).message).toMatch(/choose a vehicle/i);
    expect((await trips.transitionTrip(d, mgr(), id, "approved", { vehicleId: van }).catch((e) => e)).message).toMatch(/choose a driver/i);
    // a manager who is also the requester is refused
    const own = await trips.requestTrip(d, mgr(), T({ start_at: at(12, 8), end_at: at(12, 18), purpose: "Manager trip" }));
    expect((await trips.transitionTrip(d, mgr(), own, "approved", { vehicleId: van, driverId: emps[14] }).catch((e) => e)).message).toMatch(/cannot approve your own/i);
    await trips.transitionTrip(d, mgr(), id, "approved", { vehicleId: van, driverId: emps[14], note: "Fine" });
    const tr = (await trips.getTrip(d, mgr(), id))!;
    expect(tr).toMatchObject({ status: "approved", registration_no: "TRP-001", driver_name: "Driver Three" });
    expect(tr.events.map((e) => e.to_status)).toEqual(["requested", "approved"]);
  });

  it("uses the preferred vehicle when none is chosen, refuses a vehicle that is not available, and an inactive driver", async () => {
    const id = await trips.requestTrip(d, req(), T({ start_at: at(13, 8), end_at: at(13, 18), preferred_vehicle_id: car }));
    await trips.transitionTrip(d, mgr(), id, "approved", { driverId: emps[14] });
    expect((await trips.getTrip(d, mgr(), id))!.registration_no).toBe("TRP-002");
    const w = await trips.requestTrip(d, req(), T({ start_at: at(14, 8), end_at: at(14, 18) }));
    expect((await trips.transitionTrip(d, mgr(), w, "approved", { vehicleId: workshopVan, driverId: emps[14] }).catch((e) => e)).message).toMatch(/not available \(it is in workshop\)/);
    await raw((q) => q.query("update employees set active = false where id = $1", [emps[17]]));
    expect((await trips.transitionTrip(d, mgr(), w, "approved", { vehicleId: van, driverId: emps[17] }).catch((e) => e)).message).toMatch(/active employee/);
  });

  it("refuses overlapping trips on one vehicle or one driver, and allows back-to-back ones", async () => {
    await raw((q) => q.query("update employees set active = true where id = $1", [emps[17]]));
    await approved(req(), { start_at: at(20, 8), end_at: at(20, 12) }, van, 14);
    const clash = await trips.requestTrip(d, req(), T({ start_at: at(20, 11), end_at: at(20, 15) }));
    expect((await trips.transitionTrip(d, mgr(), clash, "approved", { vehicleId: van, driverId: emps[17] }).catch((e) => e)).message).toMatch(/vehicle is already booked/);
    await raw((q) => q.query("update employees set active = true where id = $1", [emps[17]]));
    expect((await trips.transitionTrip(d, mgr(), clash, "approved", { vehicleId: car, driverId: emps[14] }).catch((e) => e)).message).toMatch(/driver is already on another trip/);
    await trips.transitionTrip(d, mgr(), clash, "approved", { vehicleId: car, driverId: emps[17] });                 // different vehicle and driver: fine
    const next = await trips.requestTrip(d, req(), T({ start_at: at(20, 12), end_at: at(20, 16) }));                  // starts the minute the first ends
    await trips.transitionTrip(d, mgr(), next, "approved", { vehicleId: van, driverId: emps[14] });
    expect((await trips.getTrip(d, mgr(), next))!.status).toBe("approved");
  });

  it("a rejection or cancellation needs a reason; a rejected trip does not hold the vehicle", async () => {
    const id = await trips.requestTrip(d, req(), T({ start_at: at(21, 8), end_at: at(21, 18) }));
    expect((await trips.transitionTrip(d, mgr(), id, "rejected", { note: "no" }).catch((e) => e)).message).toMatch(/reason of at least 5/);
    await trips.transitionTrip(d, mgr(), id, "rejected", { note: "No vehicle free that day" });
    expect((await trips.getTrip(d, req(), id))!).toMatchObject({ status: "rejected", decision_note: "No vehicle free that day" });
    expect((await listNotifications(d, req())).some((n) => n.kind === "trip.rejected" && n.payload.trip_id === id)).toBe(true);
    expect((await trips.transitionTrip(d, mgr(), id, "approved", { vehicleId: van, driverId: emps[14] }).catch((e) => e)).message).toMatch(/illegal trip transition rejected -> approved/i);
    const again = await approved(req(), { start_at: at(21, 8), end_at: at(21, 18) });                                  // the same slot is free
    expect((await trips.getTrip(d, mgr(), again))!.status).toBe("approved");
  });

  it("the person who asked may cancel their own request, not someone else's", async () => {
    const id = await trips.requestTrip(d, req(), T({ start_at: at(22, 8), end_at: at(22, 18) }));
    await expect(trips.transitionTrip(d, req2(), id, "cancelled", { note: "Not mine to cancel" })).rejects.toBeInstanceOf(ForbiddenError);
    await trips.transitionTrip(d, req(), id, "cancelled", { note: "Plans changed" });
    expect((await trips.getTrip(d, req(), id))!.status).toBe("cancelled");
    await expect(trips.transitionTrip(d, req(), id, "cancelled", { note: "Again please" })).rejects.toThrow(/[Ii]llegal trip transition cancelled -> cancelled/);
  });
});

describe("leaving and returning", () => {
  it("takes the odometer out and back, writes both readings, and shows the distance", async () => {
    const id = await approved(req(), { start_at: at(25, 8), end_at: at(25, 18) }, car, 14);
    expect((await trips.transitionTrip(d, mgr(), id, "started", {}).catch((e) => e)).message).toMatch(/odometer reading at departure/);
    expect((await trips.transitionTrip(d, mgr(), id, "started", { odometer: "abc" }).catch((e) => e)).fields?.odometer).toBeTruthy();
    await expect(trips.transitionTrip(d, req(), id, "started", { odometer: "50000" })).rejects.toBeInstanceOf(ForbiddenError);   // not the driver, not an approver
    await trips.transitionTrip(d, req2(), id, "started", { odometer: "50000" });                                              // the driver may
    expect((await trips.getTrip(d, mgr(), id))!.status).toBe("started");
    expect((await trips.transitionTrip(d, mgr(), id, "completed", { odometer: "49990" }).catch((e) => e)).message).toMatch(/below the departure reading/);
    await trips.transitionTrip(d, req2(), id, "completed", { odometer: "50412.5" });
    const tr = (await trips.getTrip(d, mgr(), id))!;
    expect(tr).toMatchObject({ status: "completed", odometer_out: "50000.0", odometer_in: "50412.5", distance_km: "412.5" });
    expect(tr.events.map((e) => e.to_status)).toEqual(["requested", "approved", "started", "completed"]);
    const readings = (await raw((q) => q.query<{ reading_km: string; source: string }>("select reading_km::text, source from odometer_readings where vehicle_id = $1 and source = 'trip' order by read_at, created_at", [car]))).rows;
    expect(readings.map((r) => r.reading_km)).toEqual(["50000.0", "50412.5"]);
  });

  it("flags a departure reading below the last one through the existing odometer rules", async () => {
    const id = await approved(req(), { start_at: at(26, 8), end_at: at(26, 18) }, car, 14);
    await trips.transitionTrip(d, mgr(), id, "started", { odometer: "100" });
    const flagged = (await raw((q) => q.query("select 1 from odometer_readings where vehicle_id = $1 and source = 'trip' and status = 'flagged'", [car]))).rows;
    expect(flagged.length).toBeGreaterThan(0);
  });

  it("a trip cannot skip a step or be changed once finished", async () => {
    const id = await approved(req(), { start_at: at(27, 8), end_at: at(27, 18) }, van, 14);
    await expect(trips.transitionTrip(d, mgr(), id, "completed", { odometer: "10" })).rejects.toThrow(/[Ii]llegal trip transition approved -> completed/);
    await trips.transitionTrip(d, mgr(), id, "started", { odometer: "1000" });
    await trips.transitionTrip(d, mgr(), id, "completed", { odometer: "1100" });
    await expect(trips.transitionTrip(d, mgr(), id, "cancelled", { note: "Too late now" })).rejects.toThrow(/[Ii]llegal trip transition completed -> cancelled/);
    await expect(raw((q) => q.query("update trips set status = 'requested' where id = $1", [id]))).resolves.toBeTruthy();   // the database does not stop a raw edit...
    expect((await raw((q) => q.query("select count(*)::int c from audit_log where table_name = 'trips' and row_id = $1", [id]))).rows[0].c).toBeGreaterThan(2);   // ...but it is audited
  });
});

describe("the licence warning", () => {
  it("warns when the driver's licence expires before the trip ends, and does not block", async () => {
    await raw((q) => q.query("insert into driver_licences(employee_id, licence_no, expires_on) values ($1, 'L-1', '2031-03-28')", [emps[17]]));
    const id = await approved(req(), { start_at: at(29, 8), end_at: at(30, 18) }, van, 17);
    expect((await trips.getTrip(d, mgr(), id))!.driver_licence_expired).toBe(true);
    const ok = await approved(req(), { start_at: at(28, 8), end_at: at(28, 12) }, car, 17);
    expect((await trips.getTrip(d, mgr(), ok))!.driver_licence_expired).toBe(false);
  });
});

describe("roles", () => {
  it("gives the gate role gate.use and vehicle.read only, and the manager and administrator the trip permissions", async () => {
    const perms = async (role: string) => (await raw((q) => q.query<{ permission_key: string }>("select permission_key from role_permissions where role_key = $1 order by 1", [role]))).rows.map((r) => r.permission_key);
    expect(await perms("security")).toEqual(["gate.use", "vehicle.read"]);
    expect((await perms("fleet_manager")).filter((p) => p.startsWith("trip.")).sort()).toEqual(["trip.approve", "trip.award", "trip.dispatch", "trip.read_all", "trip.request"]);
    expect(await perms("logistics")).toEqual(expect.arrayContaining(["trip.dispatch", "trip.request", "vehicle.read"]));
    expect((await perms("requester")).filter((p) => p.startsWith("trip."))).toEqual(["trip.request"]);
    expect((await perms("auditor")).filter((p) => p.startsWith("trip."))).toEqual(["trip.read_all"]);
  });
});

describe("staff pick and drop by pool cars (logistics)", () => {
  beforeAll(async () => { await raw((q) => q.query("update vehicles set department = 'Logistics' where id = $1", [car])); });   // pool cars are Logistics vehicles (ADR-048)
  it("a pool car is chosen by logistics or someone who manages vehicles, and only they may change it", async () => {
    await expect(trips.setPoolCar(d, req(), van, true)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(trips.listPoolCandidates(d, guard())).rejects.toBeInstanceOf(ForbiddenError);
    await trips.setPoolCar(d, logi(), car, true);
    const list = await trips.listPoolCandidates(d, logi());
    expect(list.find((c) => c.id === car)?.is_pool).toBe(true);
    expect(list.find((c) => c.id === van)?.is_pool).toBeUndefined();
    expect((await trips.setPoolCar(d, logi(), "00000000-0000-0000-0000-0000000000ff", true).catch((e) => e)).message).toMatch(/not found/);
  });

  it("a pick and drop request can only be given a pool car, by logistics, and logistics cannot approve an ordinary trip", async () => {
    const run = await trips.requestTrip(d, req(), T({ kind: "pick_drop", purpose: "Morning pick up", stops: "Gulberg, Model Town", start_at: at(5, 6), end_at: at(5, 9), passengers: "4" }));
    expect((await listNotifications(d, logi())).some((n) => n.kind === "trip.requested" && n.payload.trip_id === run)).toBe(true);
    expect((await trips.getTrip(d, logi(), run))).toMatchObject({ kind: "pick_drop", stops: "Gulberg, Model Town" });
    expect((await trips.transitionTrip(d, logi(), run, "approved", { vehicleId: van, driverId: emps[14] }).catch((e) => e)).message).toMatch(/pool car/);
    await trips.transitionTrip(d, logi(), run, "approved", { vehicleId: car, driverId: emps[14] });
    expect((await trips.getTrip(d, logi(), run))).toMatchObject({ status: "approved", registration_no: "TRP-002" });
    const ordinary = await trips.requestTrip(d, req(), T({ start_at: at(6, 8), end_at: at(6, 18) }));
    await expect(trips.transitionTrip(d, logi(), ordinary, "approved", { vehicleId: car, driverId: emps[14] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("logistics sees every pick and drop run but not other people's ordinary trips; an ordinary trip may use a pool car", async () => {
    const ordinary = await trips.requestTrip(d, req2(), T({ purpose: "Private errand", start_at: at(7, 8), end_at: at(7, 9) }));
    const rows = await trips.listTrips(d, logi());
    expect(rows.some((r) => r.kind === "pick_drop")).toBe(true);
    expect(rows.some((r) => r.id === ordinary)).toBe(false);
    expect(await trips.getTrip(d, logi(), ordinary)).toBeNull();
    await trips.transitionTrip(d, mgr(), ordinary, "approved", { vehicleId: car, driverId: emps[17] });     // a manager may still use a pool car for an ordinary trip
  });

  it("refuses a non-pool car as the preferred vehicle of a pick and drop request, and taking a booked car out of the pool", async () => {
    expect((await trips.requestTrip(d, req(), T({ kind: "pick_drop", preferred_vehicle_id: van })).catch((e) => e)).message).toMatch(/pool cars/);
    const booked = await trips.requestTrip(d, req(), T({ kind: "pick_drop", start_at: at(8, 6), end_at: at(8, 9), preferred_vehicle_id: car }));
    await trips.transitionTrip(d, logi(), booked, "approved", { driverId: emps[14] });
    expect((await trips.setPoolCar(d, logi(), car, false).catch((e) => e)).message).toMatch(/runs booked/);
    await trips.transitionTrip(d, logi(), booked, "cancelled", { note: "Run not needed" });
  });
});
