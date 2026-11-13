import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import { createCargoRequest, getCargo, makeTripFromCargo, setCargoWeight, transitionCargo } from "@/lib/cargo/service";
import { samePlace, suggestVehicles } from "@/lib/cargo/suggest";

// ADR-092, owner decision F: the system suggests the best free vehicle for a cargo request; Logistics confirms by hand.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const req = () => mem("requester", 81);
const logi = () => mem("logistics", 83);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);
const at = (day: number, hour: number) => `2031-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00+05:00`;
const cargo = (over: Record<string, unknown> = {}) => ({
  description: "Rolls of fabric", quantity_text: "40 rolls", pickup_place: "Gulberg warehouse, Lahore", pickup_contact: "Imran", pickup_phone: "0300 1234567", pickup_at: at(10, 9),
  drop_place: "Karachi head office", drop_contact: "Saima", drop_phone: "0321 7654321", deliver_by: at(11, 17), vehicle_type: "truck", ...over,
});
let V: Record<string, string>;
let driverEmp: string, reqEmp: string;

async function vehicle(plate: string, extra: Record<string, unknown> = {}) {
  const id = (await master.addVehicle(d, owner(), { registration_no: plate, make: "Isuzu", model: "NPR", ...extra })).id;
  return id;
}
async function trip(vehicleId: string, status: string, from: string, to: string, start: string, end: string) {
  await raw((q) => q.query(
    `insert into trips(requested_by, purpose, from_place, to_place, start_at, end_at, status, vehicle_id, driver_id, completed_at)
     values ($1,'Test run',$2,$3,$4::timestamptz,$5::timestamptz,$6,$7,$8, case when $6 = 'completed' then $5::timestamptz end)`,
    [reqEmp, from, to, start, end, status, vehicleId, driverEmp]));
}
const suggest = async (id: string) => suggestVehicles(d, logi(), id);
const plates = async (id: string) => (await suggest(id)).suggestions.map((s) => s.registration_no);

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Suggest Co", slug: "suggestco", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  for (const [n, name] of [[81, "Requester One"], [83, "Logistics Three"], [84, "Driver Four"]] as const) {
    const id = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `S-${n}` })).id;
    await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), id]));
    if (n === 81) reqEmp = id;
    if (n === 84) driverEmp = id;
  }
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[81, "requester"], [83, "logistics"]] as const) await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
    await q.query("update public.org_billing set plan_key = 'pro' where tenant_id = $1", [t.tenantId]);
  });
  await raw((q) => q.query("insert into settings(key, value) values ('module_trips','1') on conflict (key) do update set value = '1'"));
  V = {
    small: await vehicle("SUG-SML", { load_capacity_kg: 800, vehicle_class: "pickup", base_location: "Lahore" }),
    mid: await vehicle("SUG-MID", { load_capacity_kg: 3000, vehicle_class: "truck", base_location: "Karachi" }),
    big: await vehicle("SUG-BIG", { load_capacity_kg: 10000, vehicle_class: "truck", base_location: "Lahore" }),
    unknown: await vehicle("SUG-UNK", { vehicle_class: "truck", base_location: "Lahore" }),
    workshop: await vehicle("SUG-WSH", { load_capacity_kg: 9000, vehicle_class: "truck", base_location: "Lahore" }),
  };
  await raw((q) => q.query("update vehicles set status = 'in_workshop' where id = $1", [V.workshop]));
});
beforeEach(async () => { await withPlatform(d, (q) => q.query("delete from public.rate_limits")); });

describe("what counts as the same place", () => {
  it("ignores case, punctuation and extra words on either side", () => {
    expect(samePlace("Lahore", "Gulberg warehouse, Lahore")).toBe(true);
    expect(samePlace("lahore depot", "LAHORE")).toBe(true);
    expect(samePlace("Karachi", "Gulberg warehouse, Lahore")).toBe(false);
    expect(samePlace(null, "Lahore")).toBe(false);
    expect(samePlace("", "")).toBe(false);
  });
});

describe("suggesting a vehicle", () => {
  it("asks for the weight first, and only people who handle cargo may ask", async () => {
    const { id } = await createCargoRequest(d, req(), cargo());
    const s = await suggest(id);
    expect(s).toMatchObject({ weight_kg: null, suggestions: [], message: expect.stringMatching(/Enter the weight/) });
    await expect(suggestVehicles(d, req(), id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("takes the weight with the request, or from Logistics afterwards", async () => {
    const a = await createCargoRequest(d, req(), cargo({ weight_kg: "2,500".replace(",", "") }));
    expect((await getCargo(d, logi(), a.id))!.weight_kg).toBe("2500.0");
    const b = await createCargoRequest(d, req(), cargo());
    await setCargoWeight(d, logi(), b.id, "1200");
    expect((await getCargo(d, logi(), b.id))!).toMatchObject({ weight_kg: "1200.0" });
    expect((await getCargo(d, logi(), b.id))!.events.at(-1)?.note).toBe("Weight set to 1,200 kg");
    await expect(setCargoWeight(d, req(), b.id, "100")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setCargoWeight(d, logi(), b.id, "0")).rejects.toBeInstanceOf(UserError);
    await expect(setCargoWeight(d, logi(), b.id, "abc")).rejects.toBeInstanceOf(UserError);
  });

  it("offers only vehicles in service that can carry the load: at the pick-up place first, the kind asked for next, then the smallest", async () => {
    const { id } = await createCargoRequest(d, req(), cargo({ weight_kg: "700" }));
    // Lahore pick-up: SUG-SML (800 kg, Lahore) and SUG-BIG (10,000 kg, Lahore) are there; SUG-MID is in Karachi; SUG-UNK has no capacity; SUG-WSH is in the workshop
    expect(await plates(id)).toEqual(["SUG-BIG", "SUG-SML", "SUG-MID"]);                // SUG-BIG is a truck, the kind asked for; SUG-SML is smaller but a pickup
    const s = await suggest(id);
    expect(s.unknown_capacity).toBe(1);
    expect(s.suggestions[1].reasons.join(" | ")).toMatch(/carries 800 kg for a 700 kg load.*already at Lahore, the pick-up place/);
    expect(s.suggestions[2].reasons.join(" | ")).toMatch(/at Karachi \(its base\), not at the pick-up place/);
  });

  it("drops vehicles too small for the load", async () => {
    const { id } = await createCargoRequest(d, req(), cargo({ weight_kg: "2000" }));
    expect(await plates(id)).toEqual(["SUG-BIG", "SUG-MID"]);                               // at the pick-up place first, then the others
    const { id: heavy } = await createCargoRequest(d, req(), cargo({ weight_kg: "9500", pickup_place: "Karachi port" }));
    expect(await plates(heavy)).toEqual(["SUG-BIG"]);
  });

  it("leaves out a vehicle booked on an approved or started trip that overlaps the time needed, and not one booked at another time", async () => {
    const { id } = await createCargoRequest(d, req(), cargo({ weight_kg: "2000" }));
    await trip(V.big, "approved", "Lahore", "Multan", at(10, 14), at(10, 20));          // overlaps the 9:00 to 17:00 window of the 11th? no: the window is 10th 9:00 to 11th 17:00, so yes
    expect(await plates(id)).toEqual(["SUG-MID"]);
    const s = await suggest(id);
    expect(s.busy).toBe(1);
    await raw((q) => q.query("delete from trips where vehicle_id = $1", [V.big]));
    await trip(V.big, "approved", "Lahore", "Multan", at(15, 8), at(15, 18));          // another day
    expect(await plates(id)).toEqual(["SUG-BIG", "SUG-MID"]);
    await raw((q) => q.query("delete from trips where vehicle_id = $1", [V.big]));
  });

  it("takes a vehicle's place from where its last finished trip ended, not from its base", async () => {
    const { id } = await createCargoRequest(d, req(), cargo({ weight_kg: "2000" }));
    expect((await suggest(id)).suggestions[0]).toMatchObject({ registration_no: "SUG-BIG", at_pickup: true, location_from: "base" });
    await trip(V.big, "completed", "Lahore", "Islamabad", at(1, 8), at(1, 18));
    const s = await suggest(id);
    expect(s.suggestions.map((x) => [x.registration_no, x.at_pickup, x.location_from, x.location])).toEqual([
      ["SUG-MID", false, "base", "Karachi"], ["SUG-BIG", false, "last_trip", "Islamabad"],         // neither is at Lahore now; the smaller one comes first
    ]);
    await trip(V.mid, "completed", "Karachi", "Lahore", at(2, 8), at(2, 18));
    const s2 = await suggest(id);
    expect(s2.suggestions[0]).toMatchObject({ registration_no: "SUG-MID", at_pickup: true, location_from: "last_trip" });
    await raw((q) => q.query("delete from trips where vehicle_id = any($1::uuid[])", [[V.big, V.mid]]));
  });

  it("prefers the kind of vehicle asked for when everything else is equal", async () => {
    const { id } = await createCargoRequest(d, req(), cargo({ weight_kg: "500", pickup_place: "Faisalabad", vehicle_type: "pickup" }));
    expect((await suggest(id)).suggestions[0].registration_no).toBe("SUG-SML");
    const { id: t2 } = await createCargoRequest(d, req(), cargo({ weight_kg: "500", pickup_place: "Faisalabad", vehicle_type: "10 tonne truck" }));
    expect((await suggest(t2)).suggestions[0].class_match).toBe(true);
  });

  it("says why there is nothing, and points to logistics providers", async () => {
    const { id } = await createCargoRequest(d, req(), cargo({ weight_kg: "50000" }));
    expect((await suggest(id)).message).toMatch(/1 free vehicle has no load capacity recorded/);       // it could not be judged, and the message says so
    await raw((q) => q.query("update vehicles set load_capacity_kg = 100 where id = $1", [V.unknown]));
    expect((await suggest(id)).message).toMatch(/No vehicle in the fleet can carry this load.*logistics providers/);
    await raw((q) => q.query("update vehicles set load_capacity_kg = null where id = $1", [V.unknown]));
    const { id: b } = await createCargoRequest(d, req(), cargo({ weight_kg: "9000" }));
    await trip(V.big, "started", "Lahore", "Multan", at(10, 10), at(10, 20));
    expect((await suggest(b)).message).toMatch(/1 vehicle is big enough but already booked/);
    await raw((q) => q.query("delete from trips where vehicle_id = $1", [V.big]));
  });
});

describe("confirming by hand", () => {
  it("makes the trip with the chosen vehicle as its preferred vehicle, and the history says so", async () => {
    const { id } = await createCargoRequest(d, req(), cargo({ weight_kg: "2000" }));
    await transitionCargo(d, logi(), id, "accepted");
    const tripId = await makeTripFromCargo(d, logi(), id, V.mid);
    const row = await raw(async (q) => (await q.query<{ preferred_vehicle_id: string; vehicle_id: string | null; status: string }>("select preferred_vehicle_id, vehicle_id, status from trips where id = $1", [tripId])).rows[0]);
    expect(row).toMatchObject({ preferred_vehicle_id: V.mid, vehicle_id: null, status: "requested" });      // nothing is assigned: the trip still needs its approver
    expect((await getCargo(d, logi(), id))!.events.at(-1)?.note).toMatch(/vehicle SUG-MID chosen from the suggestions/);
  });

  it("makes a trip with no vehicle when none fits, and refuses a vehicle that is not in service", async () => {
    const { id } = await createCargoRequest(d, req(), cargo({ weight_kg: "50000" }));
    await transitionCargo(d, logi(), id, "accepted");
    await expect(makeTripFromCargo(d, logi(), id, V.workshop)).rejects.toThrow(/not available/);
    const tripId = await makeTripFromCargo(d, logi(), id);
    expect((await raw(async (q) => (await q.query<{ preferred_vehicle_id: string | null }>("select preferred_vehicle_id from trips where id = $1", [tripId])).rows[0])).preferred_vehicle_id).toBeNull();
    expect((await getCargo(d, logi(), id))!.events.at(-1)?.note).toMatch(/no vehicle chosen/);
  });

  it("stops changing the weight once a trip exists", async () => {
    const { id } = await createCargoRequest(d, req(), cargo({ weight_kg: "100" }));
    await transitionCargo(d, logi(), id, "accepted");
    await makeTripFromCargo(d, logi(), id);
    await expect(setCargoWeight(d, logi(), id, "200")).rejects.toThrow(/only while the request is open and has no trip/);
  });
});

describe("load space (cubic metres)", () => {
  it("drops a vehicle whose recorded space is too small, keeps one with none recorded, and says so", async () => {
    await master.setVehicleCapacity(d, owner(), V.mid, { load_capacity_kg: "3000", load_volume_m3: "10" });
    await master.setVehicleCapacity(d, owner(), V.big, { load_capacity_kg: "10000", load_volume_m3: "40" });
    const { id } = await createCargoRequest(d, req(), cargo({ weight_kg: "500", volume_m3: "20", pickup_place: "Faisalabad" }));
    const s = await suggest(id);
    expect(s.volume_m3).toBe(20);
    const plates = s.suggestions.map((x) => x.registration_no);
    expect(plates).not.toContain("SUG-MID");                      // 10 m3 of space for 20 m3
    expect(plates).toEqual(expect.arrayContaining(["SUG-SML", "SUG-BIG"]));
    expect(s.suggestions.find((x) => x.registration_no === "SUG-SML")!.reasons.join(" ")).toMatch(/space not recorded/);
    expect(s.suggestions.find((x) => x.registration_no === "SUG-BIG")!.reasons.join(" ")).toMatch(/40 m3 of space for 20 m3/);
  });
  it("refuses a bad capacity, and clears it when left empty", async () => {
    await expect(master.setVehicleCapacity(d, owner(), V.mid, { load_volume_m3: "abc" })).rejects.toBeInstanceOf(UserError);
    await master.setVehicleCapacity(d, owner(), V.mid, { load_capacity_kg: "3000", load_volume_m3: "" });
    const v = await raw((q) => q.query<{ load_volume_m3: string | null }>("select load_volume_m3::text from vehicles where id = $1", [V.mid]));
    expect(v.rows[0].load_volume_m3).toBeNull();
  });
});
