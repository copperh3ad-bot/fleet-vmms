// Unlisted makes and models (ADR-071): an owner can always type one, it is recorded once for the operator, and the operator approves, merges or rejects it.
import { beforeAll, describe, expect, it } from "vitest";
import { withPlatform } from "@/lib/db/tenant";
import { FIRST_YEAR, mergeCatalog, nameKey, yearChoices } from "@/lib/master/vehicle-catalog";
import {
  approveSuggestion, canonicalNames, cleanName, listSuggestions, loadCatalogExtras, mergeSuggestion, mergeTargets, recordNames, rejectSuggestion, MAX_NEW_NAMES_PER_DAY,
} from "@/lib/master/vehicle-names";
import { harness, OP, NOT_OP, type Org } from "./billing-harness";

let h: Awaited<ReturnType<typeof harness>>;
let a: Org, b: Org;
beforeAll(async () => {
  h = await harness();
  a = await h.org("Alpha Fleet");
  b = await h.org("Beta Fleet");
});
const rows = () => withPlatform(h.control, async (q) => (await q.query<{ make: string; model: string | null; status: string; uses: number; n: number }>(
  "select make, model, status, uses, (select count(*)::int from public.vehicle_name_uses u where u.suggestion_id = s.id) as n from public.vehicle_name_suggestions s order by make_key, model_key")).rows);
const one = async (make: string, model: string | null) => (await listSuggestions(h.control, OP, "pending")).find((r) => r.make === make && r.model === model)!;

describe("names that may be kept", () => {
  it("tidies spaces and accepts ordinary names, including ones with numbers and symbols", () => {
    expect(cleanName("  Land   Cruiser  ", 60)).toBe("Land Cruiser");
    expect(cleanName("Hilux 2.4 D-4D (Rebuilt)", 60)).toBe("Hilux 2.4 D-4D (Rebuilt)");
    expect(cleanName("سوزوکی", 40)).toBe("سوزوکی");
  });
  it("refuses empty, too long, odd characters, web addresses and emails", () => {
    for (const bad of ["", "   ", "x".repeat(61), "<script>", "http://x.test", "buy at www.x.pk", "me@x.com", "--", "$$$"]) expect(cleanName(bad, 60)).toBeNull();
  });
  it("treats case, spaces and punctuation as one name", () => {
    expect(nameKey("Land Cruiser")).toBe(nameKey("land-cruiser"));
    expect(nameKey("Wagon R")).toBe(nameKey("WAGONR"));
  });
  it("offers every year back to 1950, the form's own limit", () => {
    expect(FIRST_YEAR).toBe(1950);
    expect(yearChoices(2026).at(-1)).toBe(1950);
  });
});

describe("recording what an owner typed", () => {
  it("a name on the list is not recorded", async () => {
    await recordNames(h.control, a.tenantId, "toyota", "hilux");
    await recordNames(h.control, a.tenantId, "Suzuki", "Wagon R");
    expect(await rows()).toEqual([]);
  });
  it("an unlisted make and model are recorded once each, for this company", async () => {
    await recordNames(h.control, a.tenantId, "Zotye", "T600");
    expect((await rows()).map((r) => `${r.make}/${r.model}/${r.status}/${r.uses}/${r.n}`)).toEqual(["Zotye/null/pending/1/1", "Zotye/T600/pending/1/1"]);
  });
  it("the same name again counts another vehicle, not another row; another company counts as another company", async () => {
    await recordNames(h.control, a.tenantId, "ZOTYE", "t-600");
    await recordNames(h.control, b.tenantId, "Zotye", "T600");
    const t = await one("Zotye", "T600");
    expect(t).toMatchObject({ uses: 3, companies: 2 });
    expect((await rows()).length).toBe(2);
  });
  it("a listed make with an unlisted model records only the model", async () => {
    await recordNames(h.control, a.tenantId, "Toyota", "Corolla Rebuilt Kit");
    expect((await rows()).filter((r) => r.make === "Toyota").map((r) => r.model)).toEqual(["Corolla Rebuilt Kit"]);
  });
  it("a name that cannot be kept is skipped without an error", async () => {
    await expect(recordNames(h.control, a.tenantId, "http://spam.test", "x")).resolves.toBeUndefined();
    expect((await rows()).some((r) => /spam/i.test(r.make))).toBe(false);
  });
  it("one company can add only so many new names a day, but names already in the queue still count", async () => {
    const c = await h.org("Flood Fleet");
    for (let i = 0; i < MAX_NEW_NAMES_PER_DAY + 10; i++) await recordNames(h.control, c.tenantId, `Floodmake${String.fromCharCode(97 + (i % 26))}${Math.floor(i / 26)}`, "");
    const mine = await withPlatform(h.control, async (q) => Number((await q.query<{ n: string }>("select count(*)::text as n from public.vehicle_name_uses where tenant_id = $1", [c.tenantId])).rows[0].n));
    expect(mine).toBe(MAX_NEW_NAMES_PER_DAY);
    await recordNames(h.control, a.tenantId, "Zotye", "");           // already queued: still counted
    expect((await one("Zotye", null)).uses).toBeGreaterThan(2);
  });
});

describe("what each company's drop-down offers", () => {
  it("shows a pending name to the company that typed it, and to no one else", async () => {
    const mine = await loadCatalogExtras(h.control, a.tenantId);
    expect(mine.makes).toContain("Zotye");
    expect(mine.models.Zotye).toContain("T600");
    const c = await h.org("Gamma Fleet");
    const theirs = await loadCatalogExtras(h.control, c.tenantId);
    expect(theirs.makes).not.toContain("Zotye");
  });
  it("merges the extras into the built-in list without listing a name twice", () => {
    const cat = mergeCatalog({ makes: ["Zotye", "toyota"], models: { Toyota: ["Hilux", "Corolla Rebuilt Kit"], Zotye: ["T600"] } });
    expect(cat.makes.filter((m) => nameKey(m) === "toyota")).toHaveLength(1);
    expect(cat.modelsOf("Toyota").filter((m) => m === "Hilux")).toHaveLength(1);
    expect(cat.modelsOf("Toyota")).toContain("Corolla Rebuilt Kit");
    expect(cat.modelsOf("Zotye")).toEqual(["T600"]);
  });
});

describe("the operator's decisions", () => {
  it("only the operator can read or decide", async () => {
    const s = await one("Zotye", "T600");
    await expect(listSuggestions(h.control, NOT_OP, "pending")).rejects.toThrow(/Not allowed/);
    await expect(approveSuggestion(h.control, NOT_OP, s.id)).rejects.toThrow(/Not allowed/);
    await expect(rejectSuggestion(h.control, NOT_OP, s.id, "no")).rejects.toThrow(/Not allowed/);
  });
  it("approving a model also brings its make, and both reach every company's list", async () => {
    const s = await one("Zotye", "T600");
    await approveSuggestion(h.control, OP, s.id, { make: "Zotye", model: "T600" });
    const c = await h.org("Delta Fleet");
    const theirs = await loadCatalogExtras(h.control, c.tenantId);
    expect(theirs.makes).toContain("Zotye");
    expect(theirs.models.Zotye).toEqual(["T600"]);
    expect((await rows()).filter((r) => r.make === "Zotye").every((r) => r.status === "approved")).toBe(true);
  });
  it("the spelling can be fixed but the name cannot be changed under the same entry", async () => {
    await recordNames(h.control, a.tenantId, "Kenbo", "");
    const s = await one("Kenbo", null);
    await expect(approveSuggestion(h.control, OP, s.id, { make: "Different" })).rejects.toThrow(/spelling or the capitals/);
    await approveSuggestion(h.control, OP, s.id, { make: "KENBO" });
    expect((await rows()).find((r) => r.make === "KENBO")?.status).toBe("approved");
  });
  it("a decided name cannot be decided again", async () => {
    const all = await withPlatform(h.control, async (q) => (await q.query<{ id: string }>("select id from public.vehicle_name_suggestions where status = 'approved' limit 1")).rows[0]);
    await expect(rejectSuggestion(h.control, OP, all.id, "late")).rejects.toThrow(/already been decided/);
  });
  it("merging folds a spelling variant into a listed name, and later vehicles are saved with the listed one", async () => {
    await recordNames(h.control, a.tenantId, "Toyotta", "Hilux");
    const mk = await one("Toyotta", null), md = await one("Toyotta", "Hilux");
    await expect(mergeSuggestion(h.control, OP, mk.id, { make: "Nope" })).rejects.toThrow(/already on the list/);
    await mergeSuggestion(h.control, OP, mk.id, { make: "toyota" });
    await expect(mergeSuggestion(h.control, OP, md.id, { make: "Toyota", model: "Nope" })).rejects.toThrow(/already on the list/);
    await mergeSuggestion(h.control, OP, md.id, { make: "Toyota", model: "Hilux" });
    expect(await canonicalNames(h.control, "Toyotta", "Hilux")).toEqual({ make: "Toyota", model: "Hilux" });
  });
  it("a model can be merged into another model of the same make", async () => {
    await recordNames(h.control, a.tenantId, "Toyota", "Strange Kit");
    const s = await one("Toyota", "Strange Kit");
    await expect(mergeSuggestion(h.control, OP, s.id, { make: "Toyota", model: "Corolla" })).resolves.toBeUndefined();
  });
  it("rejecting hides the name from every list, keeps the reason, and stops it being counted again", async () => {
    await recordNames(h.control, a.tenantId, "Qwertyuiop", "");
    const s = await one("Qwertyuiop", null);
    await rejectSuggestion(h.control, OP, s.id, "not a vehicle maker");
    expect((await loadCatalogExtras(h.control, a.tenantId)).makes).not.toContain("Qwertyuiop");
    await recordNames(h.control, b.tenantId, "Qwertyuiop", "");
    const rej = (await listSuggestions(h.control, OP, "rejected")).find((r) => r.make === "Qwertyuiop")!;
    expect(rej).toMatchObject({ uses: 1, companies: 1, decision_note: "not a vehicle maker" });
  });
  it("lists what a name can be merged into: the built-in list and approved names", async () => {
    const t = await mergeTargets(h.control, OP);
    expect(t.Toyota).toContain("Hilux");
    expect(t.Zotye).toEqual(["T600"]);
  });
  it("every decision is on the platform audit trail", async () => {
    const n = await withPlatform(h.control, async (q) => Number((await q.query<{ n: string }>("select count(*)::text as n from public.platform_audit_log where table_name = 'vehicle_name_suggestions' and action = 'UPDATE'")).rows[0].n));
    expect(n).toBeGreaterThan(3);
  });
});

describe("settled spelling", () => {
  it("saves a typed name in the list's spelling and an approved name in its approved spelling", async () => {
    expect(await canonicalNames(h.control, "TOYOTA", "land cruiser")).toEqual({ make: "Toyota", model: "Land Cruiser" });
    expect(await canonicalNames(h.control, "kenbo", "")).toEqual({ make: "KENBO", model: "" });
    expect(await canonicalNames(h.control, "Unheard Of", "Thing")).toEqual({ make: "Unheard Of", model: "Thing" });
  });
});
