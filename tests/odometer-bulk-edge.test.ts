import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import type { Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import * as od from "@/lib/odometer/service";
import { submitViaLink } from "@/lib/odometer/link";

let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: string): Membership => ({ ...t, userId: `00000000-0000-0000-0000-0000000000${n}`, role, vehicleScope: "all" });
const mgr = () => mem("fleet_manager", "12");
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, mem("tenant_admin", "01"), fn);

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Edge Textiles", slug: "edge", ownerUserId: "00000000-0000-0000-0000-000000000001", ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
});

describe("bulk approval when the last reading is a fraction of a day over a whole number", () => {
  it("a reading the database would hold is left waiting, and the others are still approved", async () => {
    for (const plate of ["EDGE-1", "EDGE-2"]) await master.addVehicle(d, mem("tenant_admin", "01"), { registration_no: plate, make: "Toyota", model: "Hilux", odometer_km: "10000" });
    // 1.2 days since the last reading: 1,000 km is 833 km a day to the database, but only 500 if the days were rounded up
    await raw(async (q) => {
      await q.query("update odometer_readings set read_at = now() - interval '1.2 days'");
      await q.query("update vehicles set odometer_updated_at = now() - interval '1.2 days'");
    });
    const cycle = await od.openCycle(d, mgr(), "2031-10", "2031-10-25");
    const links = await od.createLinks(d, mgr(), cycle);
    const tok = (p: string) => links.find((l) => l.plate === p)!.token;
    await submitViaLink(d, tok("EDGE-1"), "11000");
    await submitViaLink(d, tok("EDGE-2"), "10300");
    expect(await od.approveNormalReadings(d, mgr(), cycle)).toBe(1);
    const rows = (await od.getCycle(d, mgr(), cycle))!.rows;
    expect(rows.find((r) => r.registration_no === "EDGE-2")!.status).toBe("approved");
    const held = rows.find((r) => r.registration_no === "EDGE-1")!;
    expect(held.status).toBe("submitted");
    expect(held.verdict).toBe("too_fast"); // the screen now agrees with the database
  });
});
