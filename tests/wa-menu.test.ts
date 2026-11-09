import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { processWhatsAppMenu } from "@/lib/wa-menu/engine";
import { setWaMenu, waMenuState } from "@/lib/wa-menu/switch";
import { parseDateTime, parseNumber, pickChoice } from "@/lib/wa-menu/text";
import type { InboundMessage } from "@/lib/whatsapp";

// ADR-079 phase A: the WhatsApp menu, Reserve a Trip and Submit Odometer Readings. No network: the webhook is not involved, only what it calls.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const mgr = () => mem("fleet_manager", 62);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);

const DRIVER = "+923006111111", AUDITOR = "+923006222222", SHARED = "+923006333333", NOLOGIN = "+923006555555", MANAGER = "+923006666666";
let seq = 0;
const msg = (text: string, from = DRIVER, over: Partial<InboundMessage> = {}): InboundMessage => ({ id: `wamid.${++seq}`, from, contextId: null, text, media: [], ...over });
const say = async (text: string, from = DRIVER) => (await processWhatsAppMenu(d, msg(text, from))).reply;
const sessions = () => raw(async (q) => (await q.query<{ flow: string; step: string; status: string }>("select flow, step, status from whatsapp_sessions order by created_at")).rows);
const trips = () => raw(async (q) => (await q.query<{ trip_no: string; status: string; purpose: string; from_place: string; to_place: string; passengers: number | null; preferred_vehicle_id: string | null }>(
  "select trip_no, status, purpose, from_place, to_place, passengers, preferred_vehicle_id from trips order by created_at")).rows);
const odo = () => raw(async (q) => (await q.query<{ reading_km: string; status: string; flag_reason: string | null; source: string }>("select reading_km::text, status, flag_reason, source from odometer_readings where source = 'manual' order by created_at")).rows);
const vehicleKm = (reg: string) => raw(async (q) => (await q.query<{ odometer_km: string }>("select odometer_km::text from vehicles where registration_no = $1", [reg])).rows[0].odometer_km);

let emps: Record<number, string>;

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Menu Fleet", slug: "menufleet", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  emps = {};
  for (const [n, name, phone, login] of [[61, "Driver One", "0300 6111111", true], [62, "Manager Two", "0300 6666666", true], [63, "Auditor Three", "0300 6222222", true],
    [64, "Shared A", "0300 6333333", true], [65, "Shared B", "0300 6333333", true], [66, "No Login", "0300 6555555", false]] as const) {
    emps[n] = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `M-${n}` })).id;
    await raw((q) => q.query("update employees set phone = $2 where id = $1", [emps[n], phone]));
    if (login) await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), emps[n]]));
  }
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[61, "requester"], [62, "fleet_manager"], [63, "auditor"], [64, "requester"], [65, "requester"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
    await q.query("update public.org_billing set plan_key = 'pro' where tenant_id = $1", [t.tenantId]);
  });
  await raw((q) => q.query("insert into settings(key, value) values ('module_trips','1') on conflict (key) do update set value = '1'"));
  await master.addVehicle(d, owner(), { registration_no: "WAM-001", make: "Toyota", model: "Hilux", employee_id: emps[61], holding_since: "2026-01-01" });
  await master.addVehicle(d, owner(), { registration_no: "WAM-002", make: "Honda", model: "City", employee_id: emps[62], holding_since: "2026-01-01" });
});
beforeEach(async () => { await withPlatform(d, (q) => q.query("delete from public.rate_limits")); });

describe("reading what people type", () => {
  const now = new Date("2026-11-09T05:00:00Z");                                     // 10:00 in Pakistan
  it("understands dates and times the way people write them here, in Pakistan time", () => {
    expect(parseDateTime("12/11/2026 8:30", now)).toEqual({ ok: true, value: "2026-11-12T08:30:00+05:00" });
    expect(parseDateTime("tomorrow 3pm", now)).toEqual({ ok: true, value: "2026-11-10T15:00:00+05:00" });
    expect(parseDateTime("today 11:30pm", now)).toEqual({ ok: true, value: "2026-11-09T23:30:00+05:00" });
    expect(parseDateTime("2026-11-12 08:00", now)).toEqual({ ok: true, value: "2026-11-12T08:00:00+05:00" });
    expect(parseDateTime("12 Nov 9am", now)).toEqual({ ok: true, value: "2026-11-12T09:00:00+05:00" });
  });
  it("refuses what it cannot read, a date that does not exist, no time, and a time in the past", () => {
    for (const bad of ["whenever", "31/02/2026 8:00", "12/11/2026", "tomorrow 25:00"]) expect(parseDateTime(bad, now).ok, bad).toBe(false);
    expect(parseDateTime("09/11/2026 8:00", now, { mustBeFuture: true }).ok).toBe(false);
  });
  it("reads numbers with separators and refuses the rest; picks a choice by number or words", () => {
    expect(parseNumber("48,320 km", { what: "the reading" })).toEqual({ ok: true, value: 48320 });
    expect(parseNumber("lots", { what: "the reading" }).ok).toBe(false);
    expect(parseNumber("3.5", { what: "passengers", integer: true }).ok).toBe(false);
    const list = [{ id: "a", label: "WAM-001 (Toyota Hilux)" }, { id: "b", label: "WAM-002 (Honda City)" }];
    expect(pickChoice("2", list, "a vehicle")).toMatchObject({ ok: true, value: { id: "b" } });
    expect(pickChoice("hilux", list, "a vehicle")).toMatchObject({ ok: true, value: { id: "a" } });
    expect(pickChoice("7", list, "a vehicle").ok).toBe(false);
  });
});

describe("switching it on", () => {
  it("is off until the administrator switches it on; Basic cannot; a manager cannot; it records who and when", async () => {
    expect(await say("Hi")).toBeNull();                                              // off: the other WhatsApp flows run as before
    expect((await processWhatsAppMenu(d, msg("Hi"))).handled).toBe(false);
    await withPlatform(d, (q) => q.query("update public.org_billing set plan_key = 'standard' where tenant_id = $1", [t.tenantId]));
    await expect(setWaMenu(d, owner(), true)).rejects.toThrow(/part of the Pro plan/);
    await withPlatform(d, (q) => q.query("update public.org_billing set plan_key = 'pro' where tenant_id = $1", [t.tenantId]));
    await expect(setWaMenu(d, mgr(), true)).rejects.toBeInstanceOf(ForbiddenError);
    await setWaMenu(d, owner(), true);
    expect(await waMenuState(d, owner())).toEqual({ on: true, pro: true });
    const row = await withPlatform(d, async (q) => (await q.query<{ wa_menu_by: string; wa_menu_at: string }>("select wa_menu_by, wa_menu_at::text from public.tenants where id = $1", [t.tenantId])).rows[0]);
    expect(row.wa_menu_by).toBe(U(1));
    expect(row.wa_menu_at).toBeTruthy();
  });
  it("stops answering when the plan drops to Basic", async () => {
    await withPlatform(d, (q) => q.query("update public.org_billing set plan_key = 'standard' where tenant_id = $1", [t.tenantId]));
    expect((await processWhatsAppMenu(d, msg("Hi"))).handled).toBe(false);
    await withPlatform(d, (q) => q.query("update public.org_billing set plan_key = 'pro' where tenant_id = $1", [t.tenantId]));
  });
});

describe("who gets the menu", () => {
  it("a known employee saying Hi gets the list of what their role may do", async () => {
    const r = await say("Hi");
    expect(r).toMatch(/Hello Driver, this is Fleet OTG for Menu Fleet/);
    expect(r).toContain("1. Reserve a Trip");
    expect(r).toContain("2. Submit Odometer Readings");
    expect((await sessions()).at(-1)).toMatchObject({ flow: "menu", step: "choose", status: "open" });
  });
  it("a number nobody has, and an employee with no login, get nothing from here", async () => {
    expect((await processWhatsAppMenu(d, msg("Hi", "+923009999999"))).handled).toBe(false);
    expect((await processWhatsAppMenu(d, msg("Hi", NOLOGIN))).handled).toBe(false);
  });
  it("a number shared by two employees is never guessed", async () => {
    expect(await say("Hello", SHARED)).toMatch(/used by more than one person/);
    expect(await sessions()).not.toContainEqual(expect.objectContaining({ step: "choose", flow: "menu", status: "open", employee: emps[64] }));
  });
  it("a role that may do nothing here is told to use the app, and no conversation opens", async () => {
    const before = (await sessions()).length;
    expect(await say("Hi", AUDITOR)).toMatch(/nothing I can do for your role/);
    expect((await sessions()).length).toBe(before);
  });
  it("Reserve a Trip is not offered while the trips module is off", async () => {
    await raw((q) => q.query("update settings set value = '0' where key = 'module_trips'"));
    try { const r = await say("Hi"); expect(r).not.toContain("Reserve a Trip"); expect(r).toContain("1. Submit Odometer Readings"); }
    finally { await raw((q) => q.query("update settings set value = '1' where key = 'module_trips'")); }
  });
});

describe("Reserve a Trip", () => {
  it("asks each question in turn, checks the answers, shows a summary, and only YES creates the request", async () => {
    await say("Hi");
    expect(await say("1")).toMatch(/What is the trip for/);
    expect(await say("Deliver samples to the Karachi office")).toMatch(/Where does it start/);
    expect(await say("Lahore")).toMatch(/Where is it going/);
    expect(await say("Karachi")).toMatch(/When does it leave/);
    expect(await say("whenever you like")).toMatch(/include the time[\s\S]*When does it leave/);                // asked again, never guessed
    expect(await say("tomorrow 8am")).toMatch(/back/);
    expect(await say("tomorrow 7am")).toMatch(/return must be after the departure/);
    expect(await say("tomorrow 6pm")).toMatch(/How many passengers/);
    expect(await say("many")).toMatch(/as a number/);
    expect(await say("3")).toMatch(/prefer a vehicle[\s\S]*1\. WAM-001 \(Toyota Hilux\)/);
    const summary = await say("skip");
    expect(summary).toMatch(/Trip request:[\s\S]*Deliver samples[\s\S]*Lahore to Karachi[\s\S]*Passengers: 3[\s\S]*No preferred vehicle[\s\S]*Reply YES/);
    expect(await trips()).toHaveLength(0);                                           // nothing exists before YES
    expect(await say("maybe")).toMatch(/Reply YES to send it/);
    const done = await say("YES");
    expect(done).toMatch(/Done\. Trip TR-\d+ has been requested/);
    const [trip] = await trips();
    expect(trip).toMatchObject({ status: "requested", purpose: "Deliver samples to the Karachi office", from_place: "Lahore", to_place: "Karachi", passengers: 3 });
    expect((await sessions()).at(-1)?.status).toBe("done");
  });

  it("YES creates exactly one trip even when the same message is delivered twice, and a later YES creates nothing", async () => {
    const before = (await trips()).length;
    await say("Hi"); await say("1"); await say("Collect parts"); await say("Lahore"); await say("Multan"); await say("tomorrow 8am"); await say("tomorrow 5pm"); await say("skip");
    expect(await say("skip")).toMatch(/Reply YES/);
    const yes = msg("yes");
    expect((await processWhatsAppMenu(d, yes)).reply).toMatch(/Done/);
    expect((await processWhatsAppMenu(d, yes)).reply).toBeNull();                    // Meta repeated it
    expect(await say("yes")).toMatch(/Hello Driver/);                                // no conversation open: the menu, not a second trip
    expect(await trips()).toHaveLength(before + 1);
  });

  it("BACK steps back one question, CANCEL stops with nothing sent, MENU returns to the list", async () => {
    const before = (await trips()).length;
    await say("Hi"); await say("1"); await say("A trip"); await say("Lahore");
    expect(await say("back")).toMatch(/Where does it start/);
    expect(await say("Faisalabad")).toMatch(/Where is it going/);
    expect(await say("cancel")).toMatch(/Cancelled\. Nothing was sent/);
    expect(await trips()).toHaveLength(before);
    await say("Hi"); await say("1"); await say("Another trip");
    expect(await say("menu")).toMatch(/What would you like to do/);
    expect((await sessions()).filter((s) => s.status === "open")).toHaveLength(1);   // one conversation at a time
  });

  it("a conversation that goes quiet for 30 minutes lapses, and the person is told how to start again", async () => {
    await say("Hi"); await say("1"); await say("Visit supplier");
    await raw((q) => q.query("update whatsapp_sessions set expires_at = now() - interval '1 minute' where status = 'open'"));
    expect(await say("Lahore")).toMatch(/timed out after 30 minutes\. Say Hi to start again/);
    expect(await say("Hi")).toMatch(/What would you like to do/);
  });

  it("a person who may not request trips cannot be sent into the flow, even by typing its number after the module is switched off", async () => {
    await say("Hi");
    await raw((q) => q.query("update settings set value = '0' where key = 'module_trips'"));
    try { expect(await say("1")).toMatch(/not available to you any more/); } finally { await raw((q) => q.query("update settings set value = '1' where key = 'module_trips'")); }
  });

  it("a chosen vehicle is kept on the request", async () => {
    await say("Hi"); await say("1"); await say("Site visit"); await say("Lahore"); await say("Sheikhupura"); await say("tomorrow 9am"); await say("tomorrow 4pm"); await say("skip");
    expect(await say("1")).toMatch(/Preferred vehicle: WAM-001/);
    await say("yes");
    expect((await trips()).at(-1)?.preferred_vehicle_id).toBeTruthy();
  });
});

describe("Submit Odometer Readings", () => {
  it("asks which vehicle and the reading, and YES records it through the same table and checks as every reading", async () => {
    await say("Hi");
    expect(await say("2")).toMatch(/Which vehicle\?[\s\S]*1\. WAM-001 \(Toyota Hilux\)/);
    expect(await say("WAM-999")).toMatch(/could not find that vehicle/);
    expect(await say("1")).toMatch(/odometer show on WAM-001 now/);
    expect(await say("lots")).toMatch(/as a number/);
    expect(await say("43,500")).toMatch(/Odometer reading:[\s\S]*WAM-001[\s\S]*43,500 km[\s\S]*Reply YES/);
    expect(await odo()).toHaveLength(0);
    expect(await say("yes")).toMatch(/Done\. 43,500 km recorded for WAM-001/);
    expect((await odo()).at(-1)).toMatchObject({ reading_km: "43500.0", status: "accepted", source: "manual" });
    expect(await vehicleKm("WAM-001")).toBe("43500.0");
  });

  it("a reading below the last one is kept but flagged for the fleet office, and does not move the odometer", async () => {
    await say("Hi"); await say("2"); await say("wam001"); await say("40000");
    expect(await say("yes")).toMatch(/lower than the last reading \(the last reading was 43,500 km\), so the fleet office will review/);
    expect((await odo()).at(-1)).toMatchObject({ status: "flagged", flag_reason: "lower_than_previous" });
    expect(await vehicleKm("WAM-001")).toBe("43500.0");
  });

  it("a person limited to their own vehicles cannot send a reading for someone else's", async () => {
    await withPlatform(d, (q) => q.query("update public.tenant_memberships set vehicle_scope = 'own' where user_id = $1 and tenant_id = $2", [U(61), t.tenantId]));
    try {
      await say("Hi"); await say("2");
      expect(await say("WAM-002")).toMatch(/could not find that vehicle/);
    } finally { await withPlatform(d, (q) => q.query("update public.tenant_memberships set vehicle_scope = 'all' where user_id = $1 and tenant_id = $2", [U(61), t.tenantId])); }
  });

  it("a manager, who holds another vehicle, sees that one", async () => {
    await say("Hi", MANAGER);
    expect(await say("2", MANAGER)).toMatch(/1\. WAM-002 \(Honda City\)/);
    await say("cancel", MANAGER);
  });
});

describe("what the menu does not do", () => {
  const closeAll = () => raw((q) => q.query("update whatsapp_sessions set status = 'cancelled', closed_at = now() where status in ('open', 'submitting')"));
  it("a reply to one of our other messages with nothing open is left to the other flows", async () => {
    await closeAll();
    expect((await processWhatsAppMenu(d, msg("43500", DRIVER, { contextId: "wamid.somethingelse" }))).handled).toBe(false);
  });
  it("a photo with no words and nothing open is left alone; with a question open it asks for typing", async () => {
    await closeAll();
    expect((await processWhatsAppMenu(d, msg("", DRIVER, { media: [{ id: "123456", filename: null, mime: "image/jpeg" }] }))).handled).toBe(false);
    await say("Hi"); await say("2");
    expect((await processWhatsAppMenu(d, msg("", DRIVER, { media: [{ id: "123456", filename: null, mime: "image/jpeg" }] }))).reply).toMatch(/type your answer/);
    await say("cancel");
  });
  it("too many messages in an hour are slowed down", async () => {
    let last: string | null = null;
    for (let i = 0; i < 42; i++) last = await say("Hi");
    expect(last).toMatch(/lot of messages/);
  });
});
