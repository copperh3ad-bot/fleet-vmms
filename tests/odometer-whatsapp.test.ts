import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import type { Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import * as ctl from "@/lib/control/service";
import { findTenantByToken } from "@/lib/orgs";
import * as hrs from "@/lib/hours/service";
import { parseReading, processOdometerReply, runOdometerWhatsApp } from "@/lib/odometer/whatsapp";
import { waReplyHash } from "@/lib/vendorflow/whatsapp-inbound";
import type { InboundMessage } from "@/lib/whatsapp";

// ADR-050: the monthly odometer request on WhatsApp, answered by a reply. Hour-meter vehicles are left out.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);

const KEYS = ["WHATSAPP_FILE", "ALLOW_FILE_MAILER", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_ODOMETER_TEMPLATE"];
const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const sent: { to: string; plate: string; reminder: boolean; id: string }[] = [];
let n = 0;
const fakeSend = async (to: string, m: { name: string; plate: string; month: string; reminder?: boolean }) => { const id = `wamid.TEST${++n}`; sent.push({ to, plate: m.plate, reminder: !!m.reminder, id }); return id; };
const today = new Date();
const noon = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 4));          // the 1st: on or after any send day we set

let v1: string, forklift: string;
const sub = (plate: string) => raw(async (q) => (await q.query<{ id: string; status: string; reading_km: string | null }>(
  "select s.id, s.status, s.reading_km::text from odometer_submissions s join vehicles v on v.id = s.vehicle_id where v.registration_no = $1", [plate])).rows[0]);
const odo = (id: string) => raw(async (q) => (await q.query<{ o: string }>("select odometer_km::text o from vehicles where id = $1", [id])).rows[0].o);
const msg = (over: Partial<InboundMessage>): InboundMessage => ({ id: `in${++n}`, from: "923001234567", contextId: null, text: "", media: [], ...over });
const wamidOf = (plate: string) => sent.filter((s) => s.plate === plate).at(-1)!.id;

beforeAll(async () => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, { WHATSAPP_FILE: "/dev/null", ALLOW_FILE_MAILER: "1", WHATSAPP_ODOMETER_TEMPLATE: "fleetotg_odometer" });
  d = await testDriver();
  t = await provisionTenant(d, { name: "Odo WA Co", slug: "odowa", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  const ali = await master.saveEmployee(d, owner(), { full_name: "Ali Driver", employee_no: "E-1", phone: "+92 300 1234567" });
  const sara = await master.saveEmployee(d, owner(), { full_name: "Sara Driver", employee_no: "E-2", phone: "0321 7654321" });
  const noPhone = await master.saveEmployee(d, owner(), { full_name: "No Phone", employee_no: "E-3" });
  const mk = (plate: string, e: { id: string } | null, cls = "truck") => master.addVehicle(d, owner(), { registration_no: plate, odometer_km: "1000", vehicle_class: cls, ...(e ? { employee_id: e.id, holding_since: "2026-01-01" } : {}) }).then((v) => v.id);
  v1 = await mk("WA-1", ali); await mk("WA-2", sara); await mk("WA-3", noPhone);
  await mk("WA-NOHOLDER", null);
  forklift = await mk("WA-FLT", ali, "forklift");
  await hrs.setTracksHours(d, owner(), forklift, true);
});
afterAll(() => { for (const k of KEYS) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } });

describe("the monthly request", () => {
  it("does nothing while the feature is off, and while it is not yet the send day", async () => {
    expect(await runOdometerWhatsApp(d, noon, fakeSend)).toEqual([expect.objectContaining({ sent: 0, opened: false })]);
    expect(sent).toHaveLength(0);
    await ctl.saveSettings(d, owner(), { odometer_whatsapp: "1", odometer_send_day: "28" });
    const r = await runOdometerWhatsApp(d, noon, fakeSend);          // the 1st is before the 28th
    expect(r[0]).toMatchObject({ sent: 0, opened: false });
    expect(sent).toHaveLength(0);
  });

  it("opens the month and asks each holder with a phone, leaving out hour-meter vehicles, vehicles with no holder and holders with no phone", async () => {
    await ctl.saveSettings(d, owner(), { odometer_send_day: "1" });
    const r = await runOdometerWhatsApp(d, noon, fakeSend);
    expect(r[0]).toMatchObject({ opened: true, sent: 2, reminded: 0, failed: 0 });
    expect(sent.map((s) => s.plate).sort()).toEqual(["WA-1", "WA-2"]);
    expect(sent.find((s) => s.plate === "WA-2")!.to).toBe("+923217654321");          // a local number is made international
    expect(sent.some((s) => s.plate === "WA-FLT" || s.plate === "WA-3")).toBe(false);
    const wa = await raw(async (q) => (await q.query<{ c: number }>("select count(*)::int c from odometer_wa_messages where kind = 'request'")).rows[0].c);
    expect(wa).toBe(2);
    expect(await findTenantByToken(d, "odoreply", waReplyHash(wamidOf("WA-1")))).toMatchObject({ id: t.tenantId });          // a reply finds its organization
  });

  it("asks once: running again the same day sends nothing", async () => {
    const r = await runOdometerWhatsApp(d, noon, fakeSend);
    expect(r[0]).toMatchObject({ opened: false, sent: 0, reminded: 0 });
    expect(sent).toHaveLength(2);
  });

  it("reminds once, after three days, only those who have not answered", async () => {
    await raw((q) => q.query("update odometer_wa_messages set sent_at = now() - interval '4 days'"));
    expect(await runOdometerWhatsApp(d, new Date(), fakeSend)).toEqual([expect.objectContaining({ sent: 0, reminded: 2 })]);          // the real clock: the messages were back-dated from it
    expect(sent.filter((s) => s.reminder)).toHaveLength(2);
    await raw((q) => q.query("update odometer_wa_messages set sent_at = now() - interval '9 days'"));
    expect(await runOdometerWhatsApp(d, new Date(), fakeSend)).toEqual([expect.objectContaining({ sent: 0, reminded: 0 })]);          // never a second reminder
  });

  it("counts a message that fails and goes on with the rest, without putting a number in the error", async () => {
    await ctl.saveSettings(d, owner(), { odometer_whatsapp: "1" });
    await raw((q) => q.query("delete from odometer_wa_messages where submission_id = (select s.id from odometer_submissions s join vehicles v on v.id = s.vehicle_id where v.registration_no = 'WA-2')"));
    const failing = async () => { throw new Error("whatsapp failed: 400 (code 130497: restricted)"); };
    expect(await runOdometerWhatsApp(d, noon, failing)).toEqual([expect.objectContaining({ sent: 0, failed: 1 })]);
    expect(await runOdometerWhatsApp(d, new Date(), fakeSend)).toEqual([expect.objectContaining({ sent: 1, failed: 0 })]);          // tomorrow's run asks again
  });
});

describe("the driver's reply", () => {
  it("files the number as a submission for review and moves no odometer", async () => {
    const out = await processOdometerReply(d, msg({ contextId: wamidOf("WA-1"), text: "1,250 km" }));
    expect(out).toEqual({ handled: true, reply: expect.stringContaining("1,250 km for WA-1") });
    expect(await sub("WA-1")).toMatchObject({ status: "submitted", reading_km: "1250.0" });
    expect(await odo(v1)).toBe("1000.0");
  });

  it("answers a second reply without changing the first", async () => {
    const out = await processOdometerReply(d, msg({ contextId: wamidOf("WA-1"), text: "9999" }));
    expect(out).toEqual({ handled: true, reply: expect.stringContaining("already have a reading") });
    expect((await sub("WA-1")).reading_km).toBe("1250.0");
  });

  it("says nothing to a number that is not the holder's, and saves nothing", async () => {
    const out = await processOdometerReply(d, msg({ from: "923009999999", contextId: wamidOf("WA-2"), text: "2000" }));
    expect(out).toEqual({ handled: true, reply: null });
    expect((await sub("WA-2")).status).toBe("pending");
  });

  it("asks again for a message that is not just a number, and saves nothing", async () => {
    const from = "923217654321";
    for (const text of ["ok thanks", "about 2000 maybe", "12x", ""]) {
      expect(await processOdometerReply(d, msg({ from, contextId: wamidOf("WA-2"), text }))).toEqual({ handled: true, reply: expect.stringContaining("number only") });
    }
    expect(await processOdometerReply(d, msg({ from, contextId: wamidOf("WA-2"), text: "2000", media: [{ id: "m1", filename: null, mime: "image/jpeg" }] }))).toMatchObject({ handled: true, reply: expect.stringContaining("number only") });
    expect((await sub("WA-2")).status).toBe("pending");
    expect(await processOdometerReply(d, msg({ from, contextId: wamidOf("WA-2"), text: "1500.5 kms" }))).toMatchObject({ reply: expect.stringContaining("WA-2") });
    expect(await sub("WA-2")).toMatchObject({ status: "submitted", reading_km: "1500.5" });
  });

  it("ignores messages that are not replies to an odometer request, so workshop replies still get their turn", async () => {
    expect(await processOdometerReply(d, msg({ text: "1250" }))).toEqual({ handled: false });          // no Reply used
    expect(await processOdometerReply(d, msg({ contextId: "wamid.NOT-OURS", text: "1250" }))).toEqual({ handled: false });
  });

  it("the reading is then approved like any other, and only then moves the odometer", async () => {
    const approver = mem("fleet_manager", 12);
    const od = await import("@/lib/odometer/service");
    await od.reviewReading(d, approver, (await sub("WA-1")).id, "approve");
    expect(await odo(v1)).toBe("1250.0");
  });
});

describe("reading a number", () => {
  it("accepts a plain number with commas, spaces and km, and nothing else", () => {
    for (const [text, want] of [["48210", 48210], [" 48,210 ", 48210], ["48 210 km", 48210], ["12.5", 12.5], ["1,250.5 Kms.", 1250.5], ["0", 0]] as const) expect(parseReading(text)).toBe(want);
    for (const text of ["", "km", "12.55", "-5", "1e5", "abc 12", "12 abc", "99999999", "12/5", "1,2,3x"]) expect(parseReading(text)).toBeNull();
  });
});
