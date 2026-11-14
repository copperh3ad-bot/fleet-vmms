import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import * as trips from "@/lib/trips/service";
import { latestQuoteAdvice, quoteAdviceOffered, recommendTripQuotes } from "@/lib/trips/advice";
import { setAiDocuments } from "@/lib/ai/service";
import { ADVICE_PROMPT, ADVICE_SCHEMA, checkAdvice } from "@/lib/ai/quote-advice";
import type { CreateMessage } from "@/lib/ai/claude";

// ADR-080: the AI compares the quotes on a trip. Advice only; a fake model is used, so these cost nothing and need no network.
const env0 = { ...process.env };
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const mgr = () => mem("fleet_manager", 12);
const req = () => mem("requester", 11);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);
let provA: string, provB: string, provC: string;
const at = (day: number, hour: number) => `2031-05-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;
const newTrip = () => trips.requestTrip(d, req(), { purpose: "Move machinery to Faisalabad", from_place: "Lahore", to_place: "Faisalabad", start_at: at(10, 8), end_at: at(10, 18) });
const quoted = async (id: string, vendor: string, amount: number, extra: Record<string, unknown> = {}) => {
  await trips.requestTripQuotes(d, mgr(), id, [vendor]);
  const q = (await trips.listTripQuotes(d, mgr(), id)).find((x) => x.vendor_id === vendor)!;
  await trips.recordTripQuote(d, mgr(), q.id, { amount: String(amount), ...extra });
  return q.id;
};

const answer = (obj: unknown, over: Record<string, unknown> = {}) => ({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: JSON.stringify(obj) }], usage: { input_tokens: 700, output_tokens: 250, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, ...over });
let calls = 0, seen: Record<string, unknown>[] = [];
const model = (obj: unknown, over: Record<string, unknown> = {}): CreateMessage => async (p) => { calls++; seen.push(p as unknown as Record<string, unknown>); return answer(obj, over) as never; };
const ranked = (...labels: string[]) => ({ ranking: labels.map((l) => ({ option: l, reason: `Reason for ${l}.`, concerns: [] })), summary: `Lean towards ${labels[0]}.`, warnings: [] });

describe("checking what the model returns", () => {
  it("keeps only the options that were sent, each once, and adds the ones it left out", () => {
    const r = checkAdvice({
      ranking: [{ option: "b", reason: "Cheaper and on time.", concerns: ["Check the vehicle"] }, { option: "Z", reason: "Not an option." }, { option: "B", reason: "Again." }, { option: "A", reason: "" }],
      summary: "Lean towards B.", warnings: ["No rate card for A"],
    }, ["A", "B", "C"])!;
    expect(r.ranking.map((x) => x.label)).toEqual(["B", "A", "C"]);
    expect(r.ranking[0]).toMatchObject({ reason: "Cheaper and on time.", concerns: ["Check the vehicle"] });
    expect(r.ranking[1].reason).toMatch(/did not assess/);
    expect(r.summary).toBe("Lean towards B.");
  });
  it("gives nothing when no usable ranking came back", () => {
    expect(checkAdvice({ ranking: [{ option: "Q", reason: "x" }], summary: "s", warnings: [] }, ["A", "B"])).toBeNull();
    expect(checkAdvice("nonsense", ["A", "B"])).toBeNull();
  });
  it("the prompt treats the input as data and the schema asks for every option", () => {
    expect(ADVICE_PROMPT).toMatch(/never instructions/);
    expect(ADVICE_SCHEMA.required).toEqual(["ranking", "summary", "warnings"]);
  });
});

describe("comparing quotes with the AI", () => {
  beforeAll(async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    d = await testDriver();
    t = await provisionTenant(d, { name: "Haul Advice Co", slug: "hauladv", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
    for (const [n, name] of [[11, "Requester One"], [12, "Manager One"]] as const) {
      const id = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` })).id;
      await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), id]));
    }
    await withPlatform(d, async (q) => {
      for (const [n, role] of [[11, "requester"], [12, "fleet_manager"]] as const) await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
      await q.query("update public.org_billing set plan_key = 'pro' where tenant_id = $1", [t.tenantId]);
    });
    await raw((q) => q.query("insert into settings(key, value) values ('module_trips','1') on conflict (key) do update set value = '1'"));
    provA = (await master.saveVendor(d, owner(), { name: "Alpha Freight", kind: "logistics", phone: "0300 1111111" })).id;
    provB = (await master.saveVendor(d, owner(), { name: "Bravo Haulage", kind: "logistics", phone: "0300 2222222" })).id;
    provC = (await master.saveVendor(d, owner(), { name: "Charlie Cargo", kind: "logistics" })).id;
    await raw((q) => q.query("insert into provider_rates(vendor_id, label, basis, amount) values ($1, 'Lahore to Faisalabad, 10-tonne truck', 'per_trip', 90000)", [provA]));
  });
  afterAll(() => { process.env = { ...env0 }; });

  it("does nothing until the administrator has switched the AI on, and never calls the model", async () => {
    const id = await newTrip();
    await quoted(id, provA, 100000); await quoted(id, provB, 95000);
    calls = 0;
    expect(await quoteAdviceOffered(d, mgr())).toBe(false);
    expect((await recommendTripQuotes(d, mgr(), id, model(ranked("A", "B"))).catch((e) => e)).message).toMatch(/not switched on/);
    expect(calls).toBe(0);
    await setAiDocuments(d, owner(), true);
    expect(await quoteAdviceOffered(d, mgr())).toBe(true);
  });

  it("needs trip.award", async () => {
    const id = await newTrip();
    expect(await recommendTripQuotes(d, req(), id, model(ranked("A", "B"))).catch((e) => e)).toBeInstanceOf(ForbiddenError);
  });

  it("needs two quotes to compare", async () => {
    const id = await newTrip();
    await quoted(id, provA, 100000);
    calls = 0;
    expect((await recommendTripQuotes(d, mgr(), id, model(ranked("A"))).catch((e) => e)).message).toMatch(/At least two/);
    expect(calls).toBe(0);
  });

  it("sends options with the provider business names but no people, stores the advice, and changes nothing about the quotes or the trip", async () => {
    const id = await newTrip();
    const a = await quoted(id, provA, 100000, { vehicle_text: "10-tonne truck" });
    const b = await quoted(id, provB, 95000, { notes: "Can start at 6am" });
    await trips.requestTripQuotes(d, mgr(), id, [provC]);                 // asked, no quote yet: not part of the comparison
    calls = 0; seen = [];
    const before = await trips.listTripQuotes(d, mgr(), id);
    const r = await recommendTripQuotes(d, mgr(), id, model({ ranking: [{ option: "B", reason: "Lower and starts early.", concerns: ["Vehicle not stated"] }, { option: "A", reason: "Matches the rate card closely.", concerns: [] }], summary: "Lean towards B.", warnings: [] }));
    expect(calls).toBe(1);
    expect(r.advice.ranking.map((x) => x.label)).toEqual(["B", "A"]);
    const sent = JSON.stringify(seen[0]);
    for (const name of ["Alpha Freight", "Bravo Haulage"]) expect(sent).toContain(name);
    expect(sent).not.toContain("Charlie Cargo");   // it did not quote
    for (const name of ["Requester One", "Manager One"]) expect(sent).not.toContain(name);
    const msg = JSON.parse(((seen[0].messages as { content: { text: string }[] }[])[0].content[0].text));
    expect(msg.options.map((o: { label: string }) => o.label)).toEqual(["A", "B"]);
    expect(msg.options.flatMap((o: { rate_cards: unknown[] }) => o.rate_cards)).toEqual([{ label: "Lahore to Faisalabad, 10-tonne truck", basis: "per_trip", amount: 90000 }]);   // Alpha's card, on whichever letter Alpha got
    expect(msg.options.map((o: { over_lowest_pct: number }) => o.over_lowest_pct).sort((x: number, y: number) => x - y)).toEqual([0, 5.3]);   // 95,000 is the lowest; 100,000 is 5.3% over
    expect(await trips.listTripQuotes(d, mgr(), id)).toEqual(before);
    expect((await trips.getTrip(d, mgr(), id))!.status).toBe("requested");

    const logged = await raw((q) => q.query<{ kind: string; status: string; requested_by: string; input_tokens: number }>("select kind, status, requested_by, input_tokens from ai_actions where trip_id = $1", [id]));
    expect(logged.rows).toEqual([{ kind: "quote_advice", status: "ok", requested_by: U(12), input_tokens: 700 }]);

    const shown = (await latestQuoteAdvice(d, mgr(), id))!;
    expect(shown.stale).toBe(false);
    expect(shown.ranking.map((x) => x.quote_id)).toHaveLength(2);
    expect(new Set(shown.ranking.map((x) => x.quote_id))).toEqual(new Set([a, b]));
    expect(shown.ranking[0].label).toBe("B");                              // the letter the model put first, mapped back to a real quote
    expect([a, b]).toContain(shown.ranking[0].quote_id);
  });

  it("the advice goes stale when a quote changes, and awarding stays the person's own step", async () => {
    const id = await newTrip();
    const a = await quoted(id, provA, 100000); const b = await quoted(id, provB, 95000);
    await recommendTripQuotes(d, mgr(), id, model(ranked("B", "A")));
    expect((await latestQuoteAdvice(d, mgr(), id))!.stale).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    await trips.recordTripQuote(d, mgr(), a, { amount: "80000" });
    expect((await latestQuoteAdvice(d, mgr(), id))!.stale).toBe(true);
    await trips.awardTripQuote(d, mgr(), id, b);
    expect((await trips.getTrip(d, mgr(), id))!.outsourced_vendor).toBe("Bravo Haulage");
  });

  it("a failed or unusable answer is logged, not stored as advice, and says why", async () => {
    const id = await newTrip();
    await quoted(id, provA, 100000); await quoted(id, provB, 95000);
    expect((await recommendTripQuotes(d, mgr(), id, model({ ranking: [], summary: "", warnings: [] })).catch((e) => e)).message).toMatch(/no usable comparison/);
    expect((await recommendTripQuotes(d, mgr(), id, model(ranked("A", "B"), { stop_reason: "refusal" })).catch((e) => e)).message).toMatch(/declined/);
    expect(await latestQuoteAdvice(d, mgr(), id)).toBeNull();
    const rows = await raw((q) => q.query<{ status: string }>("select status from ai_actions where trip_id = $1 order by created_at", [id]));
    expect(rows.rows.map((x) => x.status)).toEqual(["unreadable", "refused"]);
  });

  it("is refused on the Basic plan", async () => {
    const id = await newTrip();
    await quoted(id, provA, 100000); await quoted(id, provB, 95000);
    await withPlatform(d, (q) => q.query("update public.org_billing set plan_key = 'basic' where tenant_id = $1", [t.tenantId]));
    try {
      calls = 0;
      expect((await recommendTripQuotes(d, mgr(), id, model(ranked("A", "B"))).catch((e) => e)).message).toMatch(/Pro plan/);
      expect(calls).toBe(0);
    } finally { await withPlatform(d, (q) => q.query("update public.org_billing set plan_key = 'pro' where tenant_id = $1", [t.tenantId])); }
  });
});
