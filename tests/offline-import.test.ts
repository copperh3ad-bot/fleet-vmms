// Uploading a filled offline job card form (ADR-022) is the same as raising the card on screen: a draft, through the same
// checks. Nobody gets anything the screen would not have given them.
import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import type { Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { buildJobCardForm, reasonLabel, vehicleLabel } from "@/lib/jobcards/offline-form";
import { importFilledForm, loadFormContext } from "@/lib/jobcards/offline-service";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number, vehicleScope: "all" | "own" = "all"): Membership => ({ ...t, userId: U(n), role, vehicleScope });
const owner = () => mem("tenant_admin", 1);
const driver = () => mem("requester", 11, "own");
const auditor = () => mem("auditor", 15);
const raw = <T,>(m: Membership, fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, m, fn);

/** The blank form as this member got it, filled the way a person would. */
async function fillFor(m: Membership, pick: (labels: { vehicles: string[]; reasons: string[] }) => { vehicle: string; reason: string }, cause = "The engine overheats after a long drive") {
  const ctx = await loadFormContext(d, m);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildJobCardForm(ctx) as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Job card")!;
  const p = pick({ vehicles: ctx.vehicles.map(vehicleLabel), reasons: ctx.reasons.map(reasonLabel) });
  ws.getCell("B6").value = p.vehicle; ws.getCell("B8").value = p.reason; ws.getCell("B9").value = cause;
  ws.getCell("A17").value = "Part"; ws.getCell("B17").value = "Coolant hose"; ws.getCell("C17").value = 2; ws.getCell("D17").value = 3500;
  return { ctx, bytes: new Uint8Array(await wb.xlsx.writeBuffer()) };
}

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  const emp: Record<number, string> = {};
  for (const [n, name] of [[11, "Driver One"], [16, "Driver Two"], [15, "Auditor One"]] as const) {
    emp[n] = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` })).id;
    await raw(owner(), (q) => q.query("update employees set user_id = $1 where id = $2", [U(n), emp[n]]));
  }
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[11, "requester"], [15, "auditor"]] as const) await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  await master.addVehicle(d, owner(), { registration_no: "BKL-245", make: "Isuzu", odometer_km: "1000", employee_id: emp[11], holding_since: "2026-01-01" });
  await master.addVehicle(d, owner(), { registration_no: "BKL-300", make: "Toyota", odometer_km: "500", employee_id: emp[16], holding_since: "2026-01-01" });
});

describe("the form a member is given", () => {
  it("lists only the vehicles that member may raise a card for", async () => {
    expect((await loadFormContext(d, owner())).vehicles.map((v) => v.registration_no).sort()).toEqual(["BKL-245", "BKL-300"]);
    expect((await loadFormContext(d, driver())).vehicles.map((v) => v.registration_no)).toEqual(["BKL-245"]);
  });
});

describe("uploading a filled form", () => {
  it("creates one DRAFT card with its lines, in the uploader's name", async () => {
    const { ctx, bytes } = await fillFor(driver(), (l) => ({ vehicle: l.vehicles[0], reason: l.reasons[0] }));
    const r = await importFilledForm(d, driver(), ctx, { name: "filled.xlsx", bytes });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.jobNo).toMatch(/^JC-\d{6}$/);
    const c = await raw(owner(), async (q) => (await q.query<{ status: string; requested_by: string; n: string }>(
      "select j.status, j.requested_by::text, (select count(*)::text from job_card_lines l where l.job_card_id = j.id) as n from job_cards j where j.id = $1", [r.jobId])).rows[0]);
    expect(c.status).toBe("draft");
    expect(c.n).toBe("1");
  });

  it("a form that is not filled in is refused with the form's own names, and creates nothing", async () => {
    const before = await raw(owner(), async (q) => (await q.query<{ n: string }>("select count(*)::text n from job_cards")).rows[0].n);
    const ctx = await loadFormContext(d, driver());
    const r = await importFilledForm(d, driver(), ctx, { name: "blank.xlsx", bytes: new Uint8Array(await buildJobCardForm(ctx)) });
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.field)).toEqual(["Vehicle", "Reason", "What went wrong"]);
    expect((await raw(owner(), async (q) => (await q.query<{ n: string }>("select count(*)::text n from job_cards")).rows[0].n))).toBe(before);
  });

  it("a requester cannot get a card made for a vehicle that is not theirs, even by editing the file", async () => {
    // The file is built with the full list (as the owner got it), then uploaded by the requester, whose list is shorter.
    const { bytes } = await fillFor(owner(), (l) => ({ vehicle: l.vehicles.find((x) => x.startsWith("BKL-300"))!, reason: l.reasons[0] }));
    const r = await importFilledForm(d, driver(), await loadFormContext(d, driver()), { name: "other.xlsx", bytes });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatchObject({ field: "Vehicle" });
  });

  it("a person without permission to raise job cards gets nothing created", async () => {
    const { ctx, bytes } = await fillFor(auditor(), (l) => ({ vehicle: l.vehicles[0], reason: l.reasons[0] }));
    await expect(importFilledForm(d, auditor(), ctx, { name: "a.xlsx", bytes })).rejects.toThrow(/jobcard\.create|permission|forbidden/i);
  });

  it("a file claiming a lower odometer than the one on record is refused by the same rule as the screen", async () => {
    const ctx = await loadFormContext(d, driver());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildJobCardForm(ctx) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Job card")!;
    ws.getCell("B6").value = vehicleLabel(ctx.vehicles[0]); ws.getCell("B8").value = reasonLabel(ctx.reasons[0]); ws.getCell("B9").value = "Brakes feel soft when stopping"; ws.getCell("B13").value = 10;
    const r = await importFilledForm(d, driver(), ctx, { name: "odo.xlsx", bytes: new Uint8Array(await wb.xlsx.writeBuffer()) });
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.field)).toContain("Odometer");
  });
});
