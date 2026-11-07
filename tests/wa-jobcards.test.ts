import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { listNotifications } from "@/lib/jobcards/service";
import type { CreateMessage } from "@/lib/ai/claude";
import { checkJobCardDraft } from "@/lib/ai/jobcard-draft";
import { processWhatsAppJobCard, setWaJobCards, waJobCardsOffered, type IntakeDeps } from "@/lib/wa-jobcards/service";
import type { InboundMessage } from "@/lib/whatsapp";

// ADR-061: raising a job card by WhatsApp. A fake model and a fake WhatsApp: no network, no cost.
const env0 = { ...process.env };
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const mgr = () => mem("fleet_manager", 52);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);

// ---- fakes ----
let nextAnswer: unknown;
const calls: { text: string; previous: unknown; photos: number; images: number }[] = [];
const create: CreateMessage = async (p) => {
  const content = (p.messages[0].content as { type: string; text?: string }[]);
  const meta = JSON.parse(content.find((b) => b.type === "text")!.text!) as { message: string; previous_draft: unknown; photos: number };
  calls.push({ text: meta.message, previous: meta.previous_draft, photos: meta.photos, images: content.filter((b) => b.type === "image").length });
  return { content: [{ type: "text", text: JSON.stringify(nextAnswer) }], stop_reason: "end_turn", usage: { input_tokens: 120, output_tokens: 60 } } as never;
};
const stored: string[] = [];
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const deps: IntakeDeps = {
  fetchMedia: async (id) => id.startsWith("pdf") ? { bytes: new Uint8Array([37, 80, 68, 70]), mime: "application/pdf" } : { bytes: JPEG, mime: "image/jpeg" },
  store: async (path) => { stored.push(path); },
  newId: (() => { let i = 0; return () => `00000000-0000-4000-8000-${String(++i).padStart(12, "0")}`; })(),
  create,
};
const good = (over: Record<string, unknown> = {}) => ({
  readable: true, registration_no: "WAJ-001", category: "corrective", reason_category: "wear_and_tear", description: "Front left brake grinds when stopping", priority: "normal", warnings: [], ...over,
});
let seq = 0;
const msg = (text: string, from = "+923001111111", media: InboundMessage["media"] = []): InboundMessage => ({ id: `wamid.${++seq}`, from, contextId: null, text, media });
const say = async (text: string, from?: string, media?: InboundMessage["media"]) => processWhatsAppJobCard(d, deps, msg(text, from, media));
const cards = () => raw(async (q) => (await q.query<{ job_no: string; status: string; source: string; requested_by: string | null; cause_text: string; priority: string }>(
  "select job_no, status, source, requested_by, cause_text, priority from job_cards where source = 'whatsapp' order by created_at, job_no")).rows);
const intake = () => raw(async (q) => (await q.query<{ status: string; rounds: number; draft: { vehicle_id: string | null; cause_text: string } }>("select status, rounds, draft from whatsapp_intake order by created_at")).rows);

let emps: Record<number, string>;


beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  d = await testDriver();
  t = await provisionTenant(d, { name: "Whiskey Fleet", slug: "whiskey", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  emps = {};
  for (const [n, name, phone] of [[51, "Driver One", "0300 1111111"], [52, "Manager Two", "0300 2222222"], [53, "Auditor Three", "0300 3333333"], [54, "No Login", "0300 4444444"]] as const) {
    emps[n] = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `W-${n}` })).id;
    await raw((q) => q.query("update employees set phone = $2 where id = $1", [emps[n], phone]));
    if (n !== 54) await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), emps[n]]));
  }
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[51, "requester"], [52, "fleet_manager"], [53, "auditor"]] as const) await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  await master.addVehicle(d, owner(), { registration_no: "WAJ-001", make: "Toyota", model: "Hilux", employee_id: emps[51], holding_since: "2026-01-01" });
  await master.addVehicle(d, owner(), { registration_no: "WAJ-002", make: "Honda", model: "City", employee_id: emps[52], holding_since: "2026-01-01" });
});
afterAll(() => { process.env = { ...env0 }; });
// The limits are tested on their own at the end; every other test starts with a clean slate so they do not trip over each other.
beforeEach(async () => { await withPlatform(d, (q) => q.query("delete from public.rate_limits")); });

describe("switching it on", () => {
  it("is off until the administrator switches it on, which needs the Pro plan and records who and when", async () => {
    expect(await waJobCardsOffered(d, t.tenantId)).toBe(false);
    await withPlatform(d, (q) => q.query("update public.org_billing set plan_key = 'standard' where tenant_id = $1", [t.tenantId]));
    await expect(setWaJobCards(d, owner(), true)).rejects.toThrow(/part of the Pro plan/);
    await withPlatform(d, (q) => q.query("update public.org_billing set plan_key = 'pro' where tenant_id = $1", [t.tenantId]));
    await expect(setWaJobCards(d, mgr(), true)).rejects.toBeInstanceOf(ForbiddenError);            // a manager cannot decide what leaves the company
    nextAnswer = good();
    expect(await say("WAJ-001 brake noise")).toEqual({ handled: false, reply: null });                // still off: other WhatsApp flows run as before
    await setWaJobCards(d, owner(), true);
    expect(await waJobCardsOffered(d, t.tenantId)).toBe(true);
    const row = await withPlatform(d, async (q) => (await q.query<{ wa_jobcards_by: string; wa_jobcards_at: string }>("select wa_jobcards_by, wa_jobcards_at::text from public.tenants where id = $1", [t.tenantId])).rows[0]);
    expect(row.wa_jobcards_by).toBe(U(1));
    expect(row.wa_jobcards_at).toBeTruthy();
  });
  it("is off again when the plan drops to Basic", async () => {
    await withPlatform(d, (q) => q.query("update public.org_billing set plan_key = 'standard' where tenant_id = $1", [t.tenantId]));
    expect(await waJobCardsOffered(d, t.tenantId)).toBe(false);
    await withPlatform(d, (q) => q.query("update public.org_billing set plan_key = 'pro' where tenant_id = $1", [t.tenantId]));
  });
});

describe("checking what the model returns", () => {
  it("keeps a clean draft, and cleans the registration and text", () => {
    expect(checkJobCardDraft(good({ registration_no: "  waj-001 ", description: "  Brakes   grind \n when stopping " }))).toMatchObject({ readable: true, registration_no: "waj-001", description: "Brakes grind when stopping" });
  });
  it("falls back to safe values for anything outside the lists, and drops a registration that is not one", () => {
    const x = checkJobCardDraft(good({ category: "hack", reason_category: "x", priority: "now!!", registration_no: "<script>" }));
    expect(x).toMatchObject({ category: "corrective", reason_category: "other", priority: "normal", registration_no: null });
  });
  it("refuses a message that is not about a vehicle, or says too little", () => {
    expect(checkJobCardDraft({ readable: false, warnings: ["Not about a vehicle."] }).readable).toBe(false);
    expect(checkJobCardDraft(good({ description: "bad" })).readable).toBe(false);
    expect(checkJobCardDraft("nonsense").readable).toBe(false);
    expect(checkJobCardDraft(null).warnings.length).toBeGreaterThan(0);
  });
});

describe("a conversation", () => {
  it("ignores a number that is not an employee's, and an employee with no login", async () => {
    nextAnswer = good();
    const before = calls.length;
    expect(await say("hello", "+923009999999")).toEqual({ handled: false, reply: null });
    expect(await say("WAJ-001 brake", "+923004444444")).toEqual({ handled: false, reply: null });
    expect(calls.length).toBe(before);                                                                 // nothing was sent to the AI
  });

  it("matches the number however it is written, makes a draft, and creates nothing until YES", async () => {
    nextAnswer = good();
    const out = await say("WAJ-001 brake making noise front left", "+92 300 1111111");
    expect(out.handled).toBe(true);
    expect(out.reply).toMatch(/Job card for WAJ-001 \(Toyota Hilux\)/);
    expect(out.reply).toMatch(/Front left brake grinds/);
    expect(out.reply).toMatch(/Reply YES to send it/);
    expect(await cards()).toHaveLength(0);
    expect((await intake()).map((r) => r.status)).toEqual(["waiting"]);
    expect(calls.at(-1)).toMatchObject({ text: "WAJ-001 brake making noise front left", previous: null, photos: 0 });
  });

  it("a correction re-reads the draft with the earlier one, and a second message is never a second draft", async () => {
    nextAnswer = good({ description: "Front left brake grinds and the pedal feels soft", priority: "high" });
    const out = await say("also the pedal feels soft, needed today");
    expect(out.reply).toMatch(/pedal feels soft/);
    expect(out.reply).toMatch(/Priority: high/);
    expect((calls.at(-1)!.previous as { registration_no: string }).registration_no).toBe("WAJ-001");
    const rows = await intake();
    expect(rows).toHaveLength(1);
    expect(rows[0].rounds).toBe(2);
  });

  it("YES raises the job card as the sender, as Requested, marked as raised by WhatsApp, and tells the managers", async () => {
    const out = await say("Yes");
    expect(out.reply).toMatch(/Job card \S+ has been raised for WAJ-001/);
    const made = await cards();
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ status: "submitted", source: "whatsapp", requested_by: emps[51], priority: "high" });
    expect(made[0].cause_text).toMatch(/pedal feels soft/);
    expect((await intake()).map((r) => r.status)).toEqual(["confirmed"]);
    expect((await listNotifications(d, mgr())).length).toBeGreaterThan(0);
  });

  it("a YES with nothing open is a new message, not a confirmation", async () => {
    nextAnswer = { readable: false, registration_no: null, category: "corrective", reason_category: "other", description: "", priority: "normal", warnings: ["Not about a vehicle."] };
    const before = (await cards()).length;
    const out = await say("yes");
    expect(out.reply).toMatch(/does not read as a vehicle problem/i);
    expect((await cards()).length).toBe(before);
  });

  it("NO cancels the draft", async () => {
    nextAnswer = good({ description: "Left headlight is broken and the glass is cracked" });
    await say("WAJ-001 headlight broken");
    const out = await say("no");
    expect(out.reply).toMatch(/Cancelled/);
    expect((await intake()).at(-1)!.status).toBe("cancelled");
  });

  it("asks for the vehicle when it is not named or not found, and takes it in the next message", async () => {
    nextAnswer = good({ registration_no: null, description: "The air conditioner is not cooling at all" });
    const first = await say("AC not cooling");
    expect(first.reply).toMatch(/Which vehicle is this for/);
    expect((await say("yes")).reply).toMatch(/still need the vehicle/);
    nextAnswer = good({ registration_no: "ZZZ-999", description: "The air conditioner is not cooling at all" });
    expect((await say("ZZZ-999")).reply).toMatch(/could not find a vehicle ZZZ-999/);
    nextAnswer = good({ registration_no: "waj 001", description: "The air conditioner is not cooling at all" });
    expect((await say("WAJ 001")).reply).toMatch(/Job card for WAJ-001/);                               // spaces and case do not matter
    const before = (await cards()).length;
    expect((await say("YES")).reply).toMatch(/has been raised/);
    expect((await cards()).length).toBe(before + 1);
  });

  it("will not draft for a vehicle the sender is not allowed to use", async () => {
    await raw((q) => q.query("update public.tenant_memberships set vehicle_scope = 'own' where user_id = $1", [U(51)]));
    nextAnswer = good({ registration_no: "WAJ-002", description: "The clutch is slipping badly on hills" });
    try { expect((await say("WAJ-002 clutch slipping")).reply).toMatch(/could not find a vehicle WAJ-002/); }
    finally { await raw((q) => q.query("update public.tenant_memberships set vehicle_scope = 'all' where user_id = $1", [U(51)])); }
    await say("no");
  });

  it("refuses a role that cannot raise job cards, and sends nothing to the AI", async () => {
    const before = calls.length;
    const out = await say("WAJ-001 brake", "+923003333333");
    expect(out.reply).toMatch(/cannot raise job cards/);
    expect(calls.length).toBe(before);
  });

  it("uses up to three photos, stores them with the company's other files and attaches them on YES; a PDF is not read", async () => {
    nextAnswer = good({ description: "Dent on the rear bumper after reversing" });
    const out = await say("WAJ-001 rear bumper dent", undefined, [{ id: "img1", filename: null, mime: "image/jpeg" }, { id: "pdf1", filename: "x.pdf", mime: "application/pdf" }, { id: "img2", filename: null, mime: "image/jpeg" }]);
    expect(out.reply).toMatch(/2 photos attached/);
    expect(out.reply).toMatch(/1 file was not used/);
    expect(calls.at(-1)).toMatchObject({ photos: 2, images: 2 });
    expect(stored.filter((p) => p.startsWith(`${t.schema}/intake/`)).length).toBeGreaterThanOrEqual(2);
    await say("YES");
    const n = await raw(async (q) => (await q.query<{ n: string }>("select count(*)::text n from attachments a join job_cards j on j.id = a.entity_id where a.entity_type = 'job_card' and j.source = 'whatsapp' and j.cause_text like 'Dent%'")).rows[0].n);
    expect(Number(n)).toBe(2);
  });

  it("stops after too many corrections", async () => {
    nextAnswer = good({ description: "Steering feels loose at high speed" });
    await say("WAJ-001 steering loose");
    for (let i = 0; i < 3; i++) await say(`correction ${i}`);
    const out = await say("one more");
    expect(out.reply).toMatch(/gone back and forth/);
    expect((await intake()).at(-1)!.status).toBe("cancelled");
  });

  it("says plainly when the AI cannot be used, and keeps nothing", async () => {
    const failing: IntakeDeps = { ...deps, create: async () => { throw new Error("boom"); } };
    const before = (await intake()).length;
    const out = await processWhatsAppJobCard(d, failing, msg("WAJ-001 horn not working"));
    expect(out.reply).toMatch(/could not read that just now/);
    expect((await intake()).length).toBe(before);
  });

  it("never sends the AI anything about the company: only the message, the earlier draft and the photos", async () => {
    nextAnswer = good({ description: "Wiper blades are worn and smear the glass" });
    await say("WAJ-001 wipers smear");
    const last = calls.at(-1)!;
    expect(Object.keys(last).sort()).toEqual(["images", "photos", "previous", "text"]);
    await say("no");
  });
});

describe("limits", () => {
  it("stops a sender after 10 drafts a day, and after 20 messages an hour, and the plan's daily cap stops the company", async () => {
    const { allowShared } = await import("@/lib/rate-limit");
    const { tenantPlan } = await import("@/lib/billing/plans");
    const ten = "3001111111";
    const fill = async (key: string, n: number, limit: number, secs: number) => { for (let i = 0; i < n; i++) await allowShared(d, key, limit, secs); };
    nextAnswer = good({ description: "Tyre pressure warning keeps coming on" });
    // 10 drafts used up today: the next one is refused before the AI is asked
    await fill(`wa-intake-draft:${t.tenantId}:${ten}`, 10, 10, 86_400);
    let n = calls.length;
    expect((await say("WAJ-001 tyre warning")).reply).toMatch(/today's limit for job cards by WhatsApp/);
    expect(calls.length).toBe(n);
    // 20 messages used up this hour: the next one is refused at the door
    await withPlatform(d, (q) => q.query("delete from public.rate_limits"));
    await fill(`wa-intake-msg:${t.tenantId}:${ten}`, 20, 20, 3600);
    expect((await say("WAJ-001 tyre warning")).reply).toMatch(/sent a lot of messages/);
    // the company's daily cap, from its plan
    await withPlatform(d, (q) => q.query("delete from public.rate_limits"));
    const perDay = (await tenantPlan(d, t.tenantId)).aiPerDay;
    expect(perDay).toBeGreaterThan(0);
    await fill(`wa-intake-org:${t.tenantId}`, perDay, perDay, 86_400);
    n = calls.length;
    expect((await say("WAJ-001 tyre warning")).reply).toMatch(/Your company has reached today's limit/);
    expect(calls.length).toBe(n);
  });
});

describe("a number in two companies", () => {
  let t2: { tenantId: string; schema: string };
  beforeAll(async () => {
    t2 = await provisionTenant(d, { name: "Hotel Fleet", slug: "hotel", ownerUserId: U(2), ownerName: "Owner Two" }, tenantMigrations(), { transform: stripExt });
    const e = await master.saveEmployee(d, { ...t2, userId: U(2), role: "tenant_admin", vehicleScope: "all" }, { full_name: "Driver One Again", employee_no: "H-1" });
    await withTenant(d, { ...t2, userId: U(2), role: "tenant_admin" }, (q) => q.query("update employees set phone = '+92 300 1111111', user_id = $2 where id = $1", [e.id, U(51)]));
    await withPlatform(d, async (q) => {
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'requester')", [U(51), t2.tenantId]);
      await q.query("update public.org_billing set plan_key = 'pro' where tenant_id = $1", [t2.tenantId]);
    });
    await setWaJobCards(d, { ...t2, userId: U(2), role: "tenant_admin", vehicleScope: "all" }, true);
  });
  it("asks which company, and takes the company named at the start of the message", async () => {
    nextAnswer = good({ description: "Oil is leaking under the engine" });
    await say("no");                                                                                   // close any draft an earlier test left open
    const ask = await say("WAJ-001 oil leak");
    expect(ask.reply).toMatch(/more than one company/);
    expect(ask.reply).toMatch(/Whiskey Fleet: /);
    const chosen = await say("Whiskey Fleet: WAJ-001 oil leak");
    expect(chosen.reply).toMatch(/Job card for WAJ-001/);
    expect(calls.at(-1)!.text).toBe("WAJ-001 oil leak");                                               // the company name is not sent to the AI
    expect((await say("YES")).reply).toMatch(/has been raised/);                                       // YES goes to the company with the open draft
  });
});
