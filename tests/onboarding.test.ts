import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import type { Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { getOnboarding } from "@/lib/dashboard/onboarding";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number, vehicleScope: "all" | "own" = "all"): Membership => ({ ...t, userId: U(n), role, vehicleScope });
const owner = () => mem("tenant_admin", 1);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);
const status = async (m: Membership) => Object.fromEntries((await getOnboarding(d, m))!.steps.map((s) => [s.key, s.done]));

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Fresh Fleet", slug: "fresh", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[12, "fleet_manager"], [14, "finance"], [15, "auditor"], [11, "requester"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
});

describe("get-started walk-through", () => {
  it("a brand-new company has nothing done, and the steps come in the order they build on each other", async () => {
    const o = (await getOnboarding(d, owner()))!;
    expect(o.steps.map((s) => s.key)).toEqual(["vehicles", "history", "people", "drivers", "workshop", "budget", "papers", "team", "job"]);
    // the owner is an employee already, so "people" and "team" need someone besides them; "history" is not done for vehicles that do not exist
    expect(await status(owner())).toMatchObject({ vehicles: false, history: false, people: false, drivers: false, workshop: false, budget: false, papers: false, team: false, job: false });
  });

  it("each step turns done by itself when the company's own data appears", async () => {
    const emp = await master.saveEmployee(d, owner(), { full_name: "Driver One", employee_no: "E-1" });
    expect((await status(owner())).people).toBe(true);
    const veh = await master.addVehicle(d, owner(), { registration_no: "WALK-1", make: "Toyota", model: "Hilux", employee_id: emp.id, holding_since: "2026-01-01" });
    let s = await status(owner());
    expect(s.vehicles).toBe(true);
    expect(s.drivers).toBe(true);                     // a driver was named when the vehicle was added
    expect(s.history).toBe(false);                    // but nobody has said when it was last serviced
    const step = (await getOnboarding(d, owner()))!.steps.find((x) => x.key === "history")!;
    expect(step.progress).toBe("1 vehicle needs it");
    await raw((q) => q.query("insert into vehicle_service_baselines(vehicle_id, service_type_key, last_done_on) select $1, key, current_date - 30 from service_types limit 1", [veh.id]));
    expect((await status(owner())).history).toBe(true);
    await master.saveVendor(d, owner(), { name: "Ali Motors" });
    expect((await status(owner())).workshop).toBe(true);
    await raw((q) => q.query("insert into budgets(vehicle_id, period_start, period_end, amount) values (null, current_date, current_date + 30, 100000)"));
    expect((await status(owner())).budget).toBe(true);
    expect((await status(owner())).team).toBe(false);
    await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(11), emp.id]));
    expect((await status(owner())).team).toBe(true);  // the owner and one more person with a login
  });

  it("each person sees only the steps their role can act on, and people with none see no walk-through", async () => {
    const keys = async (m: Membership) => ((await getOnboarding(d, m))?.steps.map((s) => s.key)) ?? null;
    expect(await keys(mem("finance", 14))).toEqual(["budget"]);
    expect(await keys(mem("fleet_manager", 12))).toEqual(expect.arrayContaining(["vehicles", "workshop", "budget", "papers", "job"]));
    expect(await keys(mem("fleet_manager", 12))).not.toContain("team");     // inviting people is the administrator's
    expect(await keys(mem("requester", 11, "own"))).toBeNull();
    expect(await keys(mem("auditor", 15))).toBeNull();
  });
});
