import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import type { Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { processWhatsAppMenu } from "@/lib/wa-menu/engine";
import type { PhotoDeps } from "@/lib/wa-menu/photos";
import { parseDate } from "@/lib/wa-menu/text";
import type { InboundMessage } from "@/lib/whatsapp";

// ADR-079 phase B: Submit a Job Card by answering questions, with up to three photos. The photos are fakes; no network.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const owner = (): Membership => ({ ...t, userId: U(1), role: "tenant_admin", vehicleScope: "all" });
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);
const DRIVER = "+923008111111";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const stored: string[] = [];
const photos: PhotoDeps = {
  fetchMedia: async (id) => id.startsWith("pdf") ? { bytes: new Uint8Array([37, 80, 68, 70]), mime: "application/pdf" } : id.startsWith("big") ? { bytes: new Uint8Array(5 * 1024 * 1024 + 1), mime: "image/jpeg" } : { bytes: JPEG, mime: "image/jpeg" },
  store: async (path) => { stored.push(path); },
  newId: (() => { let i = 0; return () => `00000000-0000-4000-8000-${String(++i).padStart(12, "0")}`; })(),
};
let seq = 0;
const msg = (text: string, media: InboundMessage["media"] = []): InboundMessage => ({ id: `wamid.${++seq}`, from: DRIVER, contextId: null, text, media });
const say = async (text: string) => (await processWhatsAppMenu(d, msg(text), { photos })).reply;
const send = async (...ids: string[]) => (await processWhatsAppMenu(d, msg("", ids.map((id) => ({ id, filename: null, mime: null }))), { photos })).reply;
const start = async () => {
  const menu = (await say("Hi")) ?? "";
  const n = /(\d)\. Submit a Job Card/.exec(menu)?.[1];
  if (!n) throw new Error(`no job card in the menu: ${menu}`);
  return say(n);
};
const cards = () => raw(async (q) => (await q.query<{ job_no: string; status: string; source: string; requested_by: string | null; cause_text: string; priority: string; category: string; needed_by: string | null; odometer_km: string | null }>(
  "select job_no, status, source, requested_by, cause_text, priority, category, needed_by::text, odometer_km::text from job_cards where source = 'whatsapp' order by created_at")).rows);
const files = (no: string) => raw(async (q) => (await q.query<{ file_name: string }>("select a.file_name from attachments a join job_cards j on j.id = a.entity_id where j.job_no = $1 and a.entity_type = 'job_card' order by a.file_name", [no])).rows.map((r) => r.file_name));
let emp: string;

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Jobcard Fleet", slug: "jcfleet", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  emp = (await master.saveEmployee(d, owner(), { full_name: "Job Driver", employee_no: "J-1" })).id;
  await raw((q) => q.query("update employees set phone = '0300 8111111', user_id = $2 where id = $1", [emp, U(81)]));
  await withPlatform(d, async (q) => {
    await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'requester')", [U(81), t.tenantId]);
    await q.query("update public.org_billing set plan_key = 'pro' where tenant_id = $1", [t.tenantId]);
    await q.query("update public.tenants set wa_menu_enabled = true where id = $1", [t.tenantId]);
  });
  await master.addVehicle(d, owner(), { registration_no: "JCW-001", make: "Suzuki", model: "Bolan", employee_id: emp, holding_since: "2026-01-01", odometer_km: "42000" });
});
beforeEach(async () => { await withPlatform(d, (q) => q.query("delete from public.rate_limits")); });

describe("reading a date without a time", () => {
  const now = new Date("2026-11-09T05:00:00Z");
  it("reads the ways people write it, and refuses a past day or nonsense", () => {
    expect(parseDate("15/11/2026", now)).toEqual({ ok: true, value: "2026-11-15" });
    expect(parseDate("tomorrow", now)).toEqual({ ok: true, value: "2026-11-10" });
    expect(parseDate("15 Nov", now)).toEqual({ ok: true, value: "2026-11-15" });
    expect(parseDate("01/11/2026", now, { notPast: true }).ok).toBe(false);
    expect(parseDate("today", now, { notPast: true })).toEqual({ ok: true, value: "2026-11-09" });
    expect(parseDate("sometime", now).ok).toBe(false);
  });
});

describe("Submit a Job Card", () => {
  it("is the first thing on the menu for someone who may raise job cards", async () => {
    expect(await say("Hi")).toMatch(/1\. Submit a Job Card/);
  });

  it("asks every question the web form needs, takes photos, shows a summary, and only YES raises the card", async () => {
    expect(await start()).toMatch(/Which vehicle\?[\s\S]*1\. JCW-001 \(Suzuki Bolan\)/);
    expect(await say("JCW-999")).toMatch(/could not find that vehicle/);
    expect(await say("1")).toMatch(/What kind of job is it\?[\s\S]*1\. A repair/);
    expect(await say("1")).toMatch(/What is the main cause\?[\s\S]*2\. Wear and tear/);
    expect(await say("2")).toMatch(/Describe the problem/);
    expect(await say("brakes")).toMatch(/at least 10 characters[\s\S]*Describe the problem/);                          // asked again
    expect(await say("Front left brake grinds when stopping")).toMatch(/odometer show on JCW-001 now/);
    expect(await say("lots")).toMatch(/as a number/);
    expect(await say("43,000")).toMatch(/How urgent is it\?[\s\S]*3\. High/);
    expect(await say("3")).toMatch(/By when is it needed/);
    expect(await say("01/01/2020")).toMatch(/already passed/);
    expect(await say("15/12/2031")).toMatch(/Send up to 3 photos/);
    expect(await say("maybe")).toMatch(/send a photo, or reply DONE or SKIP/);
    expect(await send("11111")).toMatch(/Got it: 1 of 3 photos/);
    expect(await send("pdf-1")).toMatch(/could not use that file[\s\S]*only ordinary photos/);                       // a PDF is not a photo
    expect(await send("22222", "33333", "44444")).toMatch(/Got it: 3 of 3 photos[\s\S]*1 file was not used[\s\S]*DONE/); // a fourth is turned away
    const summary = await say("done");
    expect(summary).toMatch(/Job card:[\s\S]*JCW-001 \(Suzuki Bolan\)[\s\S]*A repair[\s\S]*Wear and tear[\s\S]*Front left brake[\s\S]*43,000 km[\s\S]*High[\s\S]*Needed by[\s\S]*3 photos attached[\s\S]*Reply YES/);
    expect(await cards()).toHaveLength(0);                                                                           // nothing exists before YES
    const done = await say("yes");
    expect(done).toMatch(/Done\. Job card JC-\d+ has been raised for JCW-001 and sent for approval/);
    const [c] = await cards();
    expect(c).toMatchObject({ status: "submitted", source: "whatsapp", requested_by: emp, priority: "high", category: "corrective", needed_by: "2031-12-15", odometer_km: "43000.0" });
    expect(c.cause_text).toBe("Front left brake grinds when stopping");
    expect(await files(c.job_no)).toEqual(["photo-1.jpg", "photo-2.jpg", "photo-3.jpg"]);
    expect(stored).toHaveLength(3);
  });

  it("works without photos or a date: SKIP and SKIP", async () => {
    const before = (await cards()).length;
    await start(); await say("1"); await say("2"); await say("3"); await say("Engine overheats after twenty minutes"); await say("43,100"); await say("2");
    await say("skip");                                                                                              // needed by
    const summary = await say("skip");                                                                              // photos
    expect(summary).toMatch(/No photos\./);
    expect(summary).not.toMatch(/Needed by/);
    expect(await say("yes")).toMatch(/Done\. Job card/);
    expect(await cards()).toHaveLength(before + 1);
    expect((await cards()).at(-1)).toMatchObject({ category: "preventive" });
  });

  it("tells the person kindly when the app would refuse the card (an odometer below the last reading) and creates nothing", async () => {
    const before = (await cards()).length;
    await start(); await say("1"); await say("1"); await say("1"); await say("Clutch slips when climbing a slope"); await say("100"); await say("1"); await say("skip");
    await say("skip");
    expect(await say("yes")).toMatch(/I could not send that:[\s\S]*Please use the app/);
    expect(await cards()).toHaveLength(before);
    expect(await say("Hi")).toMatch(/What would you like to do/);                                                   // the conversation closed; saying Hi starts a new one
  });

  it("a photo sent when the question is not about photos is not stored", async () => {
    const n = stored.length;
    await start(); await say("1"); await say("1"); await say("1");
    expect(await send("55555")).toMatch(/type your answer/);
    expect(stored).toHaveLength(n);
    await say("cancel");
  });

  it("BACK from the photos goes back to the date; the photos already sent are kept until the card is made or the conversation ends", async () => {
    await start(); await say("1"); await say("1"); await say("1"); await say("Wipers do not clear the screen"); await say("43,200"); await say("1"); await say("skip");
    await send("66666");
    expect(await say("back")).toMatch(/By when is it needed/);
    await say("cancel");
  });
});
