// Basic and Pro (ADR-035): the owner sets every price (never in code), Pro is priced in fleet-size bands and is not for sale until the bands cover every size,
// an organization's plan and band decide whether it has AI and how much, and a price change touches only organizations that join from then on.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import * as master from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import { UserError } from "@/lib/master/service";
import { bandFor, bandsCoverEverySize, DEFAULT_PRO_MIN_JOB_CARDS, jobCardsPerDay, listBands, listPlans, loadProOffer, parsePrice, planFrom, proEligible, proMinJobCards, proOfferFrom, setOrgPlan, setPlanPrice, setProBands, tenantPlan, vehicleCount, type Band } from "@/lib/billing/plans";
import { loadOffer } from "@/lib/billing/offer";

const OP = "00000000-0000-0000-0000-0000000000a1";
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const owner = () => ({ ...t, userId: U(1), role: "tenant_admin", vehicleScope: "all" as const });
const rows = [{ upTo: "10", price: "100", reads: "20" }, { upTo: "50", price: "250", reads: "60" }, { upTo: "", price: "600", reads: "200" }];

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Hotel Textiles", slug: "hotel", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  await withPlatform(d, (q) => q.query("insert into public.platform_admins(user_id) values ($1) on conflict do nothing", [OP]));
});

const billing = () => withPlatform(d, async (q) => (await q.query<{ plan_key: string; price_cents: number; currency: string; comped: boolean; ai_reads_per_day: number | null }>("select plan_key, price_cents, currency, comped, ai_reads_per_day from public.org_billing where tenant_id = $1", [t.tenantId])).rows[0]);
const setComped = (on: boolean) => withPlatform(d, (q) => q.query("update public.org_billing set comped = $2 where tenant_id = $1", [t.tenantId, on]));
const addVehicles = async (n: number) => { for (let i = 0; i < n; i++) await master.addVehicle(d, owner(), { registration_no: `HT-${Math.random().toString(36).slice(2, 8).toUpperCase()}` }); };

describe("the two plans", () => {
  it("keeps the existing plan as Basic at its existing price, and adds Pro with no price and no bands", async () => {
    const plans = await listPlans(d);
    const basic = plans.find((p) => p.key === "standard")!, pro = plans.find((p) => p.key === "pro")!;
    expect(basic.name).toBe("Basic");
    expect(basic.price_cents).toBe(14900);                       // unchanged: nothing is taken from anyone
    expect(basic.features.ai_documents).toBeUndefined();
    expect(pro).toMatchObject({ name: "Pro", price_cents: null });
    expect(pro.features.ai_documents).toBe(true);
    expect(pro.limits).toMatchObject({ ai_reads_per_day: 60, ai_trial_reads: 10 });
    expect(await listBands(d)).toEqual([]);
  });
  it("shows no price for Pro until the owner has entered bands, and the sign-up offer is still Basic's", async () => {
    const off = await loadProOffer(d);
    expect(off).toMatchObject({ priced: false, bands: [] });
    expect(off.points.join(" ")).toMatch(/AI reads/);
    expect((await loadOffer(d))?.planKey).toBe("standard");
    expect(proOfferFrom(undefined, []).priced).toBe(false);
  });
});

describe("the owner sets prices", () => {
  it("reads amounts like 12 and 12.50 and refuses anything else", () => {
    expect(parsePrice("12")).toBe(1200);
    expect(parsePrice(" 1,249.50 ")).toBe(124950);
    for (const bad of ["", "0", "-5", "12.345", "abc", "1e3", "9999999"]) expect(() => parsePrice(bad), bad).toThrow(UserError);
  });
  it("only an operator may, Basic needs a price, and Pro is set by bands, not one price", async () => {
    await expect(setPlanPrice(d, U(9), "standard", { price: "20" })).rejects.toThrow(/Not allowed/);
    await expect(setPlanPrice(d, OP, "standard", { price: "" })).rejects.toThrow(UserError);
    await expect(setPlanPrice(d, OP, "pro", { price: "20" })).rejects.toThrow(/by fleet size/);
    await expect(setPlanPrice(d, OP, "gold", { price: "10" })).rejects.toThrow(/Unknown plan/);
    await expect(setPlanPrice(d, OP, "standard", { price: "20", currency: "dollars" })).rejects.toThrow(/three-letter/);
    await expect(setPlanPrice(d, OP, "standard", { price: "20", trialDays: "400" })).rejects.toThrow(/0 to 60/);
    await expect(setProBands(d, U(9), rows)).rejects.toThrow(/Not allowed/);
  });
  it("refuses bands that do not make sense: out of order, no open last band, a gap in what is priced, a missing figure, too many", async () => {
    const bad: [string, typeof rows][] = [
      ["must be larger", [{ upTo: "50", price: "1", reads: "1" }, { upTo: "10", price: "1", reads: "1" }, { upTo: "", price: "1", reads: "1" }]],
      ["last band must have no upper limit", [{ upTo: "10", price: "1", reads: "1" }, { upTo: "50", price: "1", reads: "1" }]],
      ["only the last band may have no upper limit", [{ upTo: "", price: "1", reads: "1" }, { upTo: "", price: "1", reads: "1" }]],
      ["amount", [{ upTo: "10", price: "", reads: "5" }, { upTo: "", price: "9", reads: "5" }]],
      ["readings per day", [{ upTo: "10", price: "1", reads: "0" }, { upTo: "", price: "9", reads: "5" }]],
      ["whole number above 0", [{ upTo: "0", price: "1", reads: "1" }, { upTo: "", price: "9", reads: "5" }]],
      ["At most 6", Array.from({ length: 7 }, (_, i) => ({ upTo: i === 6 ? "" : String(i + 1), price: "1", reads: "1" }))],
    ];
    for (const [why, r] of bad) await expect(setProBands(d, OP, r), why).rejects.toThrow(new RegExp(why, "i"));
    expect(await listBands(d)).toEqual([]);                        // nothing half-saved
  });
  it("saves bands, shows them as ranges once they cover every size, and empty rows take Pro off sale", async () => {
    await setProBands(d, OP, rows, "usd");
    const bands = await listBands(d);
    expect(bands.map((b) => [b.up_to_vehicles, b.price_cents, b.ai_reads_per_day])).toEqual([[10, 10000, 20], [50, 25000, 60], [null, 60000, 200]]);
    expect(bandsCoverEverySize(bands)).toBe(true);
    const off = await loadProOffer(d);
    expect(off.priced).toBe(true);
    expect(off.bands.map((b) => b.label)).toEqual(["1 to 10 vehicles", "11 to 50 vehicles", "51 vehicles or more"]);
    expect(off.bands.map((b) => b.amount)).toEqual(["$100", "$250", "$600"]);
    await setProBands(d, OP, [{ upTo: "", price: "", reads: "" }]);
    expect(await listBands(d)).toEqual([]);
    expect((await loadProOffer(d)).priced).toBe(false);
    await setProBands(d, OP, rows);
  });
  it("puts a fleet in the first band it fits", () => {
    const b: Band[] = [{ up_to_vehicles: 10, price_cents: 1, currency: "USD", ai_reads_per_day: 1 }, { up_to_vehicles: 50, price_cents: 2, currency: "USD", ai_reads_per_day: 2 }, { up_to_vehicles: null, price_cents: 3, currency: "USD", ai_reads_per_day: 3 }];
    expect([0, 1, 10].map((n) => bandFor(b, n)!.price_cents)).toEqual([1, 1, 1]);
    expect([11, 50].map((n) => bandFor(b, n)!.price_cents)).toEqual([2, 2]);
    expect([51, 5000].map((n) => bandFor(b, n)!.price_cents)).toEqual([3, 3]);
    expect(bandFor(b.slice(0, 2), 51)).toBeNull();                 // bands that do not reach this size price nothing
    expect(bandsCoverEverySize(b.slice(0, 2))).toBe(false);
  });
});

describe("an organization's plan and band", () => {
  it("has no AI on the plan it started with, or on none", async () => {
    expect(planFrom(undefined)).toMatchObject({ key: "none", aiDocuments: false, aiPerDay: 0, aiTrialReads: null });
    expect(await tenantPlan(d, t.tenantId)).toMatchObject({ key: "legacy", aiDocuments: false });
  });
  it("counts its vehicles in its own workspace, which decides its band", async () => {
    expect(await vehicleCount(d, t.tenantId, t.schema)).toBe(0);
    await addVehicles(3);
    expect(await vehicleCount(d, t.tenantId, t.schema)).toBe(3);
  });
  it("moves to Pro at the price and daily allowance of the band its fleet falls in, and only an operator may move it", async () => {
    await expect(setOrgPlan(d, U(9), t.tenantId, "pro")).rejects.toThrow(/Not allowed/);
    await setComped(false);
    await setOrgPlan(d, OP, t.tenantId, "pro");                       // 3 vehicles: the first band
    expect(await billing()).toMatchObject({ plan_key: "pro", price_cents: 10000, currency: "USD", ai_reads_per_day: 20 });
    expect(await tenantPlan(d, t.tenantId)).toMatchObject({ key: "pro", aiDocuments: true, aiPerDay: 20, aiTrialReads: null });
    await addVehicles(8);                                              // 11 vehicles: the next band
    await setOrgPlan(d, OP, t.tenantId, "pro");                       // re-banded after the fleet grew
    expect(await billing()).toMatchObject({ price_cents: 25000, ai_reads_per_day: 60 });
  });
  it("a later change to the bands does not touch an organization already on Pro", async () => {
    await setProBands(d, OP, [{ upTo: "", price: "999", reads: "5" }]);
    expect(await billing()).toMatchObject({ plan_key: "pro", price_cents: 25000, ai_reads_per_day: 60 });      // what it joined at
    await setProBands(d, OP, rows);
  });
  it("goes back to Basic at Basic's price with no AI", async () => {
    await setOrgPlan(d, OP, t.tenantId, "standard");
    expect(await billing()).toMatchObject({ plan_key: "standard", price_cents: 14900, ai_reads_per_day: null });
    expect(await tenantPlan(d, t.tenantId)).toMatchObject({ key: "standard", aiDocuments: false, aiPerDay: 0 });
  });
  it("cannot be moved to a Pro with no bands unless billing is waived, which is how the owner tries Pro", async () => {
    await setProBands(d, OP, [{ upTo: "", price: "", reads: "" }]);
    await setComped(false);
    await expect(setOrgPlan(d, OP, t.tenantId, "pro")).rejects.toThrow(/no prices yet/);
    await setComped(true);
    const before = await billing();
    await setOrgPlan(d, OP, t.tenantId, "pro");
    expect(await billing()).toMatchObject({ plan_key: "pro", price_cents: before.price_cents, comped: true, ai_reads_per_day: null });
    expect(await tenantPlan(d, t.tenantId)).toMatchObject({ key: "pro", aiDocuments: true, aiPerDay: 60 });      // the plan's own default allowance
    await setOrgPlan(d, OP, t.tenantId, "standard");
    await setProBands(d, OP, rows);
  });
  it("a trial on Pro gets a small cap, and paying lifts it", () => {
    const row = { plan_key: "pro", name: "Pro", features: { ai_documents: true }, limits: { ai_reads_per_day: 60, ai_trial_reads: 10 }, ai_reads_per_day: 200 };
    expect(planFrom({ ...row, status: "trialing" })).toMatchObject({ trialing: true, aiTrialReads: 10, aiPerDay: 200 });
    expect(planFrom({ ...row, status: "active" })).toMatchObject({ trialing: false, aiTrialReads: null });
    expect(planFrom({ plan_key: "standard", name: "Basic", features: {}, limits: {}, status: "trialing" })).toMatchObject({ aiDocuments: false, aiTrialReads: null, aiPerDay: 0 });
  });
});

describe("who is offered Pro (Phase 2): organizations that enter many job cards a day", () => {
  it("is offered above 20 a day on average, not at 20, and not at sign-up", () => {
    expect(DEFAULT_PRO_MIN_JOB_CARDS).toBe(20);
    expect([0, 1, 19.9, 20].map((n) => proEligible(n))).toEqual([false, false, false, false]);
    expect([20.1, 21, 300].map((n) => proEligible(n))).toEqual([true, true, true]);
    expect(proEligible(30, 50)).toBe(false);
    expect(proEligible(50.5, 50)).toBe(true);
  });
  it("uses the owner's setting, and 20 when it is empty or not a number", async () => {
    expect(await proMinJobCards(d)).toBe(20);
    await withPlatform(d, (q) => q.query("insert into public.platform_settings(key, value) values ('pro_offer_min_job_cards', '35') on conflict (key) do update set value = excluded.value"));
    expect(await proMinJobCards(d)).toBe(35);
    await withPlatform(d, (q) => q.query("update public.platform_settings set value = 'lots' where key = 'pro_offer_min_job_cards'"));
    expect(await proMinJobCards(d)).toBe(20);
    await withPlatform(d, (q) => q.query("delete from public.platform_settings where key = 'pro_offer_min_job_cards'"));
  });
  it("counts the job cards an organization entered over the last 30 days, as a daily average, and ignores older ones", async () => {
    const e = await master.saveEmployee(d, owner(), { full_name: "Req One", employee_no: "E-1" });
    await withTenant(d, owner(), (q) => q.query("update employees set user_id = $1 where id = $2", [U(7), e.id]));
    const requester = { ...owner(), userId: U(7), role: "requester", vehicleScope: "all" as const };
    await withPlatform(d, (q) => q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'requester') on conflict do nothing", [U(7), t.tenantId]));
    const veh = (await withTenant(d, owner(), async (q) => (await q.query<{ id: string }>("select id from vehicles limit 1")).rows[0])).id;
    const reason = (await withTenant(d, owner(), async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'WEAR_BRAKES'")).rows[0])).id;
    const before = await jobCardsPerDay(d, t.schema);
    for (let i = 0; i < 6; i++) await jc.createJobCard(d, requester, { vehicle_id: veh, reason_code_id: reason, cause_text: `Brake pads worn to the metal, card ${i}`, lines: [] }, false);
    expect(await jobCardsPerDay(d, t.schema)).toBeCloseTo(before + 6 / 30, 5);
    await withTenant(d, owner(), (q) => q.query("update job_cards set created_at = now() - interval '45 days' where id in (select id from job_cards order by created_at desc limit 2)"));
    expect(await jobCardsPerDay(d, t.schema)).toBeCloseTo(before + 4 / 30, 5);
  });
  it("the pricing page says Pro is for busy fleets and any Basic company may try it free, and shows no amount while it has no bands", () => {
    const src = readFileSync("src/app/pricing/page.tsx", "utf8");
    expect(src).toContain("Coming in the second phase");
    expect(src).toContain("Pro is for busy fleets.");
    expect(src).toContain("try it free for 3 days");
  });
});

describe("no price is written in the code", () => {
  it("the plan files, the pricing page, the admin page and the FAQ name no amount: every price lives in the database (rule 7)", () => {
    for (const f of ["src/lib/billing/plans.ts", "src/app/pricing/page.tsx", "src/app/admin/plans/page.tsx", "src/lib/faq.ts"]) {
      const src = readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      expect(src, f).not.toMatch(/\$\s?\d{2,}|USD\s?\d|\b(14900|149|29900|299)\b/);      // two or more digits: SQL placeholders like $1 are not prices
    }
  });
});
