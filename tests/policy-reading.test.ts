import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import * as ct from "@/lib/control/service";
import { addPolicy } from "@/lib/master/policy";
import { applyFindings, getReading, startReading, stepReading, type ReadableStore } from "@/lib/master/policy-reading";
import { inspectFile, png } from "@/lib/docs/read-file";
import { stopReader } from "@/lib/docs/ocr";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
const fixture = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/${n}`));
let d: Awaited<ReturnType<typeof testDriver>>;
let a: { tenantId: string; schema: string }, b: { tenantId: string; schema: string };
const mem = (t: { tenantId: string; schema: string }, role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const admin = () => mem(a, "tenant_admin", 1);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, admin(), fn);

const files = new Map<string, Uint8Array>();
const store: ReadableStore = {
  async put(path, bytes) { files.set(path, bytes); },
  async remove(path) { files.delete(path); },
  async signedUrl(path) { return files.has(path) ? `https://signed.example/${path}` : null; },
  async get(path) { return files.get(path) ?? null; },
};

/** Uploads a file as a policy and reads every page. */
async function policyWith(name: string, bytes: Uint8Array, m = admin()) {
  const id = await addPolicy(d, store, m, { title: `Policy ${name}` }, { name, bytes });
  await startReading(d, store, m, id);
  let p = await stepReading(d, store, m, id);
  for (let i = 0; p.status === "reading" && i < 40; i++) p = await stepReading(d, store, m, id);
  return { id, progress: p };
}
const found = async (id: string) => Object.fromEntries((await getReading(d, admin(), id))!.findings.map((f) => [f.id, f]));
const setting = async (k: string) => (await ct.getSettings(d, admin())).find((s) => s.key === k)!.value;

beforeAll(async () => {
  d = await testDriver();
  a = await provisionTenant(d, { name: "Alpha Haulage", slug: "alpha", ownerUserId: U(1), ownerName: "Owner A" }, tenantMigrations(), { transform: stripExt });
  b = await provisionTenant(d, { name: "Bravo Transport", slug: "bravo", ownerUserId: U(2), ownerName: "Owner B" }, tenantMigrations(), { transform: stripExt });
});
afterAll(() => stopReader());

describe("looking at a file", () => {
  it("tells a PDF with text from a scan, and a photo from both", async () => {
    expect(await inspectFile(fixture("policy-text.pdf"))).toMatchObject({ kind: "pdf-text", pages: 2 });
    expect(await inspectFile(fixture("policy-scan.pdf"))).toMatchObject({ kind: "pdf-scan", pages: 2 });
    expect(await inspectFile(fixture("policy-photo.png"))).toMatchObject({ kind: "image", pages: 1 });
  });

  it("says plainly why a file cannot be read", async () => {
    await expect(inspectFile(Uint8Array.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0]))).rejects.toThrow(/Only PDF, JPEG and PNG/);                // a Word file
    await expect(inspectFile(Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))).rejects.toThrow(/HEIC/);
    await expect(inspectFile(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 1, 2, 3]))).rejects.toBeInstanceOf(UserError);       // broken PDF
  });

  it("writes a valid PNG from raw pixels", () => {
    const out = png(Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]), 2, 2, 3);
    expect([...out.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(Buffer.from(out.slice(12, 16)).toString()).toBe("IHDR");
  });
});

describe("reading a policy", () => {
  it("a PDF with text gives the rules without any picture reading", async () => {
    const { id, progress } = await policyWith("text.pdf", fixture("policy-text.pdf"));
    expect(progress).toMatchObject({ status: "ready", pagesDone: 2, pagesTotal: 2 });
    const f = await found(id);
    expect(f.policy_replace_years.value).toBe("7");
    expect(f.policy_free_accidents.value).toBe("3");
    expect(f.policy_accident_gap_months.value).toBe("18");
    expect(f.policy_driver_share_pct.value).toBe("30");
    expect(f.service_oil_change.value).toBe("every 4 months or 6,000 km");
    expect(f.info_fitout_cap.value).toBe("15,000 per vehicle");
    expect(f.info_inspection.value).toBe("quarterly, in March and September");
    expect((await getReading(d, admin(), id))!.confidence).toBeNull();
  });

  it("a scanned PDF is read by OCR and gives the same rules", { timeout: 120_000 }, async () => {
    const { id, progress } = await policyWith("scan.pdf", fixture("policy-scan.pdf"));
    expect(progress).toMatchObject({ status: "ready", pagesDone: 2, pagesTotal: 2 });
    const r = (await getReading(d, admin(), id))!;
    expect(r.kind).toBe("pdf-scan");
    expect(r.confidence).toBeGreaterThan(60);
    const f = Object.fromEntries(r.findings.map((x) => [x.id, x]));
    expect(f.policy_replace_years.value).toBe("7");
    expect(f.policy_free_accidents.value).toBe("3");
    expect(f.policy_accident_gap_months.value).toBe("18");
    expect(f.policy_driver_share_pct.value).toBe("30");
    expect(f.service_oil_change.target).toMatchObject({ months: 4, km: 6000 });
  });

  it("a photo is read the same way", { timeout: 120_000 }, async () => {
    const { id, progress } = await policyWith("photo.png", fixture("policy-photo.png"));
    expect(progress).toMatchObject({ status: "ready", pagesTotal: 1 });
    expect((await found(id)).policy_replace_years.value).toBe("7");
  });

  it("starting again replaces what was read, and a second call for the same page changes nothing", async () => {
    const id = await addPolicy(d, store, admin(), { title: "Twice" }, { name: "t.pdf", bytes: fixture("policy-text.pdf") });
    await startReading(d, store, admin(), id);
    const both = await Promise.all([stepReading(d, store, admin(), id), stepReading(d, store, admin(), id)]);
    expect(both.every((p) => p.pagesDone === 1)).toBe(true);                       // one page saved once, not twice
    await stepReading(d, store, admin(), id);
    expect((await getReading(d, admin(), id))!.status).toBe("ready");
    await startReading(d, store, admin(), id);
    expect(await getReading(d, admin(), id)).toMatchObject({ status: "reading", pagesDone: 0, findings: [] });
  });

  it("a file with no rules in it, or no text at all, says so instead of guessing", { timeout: 60_000 }, async () => {
    const blank = png(new Uint8Array(200 * 200 * 3).fill(255), 200, 200, 3);
    const { id } = await policyWith("blank.png", blank);
    expect(await getReading(d, admin(), id)).toMatchObject({ status: "ready", findings: [] });
    expect((await getReading(d, admin(), id))!.textLength).toBeLessThan(40);
  });

  it("a file that cannot be opened is a failed reading with a plain reason", async () => {
    const id = await addPolicy(d, store, admin(), { title: "Broken" }, { name: "broken.pdf", bytes: fixture("policy-text.pdf") });
    await expect(startReading(d, store, admin(), id)).resolves.toMatchObject({ status: "reading" });
    files.set([...files.keys()].find((k) => k.includes("broken.pdf"))!, Uint8Array.from([0x25, 0x50, 0x44, 0x46, 1, 2, 3, 4]));
    expect(await stepReading(d, store, admin(), id)).toMatchObject({ status: "failed", error: expect.stringMatching(/could not be (opened|read)/) });
  });
});

describe("applying what was found", () => {
  it("applies only the findings chosen, writes the company's settings and service rules, and leaves notes alone", async () => {
    const { id } = await policyWith("apply.pdf", fixture("policy-text.pdf"));
    const lines = await applyFindings(d, admin(), id, ["policy_replace_years", "policy_driver_share_pct", "service_oil_change", "info_fitout_cap"]);
    expect(lines).toHaveLength(3);                                                   // the note was not a thing to apply
    expect(await setting("policy_replace_years")).toBe("7");
    expect(await setting("policy_driver_share_pct")).toBe("30");
    expect(await setting("policy_free_accidents")).toBe("0");                        // not chosen, not changed
    const oil = (await ct.listServiceRules(d, admin())).find((r) => r.key === "oil_change")!;
    expect(oil).toMatchObject({ interval_months: 4, interval_km: "6000.0" });
    const r = (await getReading(d, admin(), id))!;
    expect(r.findings.filter((f) => f.applied).map((f) => f.id).sort()).toEqual(["policy_driver_share_pct", "policy_replace_years", "service_oil_change"]);
  });

  it("creates a service rule that does not exist yet", async () => {
    const { id } = await policyWith("tyres.pdf", fixture("policy-text.pdf"));
    await raw((q) => q.query(`update policy_readings set findings = findings || '[{"id":"service_tyres","label":"Tyre replacement interval","value":"every 40,000 km","target":{"kind":"service","name":"Tyre replacement","km":40000},"quote":"x"}]'::jsonb where policy_id = $1`, [id]));
    await applyFindings(d, admin(), id, ["service_tyres"]);
    expect((await ct.listServiceRules(d, admin())).find((r) => r.label === "Tyre replacement")).toMatchObject({ interval_km: "40000.0", interval_months: null, active: true, is_preventive: true });
  });

  it("uses the stored findings, never numbers from the browser, and the setting still refuses a bad number", async () => {
    const { id } = await policyWith("tamper.pdf", fixture("policy-text.pdf"));
    await raw((q) => q.query(`update policy_readings set findings = jsonb_set(findings, '{3,value}', '"250"') where policy_id = $1`, [id]));
    const bad = (await getReading(d, admin(), id))!.findings.find((f) => f.value === "250")!;
    await expect(applyFindings(d, admin(), id, [bad.id])).rejects.toBeInstanceOf(UserError);
    expect(await setting(bad.id)).not.toBe("250");
    await expect(applyFindings(d, admin(), id, [])).rejects.toThrow(/Choose at least one/);
    await expect(applyFindings(d, admin(), id, ["info_fitout_cap"])).rejects.toThrow(/Choose at least one/);
  });

  it("nothing can be applied before the reading is finished", async () => {
    const id = await addPolicy(d, store, admin(), { title: "Early" }, { name: "early.pdf", bytes: fixture("policy-text.pdf") });
    await expect(applyFindings(d, admin(), id, ["policy_replace_years"])).rejects.toThrow(/nothing ready/);
    await startReading(d, store, admin(), id);
    await expect(applyFindings(d, admin(), id, ["policy_replace_years"])).rejects.toThrow(/nothing ready/);
  });
});

describe("who may, and which company", () => {
  it("only managers read and apply; others are refused", async () => {
    const id = await addPolicy(d, store, admin(), { title: "Guarded" }, { name: "g.pdf", bytes: fixture("policy-text.pdf") });
    for (const role of ["requester", "finance", "auditor", "vendor"]) {
      const m = mem(a, role, 20);
      await expect(startReading(d, store, m, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(stepReading(d, store, m, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getReading(d, m, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(applyFindings(d, m, id, ["policy_replace_years"])).rejects.toBeInstanceOf(ForbiddenError);
    }
    await startReading(d, store, mem(a, "fleet_manager", 12), id);
  });

  it("another company cannot read, step or apply this company's policy, and gets none of its rules", async () => {
    const { id } = await policyWith("private.pdf", fixture("policy-text.pdf"));
    const other = mem(b, "tenant_admin", 2);
    await expect(startReading(d, store, other, id)).rejects.toThrow(/Policy not found/);
    expect(await getReading(d, other, id)).toBeNull();
    await expect(stepReading(d, store, other, id)).rejects.toThrow(/Start reading/);
    await expect(applyFindings(d, other, id, ["policy_replace_years"])).rejects.toThrow(/nothing ready/);
    expect((await ct.getSettings(d, other)).find((s) => s.key === "policy_replace_years")!.value).toBe("0");
  });
});
