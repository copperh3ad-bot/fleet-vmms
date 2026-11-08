import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import type { Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { NO_DEPARTMENT, getBoard } from "@/lib/master/board";
import { exportCsv } from "@/lib/exports/service";

// ADR-048 phase 48c: the department on the vehicle list, its filter, the export and the import.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const mgr = () => mem("fleet_manager", 12);
const log = () => mem("logistics", 20);

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Echo Foods", slug: "echo", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[12, "fleet_manager"], [20, "logistics"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  const mk = async (plate: string, cls: string, dept?: string) => {
    const v = await master.addVehicle(d, owner(), { registration_no: plate, make: "Make", model: "Model", vehicle_class: cls });
    if (dept) await master.setVehicleDepartment(d, owner(), v.id, dept);
  };
  await mk("LST-TRK-1", "truck", "Logistics");
  await mk("LST-TRK-2", "truck", "Logistics");
  await mk("LST-LDR-1", "forklift", "Operations");
  await mk("LST-VAN-1", "van");
  await withTenant(d, owner(), (q) => q.query("update role_departments set sees_all_vehicles = false where role_key = 'logistics'"));   // these tests cover a department role limited to its own department; Logistics sees the whole fleet by default (ADR-075, tests/dept-whole-fleet.test.ts)
});

describe("department on the vehicle list", () => {
  it("carries the vehicle's own department and offers the departments in use", async () => {
    const b = await getBoard(d, mgr());
    expect(b.total).toBe(4);
    expect(b.rows.find((r) => r.registration_no === "LST-TRK-1")!.department).toBe("Logistics");
    expect(b.rows.find((r) => r.registration_no === "LST-VAN-1")!.department).toBeNull();
    expect(b.departments).toEqual(["Logistics", "Operations"]);
    expect(b.hasGeneral).toBe(true);
  });

  it("filters by department, ignoring case, and by no department", async () => {
    expect((await getBoard(d, mgr(), { dept: "logistics" })).rows.map((r) => r.registration_no)).toEqual(["LST-TRK-1", "LST-TRK-2"]);
    expect((await getBoard(d, mgr(), { dept: "Operations" })).total).toBe(1);
    expect((await getBoard(d, mgr(), { dept: NO_DEPARTMENT })).rows.map((r) => r.registration_no)).toEqual(["LST-VAN-1"]);
    expect((await getBoard(d, mgr(), { dept: "Nowhere" })).total).toBe(0);
    expect((await getBoard(d, mgr(), { dept: "Logistics", q: "TRK-2" })).total).toBe(1);        // the search narrows within it
  });

  it("a logistics login sees only its own vehicles, no choice to make, and cannot filter its way out", async () => {
    const b = await getBoard(d, log());
    expect(b.total).toBe(2);
    expect(b.departments).toEqual(["Logistics"]);
    expect(b.hasGeneral).toBe(false);
    expect((await getBoard(d, log(), { dept: "Operations" })).total).toBe(0);
    expect((await getBoard(d, log(), { dept: NO_DEPARTMENT })).total).toBe(0);
  });

  it("the vehicles export has a Department column and honours the filter", async () => {
    const all = await exportCsv(d, mgr(), "vehicles", {});
    expect(all.csv.split("\n")[0]).toContain("Department");
    expect(all.rows).toBe(4);
    const some = await exportCsv(d, mgr(), "vehicles", { dept: "operations" });
    expect(some.rows).toBe(1);
    expect(some.csv).toContain("LST-LDR-1");
    expect((await exportCsv(d, log(), "vehicles", {})).rows).toBe(2);
  });
});

describe("department in the vehicle import", () => {
  const csv = (rows: string[]) => ["registration_no,department", ...rows].join("\n");

  it("accepts the column, previews it, and sets the department with one spelling per name", async () => {
    const text = csv(["IMP-1,logistics", "IMP-2,  Cold   Chain ", "IMP-3,cold chain", "IMP-4,"]);
    const pre = await master.previewVehicleImport(d, owner(), text);
    expect(pre.failed).toBe(0);
    expect(pre.unknownColumns).toEqual([]);
    expect(await master.commitVehicleImport(d, owner(), text)).toEqual({ imported: 4 });
    const dept = async (plate: string) => (await withTenant(d, owner(), (q) => q.query<{ department: string | null }>("select department from vehicles where registration_no = $1", [plate]))).rows[0].department;
    expect(await dept("IMP-1")).toBe("Logistics");           // an existing spelling wins
    expect(await dept("IMP-2")).toBe("Cold Chain");          // extra spaces folded
    expect(await dept("IMP-3")).toBe("Cold Chain");          // the first spelling in the file wins
    expect(await dept("IMP-4")).toBeNull();
  });

  it("refuses an over-long department name and saves nothing", async () => {
    const pre = await master.previewVehicleImport(d, owner(), csv([`IMP-9,${"x".repeat(61)}`]));
    expect(pre.failed).toBe(1);
    expect(pre.rows[0].errors.join(" ")).toMatch(/department/);
    await expect(master.commitVehicleImport(d, owner(), csv([`IMP-9,${"x".repeat(61)}`]))).rejects.toThrow(/nothing was imported/);
  });

  it("a file without the column still imports as before", async () => {
    expect(await master.commitVehicleImport(d, owner(), "registration_no\nIMP-20")).toEqual({ imported: 1 });
  });
});

describe("department on the Add vehicle form", () => {
  const dept = async (id: string) => (await withTenant(d, owner(), (q) => q.query<{ department: string | null }>("select department from vehicles where id = $1", [id]))).rows[0].department;

  it("saves the operating department with the vehicle, one spelling per name, and empty means the general fleet", async () => {
    const a = await master.addVehicle(d, owner(), { registration_no: "ADD-1", make: "M", model: "M", vehicle_class: "truck", department: "logistics" });
    const b = await master.addVehicle(d, owner(), { registration_no: "ADD-2", make: "M", model: "M", vehicle_class: "truck", department: "  Fresh   Produce " });
    const c = await master.addVehicle(d, owner(), { registration_no: "ADD-3", make: "M", model: "M", vehicle_class: "truck", department: "fresh produce" });
    const e = await master.addVehicle(d, owner(), { registration_no: "ADD-4", make: "M", model: "M", vehicle_class: "truck", department: "" });
    expect(await dept(a.id)).toBe("Logistics");          // an existing spelling wins
    expect(await dept(b.id)).toBe("Fresh Produce");
    expect(await dept(c.id)).toBe("Fresh Produce");
    expect(await dept(e.id)).toBeNull();
  });

  it("refuses a name over 60 letters and saves nothing", async () => {
    await expect(master.addVehicle(d, owner(), { registration_no: "ADD-5", make: "M", model: "M", vehicle_class: "truck", department: "x".repeat(61) })).rejects.toThrow(/highlighted/);
    expect((await withTenant(d, owner(), (q) => q.query("select 1 from vehicles where registration_no = 'ADD-5'"))).rows).toHaveLength(0);
  });

  it("a logistics login still cannot add a vehicle, with or without a department", async () => {
    await expect(master.addVehicle(d, log(), { registration_no: "ADD-6", make: "M", model: "M", vehicle_class: "truck", department: "Logistics" })).rejects.toThrow();
  });
});
