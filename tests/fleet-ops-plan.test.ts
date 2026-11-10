import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import type { Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { createCargoRequest, listCargo } from "@/lib/cargo/service";
import { listTrips, tripsEnabled } from "@/lib/trips/service";
import { fleetOpsOn } from "@/lib/billing/fleet-ops";
import { planFrom } from "@/lib/billing/plans";

// ADR-085: trip scheduling and cargo requests are part of Pro. Basic is maintenance management; Pro is the whole fleet.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const req = () => mem("requester", 91);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);
const setPlan = (key: string | null) => withPlatform(d, async (q) => {
  if (key === null) await q.query("delete from public.org_billing where tenant_id = $1", [t.tenantId]);
  else await q.query("update public.org_billing set plan_key = $2 where tenant_id = $1", [t.tenantId, key]);
});
const cargo = { description: "Boxes of samples", quantity_text: "12 cartons, about 300 kg", pickup_place: "Gulberg warehouse, Lahore", pickup_at: "2031-08-10T09:00:00+05:00", pickup_contact: "Imran", pickup_phone: "0300 1234567", drop_place: "Karachi head office", drop_contact: "Saima", drop_phone: "0321 7654321", deliver_by: "2031-08-12T17:00:00+05:00", handling: "Fragile", vehicle_type: "10-tonne truck", department: "Sales" };

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Plan Co", slug: "planco", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  const id = (await master.saveEmployee(d, owner(), { full_name: "Requester One", employee_no: "P-91" })).id;
  await raw((q) => q.query("update employees set user_id = $1, phone = $3 where id = $2", [U(91), id, "0300 9111111"]));
  await withPlatform(d, (q) => q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'requester')", [U(91), t.tenantId]));
  await raw((q) => q.query("insert into settings(key, value) values ('module_trips','1') on conflict (key) do update set value = '1'"));
});

describe("the plan's flag", () => {
  it("is off only when the plan says so: a plan with no row, or silent on it, keeps trips and cargo", () => {
    expect(planFrom({ plan_key: "standard", name: "Basic", status: "active", features: { fleet_ops: false }, limits: null }).fleetOps).toBe(false);
    expect(planFrom({ plan_key: "pro", name: "Pro", status: "active", features: { fleet_ops: true }, limits: null }).fleetOps).toBe(true);
    expect(planFrom({ plan_key: "pro", name: "Pro", status: "active", features: {}, limits: null }).fleetOps).toBe(true);
    expect(planFrom(undefined).fleetOps).toBe(true);
  });
  it("is set by the control-plane migration: Basic false, Pro true", async () => {
    const rows = await withPlatform(d, async (q) => (await q.query<{ key: string; fleet_ops: boolean | null }>("select key, (features->>'fleet_ops')::boolean as fleet_ops from public.plans where key in ('standard','pro')")).rows);
    expect(Object.fromEntries(rows.map((r) => [r.key, r.fleet_ops]))).toEqual({ standard: false, pro: true });
  });
});

describe("a company on Basic", () => {
  it("cannot book trips or ask for cargo, and the trips screens report them off", async () => {
    await setPlan("standard");
    expect(await fleetOpsOn(d, t.tenantId)).toBe(false);
    expect(await tripsEnabled(d, owner())).toBe(false);
    await expect(listTrips(d, owner(), {} as never)).rejects.toThrow(/part of the Pro plan/);
    await expect(createCargoRequest(d, req(), cargo)).rejects.toThrow(/part of the Pro plan/);
    await expect(listCargo(d, owner())).rejects.toThrow(/part of the Pro plan/);
  });
});

describe("a company on Pro, or with no plan row", () => {
  it("keeps trips and cargo", async () => {
    for (const key of ["pro", null]) {
      await setPlan(key);
      expect(await fleetOpsOn(d, t.tenantId)).toBe(true);
      expect(await tripsEnabled(d, owner())).toBe(true);
      expect((await createCargoRequest(d, req(), cargo)).cargo_no).toMatch(/^CR-/);
    }
  });
});
