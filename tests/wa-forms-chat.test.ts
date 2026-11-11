import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import type { Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { getCargo, listCargo } from "@/lib/cargo/service";
import { processWhatsAppMenu } from "@/lib/wa-menu/engine";
import type { PhotoDeps } from "@/lib/wa-menu/photos";
import type { InboundMessage } from "@/lib/whatsapp";

// ADR-084: cargo, trips and job cards by a WhatsApp form (a Flow): one message from the sender instead of one per question.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
const FROM = "+923007111111";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const owner = (): Membership => ({ ...t, userId: U(1), role: "tenant_admin", vehicleScope: "all" });
const mgr = (): Membership => ({ ...t, userId: U(72), role: "fleet_manager", vehicleScope: "all" });
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);
const stored: string[] = [];
const photos: PhotoDeps = { fetchMedia: async () => ({ bytes: JPEG, mime: "image/jpeg" }), store: async (p) => { stored.push(p); }, newId: (() => { let i = 0; return () => `00000000-0000-4000-8000-${String(++i).padStart(12, "0")}`; })() };
let seq = 0;
const out = (text: string, flow?: Record<string, string>, media: InboundMessage["media"] = []) => processWhatsAppMenu(d, { id: `wamid.form.${++seq}`, from: FROM, contextId: null, text, media, ...(flow ? { flow } : {}) }, { photos });
const env0 = { ...process.env };
const open = async (label: RegExp) => {
  await withPlatform(d, (q) => q.query("delete from public.rate_limits"));          // the menu's hourly limit is not what these tests are about
  await out("cancel");
  const menu = (await out("Hi")).reply ?? "";
  const n = new RegExp(`(\\d+)\\. ${label.source}`).exec(menu)?.[1];
  if (!n) throw new Error(`not in the menu: ${menu}`);
  return out(n);
};
const cards = () => raw(async (q) => (await q.query<{ job_no: string; source: string; category: string; cause_text: string; priority: string; needed_by: string | null; odometer_km: string | null }>(
  "select job_no, source, category, cause_text, priority, needed_by::text, odometer_km::text from job_cards where source = 'whatsapp' order by created_at")).rows);

beforeAll(async () => {
  Object.assign(process.env, { WHATSAPP_FORM_CARGO: "5550001", WHATSAPP_FORM_TRIP: "5550002", WHATSAPP_FORM_JOBCARD: "5550003" });
  d = await testDriver();
  t = await provisionTenant(d, { name: "Forms Fleet", slug: "formsfleet", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  const emp = (await master.saveEmployee(d, owner(), { full_name: "Form Requester", employee_no: "F-1" })).id;
  await raw((q) => q.query("update employees set user_id = $1, phone = '0300 7111111' where id = $2", [U(71), emp]));
  const mgrEmp = (await master.saveEmployee(d, owner(), { full_name: "Form Manager", employee_no: "F-2" })).id;
  await raw((q) => q.query("update employees set user_id = $1, phone = '0300 7222222' where id = $2", [U(72), mgrEmp]));
  await withPlatform(d, async (q) => {
    await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'requester'), ($3, $2, 'fleet_manager')", [U(71), t.tenantId, U(72)]);
    await q.query("update public.org_billing set plan_key = 'pro' where tenant_id = $1", [t.tenantId]);
    await q.query("update public.tenants set wa_menu_enabled = true where id = $1", [t.tenantId]);
  });
  await raw((q) => q.query("insert into settings(key, value) values ('module_trips','1') on conflict (key) do update set value = '1'"));
  await master.addVehicle(d, owner(), { registration_no: "FRM-001", make: "Suzuki", model: "Bolan", employee_id: emp, holding_since: "2026-01-01", odometer_km: "42000" });
});
afterAll(() => { process.env = { ...env0 }; });

const cargoAnswers = (token: string, over: Record<string, string> = {}) => ({
  flow_token: token, department: "Sales", date: "2031-08-20", time: "09:30", pickup: "Main godown, Site 54", drop: "Unit 8, Industrial Area", vehicle: "truck",
  material: "Grain sacks", quantity: "180", unit: "bags", contact: "Ali 0300 1234567 / Sara 0321 7654321", instructions: "Unload at gate 2", ...over,
});

describe("cargo by a form", () => {
  it("sends the form instead of the first question, with the conversation's token, and the same words as text if it cannot be sent", async () => {
    const o = await open(/Schedule Cargo Pick-up and Delivery/);
    expect(o.form).toMatchObject({ flowId: "5550001", screen: "WHEN_WHERE", cta: "Open form" });
    expect(o.form!.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(o.form!.body).toMatch(/Cargo Pick-up and Delivery[\s\S]*reply TEXT/i);
    expect(o.reply).toMatch(/could not open the form[\s\S]*Reply TEXT/);
    expect(o.form!.draft).toBeUndefined();
    await out("cancel");
  });

  it("makes the request from one form message, as the chat does", async () => {
    const o = await open(/Schedule Cargo Pick-up and Delivery/);
    const before = (await listCargo(d, mgr())).length;
    const done = await out("", cargoAnswers(o.form!.token));
    expect(done.reply).toMatch(/Done\. Cargo request CR-\d+ has been sent to the fleet office/);
    const rows = await listCargo(d, mgr());
    expect(rows).toHaveLength(before + 1);
    const c = (await getCargo(d, mgr(), rows.find((r) => r.description === "Grain sacks")!.id))!;
    expect(c).toMatchObject({ source: "whatsapp", department: "Sales", vehicle_type: "Truck (to 10 tonnes)", quantity_text: "180 bags", poc_details: "Ali 0300 1234567 / Sara 0321 7654321", instructions: "Unload at gate 2", pickup_place: "Main godown, Site 54", drop_place: "Unit 8, Industrial Area" });
    expect(Date.parse(c.pickup_at)).toBe(Date.parse("2031-08-20T09:30:00+05:00"));
    expect((await out("Hi")).reply).toMatch(/What would you like to do/);                                          // the conversation ended with the request
  });

  it("takes the weight from the form: given in kg, or worked out when the quantity is a weight, or left empty (ADR-092)", async () => {
    const weightOf = async (material: string) => (await getCargo(d, mgr(), (await listCargo(d, mgr())).find((r) => r.description === material)!.id))!.weight_kg;
    const send = async (over: Record<string, string>) => { const o = await open(/Schedule Cargo Pick-up and Delivery/); return out("", cargoAnswers(o.form!.token, over)); };
    expect((await send({ material: "W direct", weight: "2,500" })).reply).toMatch(/Done\./);
    expect(await weightOf("W direct")).toBe("2500.0");
    expect((await send({ material: "W tonnes", quantity: "3", unit: "tonnes" })).reply).toMatch(/Done\./);
    expect(await weightOf("W tonnes")).toBe("3000.0");
    expect((await send({ material: "W lbs", quantity: "18000", unit: "lbs" })).reply).toMatch(/Done\./);
    expect(await weightOf("W lbs")).toBe("8164.7");
    expect((await send({ material: "W bags" })).reply).toMatch(/Done\./);                                     // bags are not a weight
    expect(await weightOf("W bags")).toBeNull();
    expect((await send({ material: "W bad", weight: "heavy" })).reply).toMatch(/weight in kilograms/i);          // a bad weight comes back with a reason
    await out("cancel");
  });

  it("checks every answer again: a past time, no phone number, no unit, a made-up vehicle, a bad quantity: each comes back with a reason and the form again", async () => {
    const o = await open(/Schedule Cargo Pick-up and Delivery/);
    for (const [over, why] of [[{ date: "2020-01-01" }, /already passed/], [{ contact: "Ali Khan" }, /phone number/], [{ unit: "" }, /choose a unit/], [{ vehicle: "rocket" }, /vehicle type/], [{ quantity: "lots" }, /quantity/]] as const) {
      const r = await out("", cargoAnswers(o.form!.token, over));
      expect(r.reply).toMatch(why);
      expect(r.form?.token).toBe(o.form!.token);
    }
    await out("cancel");
  });

  it("ignores a form that is not for this conversation, points back to the form for other words, and TEXT turns to the questions", async () => {
    await open(/Schedule Cargo Pick-up and Delivery/);
    expect((await out("", cargoAnswers("not-the-token"))).reply).toMatch(/earlier request/);
    expect((await out("hello?")).reply).toMatch(/tap the button on the form[\s\S]*TEXT/i);
    expect((await out("TEXT")).reply).toMatch(/Which department is this request for/);
    expect((await out("Sales")).reply).toMatch(/When do you need the vehicle/);                                  // the chat questions carry on as before
    await out("cancel");
  });

  it("without the form's id in the environment, the questions are asked in the chat as before", async () => {
    delete process.env.WHATSAPP_FORM_CARGO;
    try {
      const o = await open(/Schedule Cargo Pick-up and Delivery/);
      expect(o.form).toBeUndefined();
      expect(o.reply).toMatch(/Which department is this request for/);
      await out("cancel");
    } finally { process.env.WHATSAPP_FORM_CARGO = "5550001"; }
  });

  it("a draft form (testing) is marked as one when the environment says so", async () => {
    process.env.WHATSAPP_FORMS_DRAFT = "1";
    try { expect((await open(/Schedule Cargo Pick-up and Delivery/)).form!.draft).toBe(true); await out("cancel"); }
    finally { delete process.env.WHATSAPP_FORMS_DRAFT; }
  });
});

describe("a trip by a form", () => {
  it("is reserved from one form message, and a return before the departure is sent back", async () => {
    const o = await open(/Reserve a Trip/);
    expect(o.form).toMatchObject({ flowId: "5550002", screen: "TRIP" });
    const before = Number((await raw((q) => q.query<{ n: string }>("select count(*)::text n from trips"))).rows[0].n);
    const trip = { purpose: "Deliver samples to the Karachi office", from: "Lahore", to: "Karachi", start_date: "2031-08-21", start_time: "08:00", end_date: "2031-08-22", end_time: "18:00", passengers: "2" };
    const r = await out("", { flow_token: o.form!.token, ...trip });
    expect(r.reply).toMatch(/Done\. Trip TR-\d+ has been requested/);
    expect(Number((await raw((q) => q.query<{ n: string }>("select count(*)::text n from trips"))).rows[0].n)).toBe(before + 1);
    const again = await open(/Reserve a Trip/);
    expect((await out("", { flow_token: again.form!.token, ...trip, end_date: "2031-08-21", end_time: "07:00" })).reply).toMatch(/return must be after the departure/);
    await out("cancel");
  });
});

describe("a job card by a form", () => {
  const jc = (token: string, over: Record<string, string> = {}) => ({ flow_token: token, vehicle: "frm-001", work: "brakes", explain: "", km: "43000", urgency: "high", needed_by: "2031-12-15", ...over });

  it("is raised from one form message plus the photos if there are any; the form was the confirmation, so there is no summary to approve", async () => {
    const o = await open(/Submit a Job Card/);
    expect(o.form).toMatchObject({ flowId: "5550003", screen: "JOB" });
    const asked = await out("", jc(o.form!.token));
    expect(asked.reply).toMatch(/Send up to 3 photos/);                                                        // photos cannot go in a form, so they are asked for after it
    expect((await out("", undefined, [{ id: "11111", filename: null, mime: null }])).reply).toMatch(/Got it: 1 of 3 photos/);
    const before = (await cards()).length;
    const done = await out("done");
    expect(done.reply).toMatch(/Done\. Job card JC-\d+ has been raised for FRM-001 and sent for approval/);
    const all = await cards();
    expect(all).toHaveLength(before + 1);
    expect(all.at(-1)).toMatchObject({ source: "whatsapp", category: "corrective", cause_text: "Requested work: Brake work.", priority: "high", needed_by: "2031-12-15", odometer_km: "43000.0" });
    expect(stored.length).toBe(1);
  });

  it("SKIP on the photos sends it at once; Others needs an explanation of up to 100 words; a wrong registration number is sent back", async () => {
    const o = await open(/Submit a Job Card/);
    expect((await out("", jc(o.form!.token, { work: "others", explain: "" }))).reply).toMatch(/at least 10 characters/);
    expect((await out("", jc(o.form!.token, { work: "others", explain: Array(101).fill("word").join(" ") }))).reply).toMatch(/101 words/);
    expect((await out("", jc(o.form!.token, { vehicle: "ZZZ-999" }))).reply).toMatch(/could not find that vehicle/);
    expect((await out("", jc(o.form!.token, { work: "others", explain: "Clutch slips when climbing a slope", needed_by: "" }))).reply).toMatch(/Send up to 3 photos/);
    const before = (await cards()).length;
    expect((await out("skip")).reply).toMatch(/Done\. Job card/);
    const last = (await cards()).at(-1)!;
    expect((await cards()).length).toBe(before + 1);
    expect(last).toMatchObject({ cause_text: "Clutch slips when climbing a slope", needed_by: null });
  });
});
