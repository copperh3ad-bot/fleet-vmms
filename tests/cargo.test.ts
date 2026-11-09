import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { createCargoRequest, getCargo, listCargo, makeTripFromCargo, transitionCargo } from "@/lib/cargo/service";
import { getTrip } from "@/lib/trips/service";
import { processWhatsAppMenu } from "@/lib/wa-menu/engine";
import type { InboundMessage } from "@/lib/whatsapp";

// ADR-079 phase C: cargo pick-up and delivery requests, from the app and from the WhatsApp menu.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const req = () => mem("requester", 91);
const req2 = () => mem("requester", 95);
const mgr = () => mem("fleet_manager", 92);
const logi = () => mem("logistics", 93);
const aud = () => mem("auditor", 94);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);
const at = (day: number, hour: number) => `2031-08-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00+05:00`;
const cargo = (over: Record<string, unknown> = {}) => ({
  description: "Boxes of sample fabric", quantity_text: "12 cartons, about 300 kg", pickup_place: "Gulberg warehouse, Lahore", pickup_contact: "Imran", pickup_phone: "0300 1234567", pickup_at: at(10, 9),
  drop_place: "Karachi head office", drop_contact: "Saima", drop_phone: "0321 7654321", deliver_by: at(12, 17), handling: "Fragile", vehicle_type: "10-tonne truck", department: "Sales", ...over,
});
const status = async (id: string) => (await getCargo(d, mgr(), id))!.status;

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Cargo Co", slug: "cargoco", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  for (const [n, name, phone] of [[91, "Requester One", "0300 9111111"], [95, "Requester Two", "0300 9555555"], [92, "Manager Two", "0300 9222222"], [93, "Logistics Three", "0300 9333333"], [94, "Auditor Four", "0300 9444444"]] as const) {
    const id = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `C-${n}` })).id;
    await raw((q) => q.query("update employees set user_id = $1, phone = $3 where id = $2", [U(n), id, phone]));
  }
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[91, "requester"], [95, "requester"], [92, "fleet_manager"], [93, "logistics"], [94, "auditor"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
    await q.query("update public.org_billing set plan_key = 'pro' where tenant_id = $1", [t.tenantId]);
    await q.query("update public.tenants set wa_menu_enabled = true where id = $1", [t.tenantId]);
  });
  await raw((q) => q.query("insert into settings(key, value) values ('module_trips','1') on conflict (key) do update set value = '1'"));
});
beforeEach(async () => { await withPlatform(d, (q) => q.query("delete from public.rate_limits")); });

describe("asking for cargo to be moved", () => {
  it("is for those who hold cargo.request, checks every field, and gives the request a number and a history", async () => {
    expect(await createCargoRequest(d, aud(), cargo()).catch((e) => e)).toBeInstanceOf(ForbiddenError);
    const bad = await createCargoRequest(d, req(), cargo({ pickup_phone: "12", deliver_by: at(9, 9), description: "", vehicle_type: "" })).catch((e) => e);
    expect(bad.message).toMatch(/Fix the highlighted/);
    expect(Object.keys(bad.fields ?? {}).sort()).toEqual(["deliver_by", "description", "pickup_phone", "vehicle_type"]);
    const made = await createCargoRequest(d, req(), cargo());
    expect(made.cargo_no).toMatch(/^CR-\d{6}$/);
    const c = (await getCargo(d, mgr(), made.id))!;
    expect(c).toMatchObject({ status: "requested", source: "app", pickup_phone: "+923001234567", drop_phone: "+923217654321", handling: "Fragile", requester_name: "Requester One" });
    expect(c.events.map((e) => e.to_status)).toEqual(["requested"]);
  });

  it("tells the people who handle cargo in the app, and no one else", async () => {
    const made = await createCargoRequest(d, req(), cargo({ description: "Spare parts" }));
    const who = await raw(async (q) => (await q.query<{ user_id: string }>("select user_id from notifications where kind = 'cargo.requested' and payload->>'cargo_id' = $1 order by user_id", [made.id])).rows.map((r) => r.user_id));
    expect(who).toEqual([U(1), U(92), U(93)]);                                       // the administrator, the Fleet manager and Logistics
  });

  it("a person sees only their own requests; those who handle cargo see all of them", async () => {
    const mine = await createCargoRequest(d, req2(), cargo({ description: "Requester two's parcel" }));
    expect((await listCargo(d, req())).map((r) => r.id)).not.toContain(mine.id);
    expect((await listCargo(d, req2())).map((r) => r.id)).toContain(mine.id);
    expect((await listCargo(d, logi())).map((r) => r.id)).toContain(mine.id);
    expect(await getCargo(d, req(), mine.id)).toBeNull();
    expect(await listCargo(d, aud()).catch((e) => e)).toBeInstanceOf(ForbiddenError);
  });
});

describe("acting on a request", () => {
  it("is accepted by a handler, followed to the door, and the asker is told at each step", async () => {
    const { id } = await createCargoRequest(d, req(), cargo());
    expect(await transitionCargo(d, req(), id, "accepted").catch((e) => e)).toBeInstanceOf(ForbiddenError);
    await transitionCargo(d, logi(), id, "accepted", "We will send the truck");
    expect(await status(id)).toBe("accepted");
    await transitionCargo(d, logi(), id, "in_transit");
    await transitionCargo(d, logi(), id, "delivered");
    expect(await status(id)).toBe("delivered");
    const told = await raw(async (q) => (await q.query<{ kind: string }>("select kind from notifications where user_id = $1 and payload->>'cargo_id' = $2 order by created_at", [U(91), id])).rows.map((r) => r.kind));
    expect(told).toEqual(["cargo.accepted", "cargo.in_transit", "cargo.delivered"]);
    expect((await getCargo(d, mgr(), id))!.events.map((e) => e.to_status)).toEqual(["requested", "accepted", "in_transit", "delivered"]);
  });

  it("a handler cannot accept or reject their own request; a reason is needed to reject or cancel; steps cannot be skipped", async () => {
    const own = await createCargoRequest(d, mgr(), cargo());
    expect((await transitionCargo(d, mgr(), own.id, "accepted").catch((e) => e)).message).toMatch(/cannot decide your own/);
    await transitionCargo(d, logi(), own.id, "accepted");                            // someone else can
    const other = await createCargoRequest(d, req(), cargo());
    expect((await transitionCargo(d, mgr(), other.id, "rejected").catch((e) => e)).message).toMatch(/reason of at least 5/);
    expect((await transitionCargo(d, mgr(), other.id, "delivered").catch((e) => e)).message).toMatch(/Illegal cargo transition/);
    await transitionCargo(d, mgr(), other.id, "rejected", "No vehicle free that week");
    expect((await getCargo(d, req(), other.id))!.decision_note).toBe("No vehicle free that week");
  });

  it("the person who asked may cancel their own request while it waits, and not once it is accepted", async () => {
    const a = await createCargoRequest(d, req(), cargo());
    await transitionCargo(d, req(), a.id, "cancelled", "Plans changed");
    expect(await status(a.id)).toBe("cancelled");
    const b = await createCargoRequest(d, req(), cargo());
    expect(await transitionCargo(d, req2(), b.id, "cancelled", "Not mine to cancel").catch((e) => e)).toBeInstanceOf(ForbiddenError);
    await transitionCargo(d, logi(), b.id, "accepted");
    expect(await transitionCargo(d, req(), b.id, "cancelled", "Too late now").catch((e) => e)).toBeInstanceOf(ForbiddenError);
  });
});

describe("making a trip from a request", () => {
  it("only once accepted, prefilled from the request, linked both ways, and only once", async () => {
    const { id } = await createCargoRequest(d, req(), cargo());
    expect((await makeTripFromCargo(d, logi(), id).catch((e) => e)).message).toMatch(/Accept the request first/);
    await transitionCargo(d, logi(), id, "accepted");
    expect(await makeTripFromCargo(d, req(), id).catch((e) => e)).toBeInstanceOf(ForbiddenError);
    const tripId = await makeTripFromCargo(d, logi(), id);
    const trip = await raw(async (q) => (await q.query<{ purpose: string; from_place: string; to_place: string; status: string }>("select purpose, from_place, to_place, status from trips where id = $1", [tripId])).rows[0]);
    expect(trip).toMatchObject({ from_place: "Gulberg warehouse, Lahore", to_place: "Karachi head office", status: "requested" });
    expect(trip.purpose).toMatch(/^Cargo CR-\d+: Boxes of sample fabric \(12 cartons/);
    const c = (await getCargo(d, logi(), id))!;
    expect(c.trip_id).toBe(tripId);
    expect(c.trip_no).toMatch(/^TR-/);
    expect(c.events.at(-1)?.note).toMatch(/Trip TR-\d+ made from this request/);
    expect((await makeTripFromCargo(d, logi(), id).catch((e) => e)).message).toMatch(/already been made/);
  });
});

// ---------------------------------------------------------------- the WhatsApp menu
let seq = 0;
const msg = (text: string, from: string): InboundMessage => ({ id: `wamid.cargo.${++seq}`, from, contextId: null, text, media: [] });
const say = async (text: string, from = "+923009111111") => (await processWhatsAppMenu(d, msg(text, from))).reply;

describe("Schedule Cargo Pick-up and Delivery on WhatsApp", () => {
  it("is second on the menu", async () => {
    expect(await say("Hi")).toMatch(/1\. Submit a Job Card\n2\. Schedule Cargo Pick-up and Delivery\n3\. Reserve a Trip\n4\. Submit Odometer Readings/);
  });

  it("asks what the company's Vehicle Request Form asks, in its order, checks each answer, shows a summary, and only YES sends the request", async () => {
    await say("Hi");
    expect(await say("2")).toMatch(/Which department is this request for/);
    expect(await say("Sales")).toMatch(/When do you need the vehicle/);
    expect(await say("yesterday")).toMatch(/date and time|already passed|did not understand|Please/i);
    expect(await say("tomorrow 10am")).toMatch(/Pick-up location/);
    expect(await say("Main godown, Site 54")).toMatch(/Destination/);
    expect(await say("Unit 8, Industrial Area")).toMatch(/Which type of vehicle is required/);
    expect(await say("10-tonne truck")).toMatch(/Inventory or material load details/);
    expect(await say("Grain sacks")).toMatch(/Quantity of the load, with its unit/);
    expect(await say("18000 Lbs (180 Sacks)")).toMatch(/Person or persons to contact, with phone numbers/);
    expect(await say("Ali Khan")).toMatch(/include a phone number[\s\S]*Person or persons to contact/);                          // asked again
    expect(await say("Ali 0300 1234567 / Sara 0321 7654321")).toMatch(/special instructions/);
    const summary = await say("Unload at gate 2");
    expect(summary).toMatch(/Cargo request:[\s\S]*Department: Sales[\s\S]*Vehicle needed:[\s\S]*Type: 10-tonne truck[\s\S]*From: Main godown, Site 54[\s\S]*To: Unit 8, Industrial Area[\s\S]*Load: Grain sacks, 18000 Lbs \(180 Sacks\)[\s\S]*Contact: Ali 0300 1234567[\s\S]*Instructions: Unload at gate 2[\s\S]*Reply YES/);
    const before = (await listCargo(d, mgr())).length;
    expect(await say("yes")).toMatch(/Done\. Cargo request CR-\d+ has been sent to the fleet office/);
    const rows = await listCargo(d, mgr());
    expect(rows).toHaveLength(before + 1);
    const c = (await getCargo(d, mgr(), rows.find((r) => r.source === "whatsapp")!.id))!;
    expect(c).toMatchObject({ source: "whatsapp", department: "Sales", vehicle_type: "10-tonne truck", poc_details: "Ali 0300 1234567 / Sara 0321 7654321", instructions: "Unload at gate 2", description: "Grain sacks", quantity_text: "18000 Lbs (180 Sacks)", requester_name: "Requester One", deliver_by: null, pickup_contact: null });
    expect(c.events[0].note).toBe("Asked on WhatsApp");
  });

  it("offers the department on the person's own record, and a request with no delivery time can still be made into a trip", async () => {
    await raw((q) => q.query("update employees set department = 'Procurement' where full_name = 'Requester One'"));
    await say("Hi");
    expect(await say("2")).toMatch(/Your record says Procurement\. Reply 1 to use it/);
    await say("1"); await say("tomorrow 10am"); await say("Godown"); await say("Unit 8"); await say("Truck"); await say("Grain"); await say("180 bags"); await say("Ali 0300 1234567");
    expect(await say("skip")).toMatch(/Department: Procurement[\s\S]*No special instructions/);
    await say("yes");
    const id = (await listCargo(d, mgr())).find((r) => r.source === "whatsapp" && r.description === "Grain")!.id;
    await transitionCargo(d, logi(), id, "accepted");
    const tripId = await makeTripFromCargo(d, logi(), id);
    const trip = (await getTrip(d, mgr(), tripId))!;
    expect(Date.parse(trip.end_at) - Date.parse(trip.start_at)).toBe(12 * 3600_000);
  });

  it("SKIP works for the special instructions, and the person with no cargo permission is not offered it", async () => {
    await say("Hi"); await say("2"); await say("Sales"); await say("tomorrow 11am"); await say("Shop 4"); await say("Office"); await say("Pickup"); await say("Parcel"); await say("1 box"); await say("Ali 0300 2222222");
    expect(await say("skip")).toMatch(/No special instructions/);
    await say("cancel");
    expect(await say("Hi", "+923009444444")).toMatch(/nothing I can do for your role/);                               // an auditor
  });
});
