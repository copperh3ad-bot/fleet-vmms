import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as od from "@/lib/odometer/service";
import { submitViaLink } from "@/lib/odometer/link";

let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: string): Membership => ({ ...t, userId: `00000000-0000-0000-0000-0000000000${n}`, role, vehicleScope: "all" });
const mgr = () => mem("fleet_manager", "12");
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, mem("tenant_admin", "01"), fn);
const car: Record<string, string> = {};
let cycle: string;
let links: od.NewLink[];
const tokenOf = (plate: string) => links.find((l) => l.plate === plate)!.token;
const rowOf = async (plate: string) => (await od.getCycle(d, mgr(), cycle))!.rows.find((r) => r.registration_no === plate)!;

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: "00000000-0000-0000-0000-000000000001", ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  for (const [plate, make, model] of [["N-1", "Toyota", "Hilux"], ["N-2", "Suzuki", "Bolan"], ["LOW-1", "Hino", "500"], ["FAST-1", "Isuzu", "D-Max"], ["WAIT-1", "Honda", "City"]] as const)
    car[plate] = (await master.addVehicle(d, mem("tenant_admin", "01"), { registration_no: plate, make, model, odometer_km: "10000" })).id;
  // the last reading was 10 days ago on three cars and 2 days ago on the fast one
  await raw(async (q) => {
    await q.query("update vehicles set odometer_updated_at = now() - interval '10 days' where registration_no in ('N-1','N-2','LOW-1','WAIT-1')");
    await q.query("update vehicles set odometer_updated_at = now() - interval '2 days' where registration_no = 'FAST-1'");
    await q.query("update vehicles set odometer_updated_at = now() - interval '52 days' where registration_no = 'WAIT-1'");
  });
  cycle = await od.openCycle(d, mgr(), "2031-09", "2031-09-25");
  links = await od.createLinks(d, mgr(), cycle);
});

describe("cycle review", () => {
  it("waiting vehicles show how stale their last reading is and when a reminder was last made", async () => {
    const c = (await od.getCycle(d, mgr(), cycle))!;
    expect(c.counts).toMatchObject({ total: 5, pending: 5, review: 0, held: 0, approved: 0 });
    const w = c.rows.find((r) => r.registration_no === "WAIT-1")!;
    expect(w.stale_days).toBe(52);
    expect(w.last_link_at).not.toBeNull();                      // links were made above
    expect(w.verdict).toBeNull();
    expect(c.cycle.days_left).toBeGreaterThan(-100000);
    expect(c.rules).toEqual({ maxKmPerDay: 800, staleDays: 45 });
  });

  it("classifies a normal reading, one below the last, and one that is too far too fast", async () => {
    expect(await submitViaLink(d, tokenOf("N-1"), "10670")).toBe("ok");
    expect(await submitViaLink(d, tokenOf("N-2"), "10420")).toBe("ok");
    expect(await submitViaLink(d, tokenOf("LOW-1"), "9540")).toBe("ok");
    expect(await submitViaLink(d, tokenOf("FAST-1"), "12900")).toBe("ok");        // 2,900 km in 2 days
    const n1 = await rowOf("N-1"), low = await rowOf("LOW-1"), fast = await rowOf("FAST-1");
    expect(n1).toMatchObject({ verdict: "normal", change_km: 670 });
    expect(n1.km_per_day).toBeGreaterThan(0);
    expect(n1.km_per_day).toBeLessThan(800);
    expect(low).toMatchObject({ verdict: "lower", change_km: -460 });
    expect(fast.verdict).toBe("too_fast");
    expect(fast.km_per_day).toBeGreaterThan(800);
    const c = (await od.getCycle(d, mgr(), cycle))!;
    expect(c.counts).toMatchObject({ review: 4, held: 2, pending: 1, approved: 0 });
  });

  it("bulk approval takes only the normal readings, and the held ones stay", async () => {
    expect(await od.approveNormalReadings(d, mgr(), cycle)).toBe(2);              // N-1 and N-2
    const c = (await od.getCycle(d, mgr(), cycle))!;
    expect(c.counts).toMatchObject({ approved: 2, review: 2, held: 2, pending: 1 });
    expect((await rowOf("N-1")).status).toBe("approved");
    expect((await rowOf("LOW-1")).status).toBe("submitted");
    expect(await raw(async (q) => (await q.query<{ km: string }>("select odometer_km::text km from vehicles where registration_no = 'N-1'")).rows[0].km)).toBe("10670.0");
    expect(await raw(async (q) => (await q.query<{ km: string }>("select odometer_km::text km from vehicles where registration_no = 'LOW-1'")).rows[0].km)).toBe("10000.0");   // not moved
    expect(await od.approveNormalReadings(d, mgr(), cycle)).toBe(0);               // nothing left that is normal
  });

  it("a held reading is accepted only with a note, or sent back so the driver can answer again", async () => {
    const low = await rowOf("LOW-1");
    await expect(od.reviewReading(d, mgr(), low.id, "approve")).rejects.toBeInstanceOf(UserError);
    await expect(od.reviewReading(d, mgr(), low.id, "approve", "ok")).rejects.toBeInstanceOf(UserError);
    await od.reviewReading(d, mgr(), low.id, "approve", "Instrument cluster replaced on the 18th, checked with the workshop");
    expect(await raw(async (q) => (await q.query<{ km: string }>("select odometer_km::text km from vehicles where registration_no = 'LOW-1'")).rows[0].km)).toBe("9540.0");
    const fast = await rowOf("FAST-1");
    await od.reviewReading(d, mgr(), fast.id, "reject", "Check for a missing digit please");
    const again = await od.createLinks(d, mgr(), cycle, [fast.id]);
    expect(again).toHaveLength(1);
    expect(await submitViaLink(d, again[0].token, "10950")).toBe("ok");
    expect((await rowOf("FAST-1")).verdict).toBe("normal");
  });

  it("a closed cycle cannot be bulk approved", async () => {
    const closed = await od.openCycle(d, mgr(), "2031-10", "2031-10-25");
    await od.closeCycle(d, mgr(), closed);
    await expect(od.approveNormalReadings(d, mgr(), closed)).rejects.toThrow(/closed/);
    await expect(od.approveNormalReadings(d, mgr(), "00000000-0000-4000-8000-0000000000aa")).rejects.toThrow(/closed/);
  });

  it("only people who review readings, and only their own workspace", async () => {
    for (const role of ["requester", "finance", "auditor", "vendor"]) {
      await expect(od.getCycle(d, mem(role, "40"), cycle)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(od.approveNormalReadings(d, mem(role, "40"), cycle)).rejects.toBeInstanceOf(ForbiddenError);
    }
    const other = await provisionTenant(d, { name: "Other", slug: "other" }, tenantMigrations(), { transform: stripExt });
    expect(await od.getCycle(d, { ...other, userId: mgr().userId, role: "fleet_manager", vehicleScope: "all" }, cycle)).toBeNull();
  });
});
