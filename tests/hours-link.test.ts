import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import type { Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import * as od from "@/lib/odometer/service";
import * as hrs from "@/lib/hours/service";
import { lookupLink, submitViaLink } from "@/lib/odometer/link";
import { resetRateLimits } from "@/lib/rate-limit";

// Engine hours through the driver's single-use link (ADR-048). The link writes only a submission; an approver turns it into readings.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const mgr = () => mem("fleet_manager", 12);

let truck: string, forklift: string;
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);
const vehicleRow = (id: string) => raw(async (q) => (await q.query<{ odometer_km: string; engine_hours: string | null }>("select odometer_km::text, engine_hours::text from vehicles where id = $1", [id])).rows[0]);
const subRow = (cycle: string, vehicle: string) => raw(async (q) => (await q.query<{ id: string; status: string; reading_km: string | null; reading_hours: string | null }>(
  "select id, status, reading_km::text, reading_hours::text from odometer_submissions where cycle_id = $1 and vehicle_id = $2", [cycle, vehicle])).rows[0]);
const hourRows = (id: string) => raw(async (q) => (await q.query<{ reading_hours: string; status: string; source: string }>("select reading_hours::text, status, source from engine_hour_readings where vehicle_id = $1 order by created_at", [id])).rows);
let month = 0;
async function freshCycle() {
  month += 1;
  const period = `${2032 + Math.floor((month - 1) / 12)}-${String(((month - 1) % 12) + 1).padStart(2, "0")}`;
  const cycle = await od.openCycle(d, mgr(), period, `${period}-25`);
  const links = await od.createLinks(d, mgr(), cycle);
  return { cycle, tokenOf: (plate: string) => links.find((l) => l.plate === plate)!.token };
}

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Hours Link Co", slug: "hlink", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  const e = await master.saveEmployee(d, owner(), { full_name: "Driver One", employee_no: "E-1", phone: "+92 300 1234567" });
  truck = (await master.addVehicle(d, owner(), { registration_no: "HL-TRK-1", odometer_km: "1000", employee_id: e.id, holding_since: "2026-01-01", vehicle_class: "truck" })).id;
  forklift = (await master.addVehicle(d, owner(), { registration_no: "HL-FLT-1", odometer_km: "0", employee_id: e.id, holding_since: "2026-01-01", vehicle_class: "forklift" })).id;
  await hrs.setTracksHours(d, owner(), forklift, true);
  await hrs.recordEngineHours(d, owner(), forklift, "1000");
  await raw((q) => q.query("update engine_hour_readings set read_at = now() - interval '60 days' where vehicle_id = $1", [forklift]));          // so later readings are not "too many hours in one day"
});
beforeEach(() => resetRateLimits());

describe("the link page asks for hours only when the vehicle has an hour meter", () => {
  it("tells the page whether to show the hour field", async () => {
    const { tokenOf } = await freshCycle();
    expect((await lookupLink(d, tokenOf("HL-FLT-1")))?.tracksHours).toBe(true);
    expect((await lookupLink(d, tokenOf("HL-TRK-1")))?.tracksHours).toBe(false);
  });
});

describe("sending hours through the link", () => {
  it("saves hours with the odometer as a submission and moves nothing until it is approved", async () => {
    const { cycle, tokenOf } = await freshCycle();
    expect(await submitViaLink(d, tokenOf("HL-FLT-1"), "10", "1040.5")).toBe("ok");
    const s = await subRow(cycle, forklift);
    expect([s.status, s.reading_km, s.reading_hours]).toEqual(["submitted", "10.0", "1040.5"]);
    expect((await vehicleRow(forklift)).engine_hours).toBe("1000.0");          // the link alone moves nothing
    expect(await hourRows(forklift)).toHaveLength(1);
  });

  it("accepts hours alone for a vehicle that has no odometer to read", async () => {
    const { cycle, tokenOf } = await freshCycle();
    expect(await submitViaLink(d, tokenOf("HL-FLT-1"), "", "1100")).toBe("ok");
    const s = await subRow(cycle, forklift);
    expect([s.status, s.reading_km, s.reading_hours]).toEqual(["submitted", null, "1100.0"]);
  });

  it("approval writes the hour reading, and the vehicle's hours move", async () => {
    const { cycle, tokenOf } = await freshCycle();
    await submitViaLink(d, tokenOf("HL-FLT-1"), "", "1180");
    const s = await subRow(cycle, forklift);
    await od.reviewReading(d, mgr(), s.id, "approve");
    expect((await subRow(cycle, forklift)).status).toBe("approved");
    expect((await vehicleRow(forklift)).engine_hours).toBe("1180.0");
    const rows = await hourRows(forklift);
    expect(rows[rows.length - 1]).toEqual({ reading_hours: "1180.0", status: "accepted", source: "manual" });
  });

  it("a lower hour reading is flagged and needs a note, like a lower odometer", async () => {
    const { cycle, tokenOf } = await freshCycle();
    await submitViaLink(d, tokenOf("HL-FLT-1"), "", "900");
    const s = await subRow(cycle, forklift);
    await expect(od.reviewReading(d, mgr(), s.id, "approve")).rejects.toThrow(/flagged|note/i);
    expect((await subRow(cycle, forklift)).status).toBe("submitted");          // nothing half-done
    expect((await vehicleRow(forklift)).engine_hours).toBe("1180.0");
    await od.reviewReading(d, mgr(), s.id, "approve", "Meter was replaced, new unit starts lower");
    expect((await vehicleRow(forklift)).engine_hours).toBe("900.0");
  });

  it("bulk approval leaves a submission that carries hours for a person to look at", async () => {
    const { cycle, tokenOf } = await freshCycle();
    await submitViaLink(d, tokenOf("HL-FLT-1"), "5", "1200");
    await submitViaLink(d, tokenOf("HL-TRK-1"), "1100");
    expect(await od.approveNormalReadings(d, mgr(), cycle)).toBe(1);
    expect((await subRow(cycle, forklift)).status).toBe("submitted");
    expect((await subRow(cycle, truck)).status).toBe("approved");
  });
});

describe("what the link refuses", () => {
  it("refuses hours for a vehicle with no hour meter, and burns nothing", async () => {
    const { cycle, tokenOf } = await freshCycle();
    expect(await submitViaLink(d, tokenOf("HL-TRK-1"), "1200", "50")).toBe("invalid");
    expect((await subRow(cycle, truck)).status).toBe("pending");
    expect(await submitViaLink(d, tokenOf("HL-TRK-1"), "1200")).toBe("ok");          // the same link still works for a plain reading
  });

  it("refuses an empty submission and anything that is not a number", async () => {
    const { tokenOf } = await freshCycle();
    for (const [km, h] of [["", ""], ["abc", ""], ["", "12x"], ["5", "1.25"], ["-5", ""], ["", "99999999"]]) expect(await submitViaLink(d, tokenOf("HL-FLT-1"), km, h)).toBe("bad_value");
    expect(await submitViaLink(d, tokenOf("HL-FLT-1"), "", "1300")).toBe("ok");          // none of the refusals used the link up
  });

  it("works once", async () => {
    const { tokenOf } = await freshCycle();
    const token = tokenOf("HL-FLT-1");
    expect(await submitViaLink(d, token, "", "1400")).toBe("ok");
    expect(await submitViaLink(d, token, "", "1500")).toBe("invalid");
  });
});
