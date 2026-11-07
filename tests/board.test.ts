import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { FILTERS, PAGE_SIZE, getBoard } from "@/lib/master/board";
import { seedDemo } from "@/lib/demo/seed";

let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const U = "00000000-0000-0000-0000-0000000000aa";
const mem = (role: string, vehicleScope: "all" | "own" = "all", userId = U): Membership => ({ ...t, userId, role, vehicleScope });
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, mem("tenant_admin"), fn);

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Demo Workspace", slug: "demo" }, tenantMigrations(), { transform: stripExt });
  await seedDemo(d, t);
});

describe("vehicle board", () => {
  it("counts per service status add up to all, and each filter returns only its own", async () => {
    const all = await getBoard(d, mem("fleet_manager"));
    expect(all.counts.all).toBe(7);
    expect(FILTERS.filter((f) => f !== "all").reduce((s, f) => s + all.counts[f], 0)).toBe(7);
    for (const f of FILTERS) {
      const b = await getBoard(d, mem("fleet_manager"), { filter: f });
      expect(b.total).toBe(all.counts[f]);
      if (f !== "all") expect(b.rows.every((r) => r.service === f), f).toBe(true);
    }
    expect((await getBoard(d, mem("fleet_manager"), { filter: "nonsense" })).total).toBe(7);          // unknown filter falls back to all
    expect(all.counts.overdue).toBeGreaterThan(0);
    expect(all.counts.no_history).toBeGreaterThan(0);                                                  // the car with no baseline
  });

  it("each row carries what the design shows", async () => {
    const b = await getBoard(d, mem("fleet_manager"));
    const r = (plate: string) => b.rows.find((x) => x.registration_no === plate)!;
    expect(r("BKL-245")).toMatchObject({ holder: "Imran Ali", department: "Logistics", make: "Isuzu", model: "D-Max", year: 2021, odometer_km: 48210 });
    expect(r("BKL-302").budget).toBe(60000);                                                           // the vehicle's own budget
    expect(r("BKL-302").pct).toBeGreaterThan(0);
    expect(r("BKL-302").spent).toBeGreaterThan(0);
    expect(r("BKL-302").jobs_90d).toBe(1);                                                        // the first brake job was 110 days ago
    expect(r("BKL-302").flags.map((f) => f.text)).toContain("Repeat repair");
    expect(r("BKL-300").docs.some((x) => x.type === "token_tax" && x.days_left < 0)).toBe(true);       // expired
    expect(r("BKL-245").docs.some((x) => x.type === "fitness" && x.days_left >= 0)).toBe(true);        // expiring
    expect(r("ICT-452").budget).toBeNull();
    expect(r("ICT-452").service).toBe("no_history");
    expect(b.warnDays).toBe(14);
    expect(b.ruleText).toMatch(/every/);
  });

  it("marks the odometer stale after the configured number of days", async () => {
    await raw((q) => q.query("update vehicles set odometer_updated_at = now() - interval '52 days' where registration_no = 'LEA-118'"));
    const b = await getBoard(d, mem("fleet_manager"));
    const row = b.rows.find((x) => x.registration_no === "LEA-118")!;
    expect(row.odometer_stale).toBe(true);
    expect(row.odometer_age_days).toBe(52);
    expect(row.flags.map((f) => f.text)).toContain("Odometer stale");
    await raw((q) => q.query("update settings set value = '60' where key = 'odometer_stale_days'"));
    expect((await getBoard(d, mem("fleet_manager"))).rows.find((x) => x.registration_no === "LEA-118")!.odometer_stale).toBe(false);
    await raw((q) => q.query("update settings set value = '45' where key = 'odometer_stale_days'"));
  });

  it("searches plate, make, model and holder, with wildcards taken literally", async () => {
    expect((await getBoard(d, mem("fleet_manager"), { q: "hilux" })).total).toBe(3);
    expect((await getBoard(d, mem("fleet_manager"), { q: "imran" })).rows.map((r) => r.registration_no)).toEqual(["BKL-245"]);
    expect((await getBoard(d, mem("fleet_manager"), { q: "bkl-30" })).total).toBe(3);
    expect((await getBoard(d, mem("fleet_manager"), { q: "%" })).total).toBe(0);
  });

  it("a person limited to their own vehicle sees only that one, and counts match", async () => {
    const own = "00000000-0000-0000-0000-0000000000d1";
    await raw((q) => q.query("update employees set user_id = $1 where employee_no = 'E-101'", [own]));
    const b = await getBoard(d, mem("requester", "own", own));
    expect(b.rows.map((r) => r.registration_no)).toEqual(["BKL-245"]);
    expect(b.counts.all).toBe(1);
  });

  it("pages through a long list", async () => {
    await raw((q) => q.query("insert into vehicles(registration_no, make, model, status) select 'PAGE-' || lpad(g::text, 3, '0'), 'Test', 'Van', 'active' from generate_series(1, 30) g"));
    const first = await getBoard(d, mem("fleet_manager"));
    expect(first.total).toBe(37);
    expect(first.pages).toBe(2);
    expect(first.rows).toHaveLength(PAGE_SIZE);
    const second = await getBoard(d, mem("fleet_manager"), { page: 2 });
    expect(second.rows).toHaveLength(37 - PAGE_SIZE);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(37);                   // no overlap
    expect((await getBoard(d, mem("fleet_manager"), { page: 99 })).page).toBe(2);                      // out of range lands on the last page
    expect((await getBoard(d, mem("fleet_manager"), { page: -3 })).page).toBe(1);
    await raw((q) => q.query("delete from vehicles where registration_no like 'PAGE-%'"));
  });

  it("needs vehicle.read, and another workspace sees nothing", async () => {
    await expect(getBoard(d, mem("vendor"))).rejects.toBeInstanceOf(ForbiddenError);
    const other = await provisionTenant(d, { name: "Other", slug: "other" }, tenantMigrations(), { transform: stripExt });
    const b = await getBoard(d, { ...other, userId: U, role: "fleet_manager", vehicleScope: "all" });
    expect(b.rows).toEqual([]);
    expect(b.counts.all).toBe(0);
    expect(b.ruleText).not.toBeNull();            // the default rule exists in every workspace
  });
});
