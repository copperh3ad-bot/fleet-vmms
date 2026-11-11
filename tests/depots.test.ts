import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import { depotNames, listDepots, saveDepot, setDepotActive } from "@/lib/depots/service";
import { getOnboarding } from "@/lib/dashboard/onboarding";

// ADR-093, owner decision F5: each organization keeps its own list of depots and places.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const fm = () => mem("fleet_manager", 92);
const logi = () => mem("logistics", 93);
const req = () => mem("requester", 91);
const aud = () => mem("auditor", 94);
const hr = () => mem("hr", 95);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Depot Co", slug: "depotco", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[91, "requester"], [92, "fleet_manager"], [93, "logistics"], [94, "auditor"], [95, "hr"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
});

describe("keeping the list", () => {
  it("is managed by the administrator, the fleet manager and Logistics, and nobody else", async () => {
    await saveDepot(d, owner(), { name: "Lahore depot", city: "Lahore", kind: "depot" });
    await saveDepot(d, fm(), { name: "Karachi port", city: "Karachi", kind: "port" });
    await saveDepot(d, logi(), { name: "Head office" });
    for (const who of [req(), aud(), hr()]) await expect(saveDepot(d, who, { name: "Somewhere" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listDepots(d, owner())).map((x) => x.name)).toEqual(["Head office", "Karachi port", "Lahore depot"]);
  });

  it("checks the fields and refuses the same name twice, whatever the case or spacing", async () => {
    await expect(saveDepot(d, owner(), { name: "x" })).rejects.toBeInstanceOf(UserError);
    await expect(saveDepot(d, owner(), { name: "Lahore depot", kind: "mountain" })).rejects.toBeInstanceOf(UserError);
    const dup = await saveDepot(d, owner(), { name: "  LAHORE DEPOT " }).catch((e) => e);
    expect(dup).toBeInstanceOf(UserError);
    expect(dup.fields).toEqual({ name: "Already on the list" });
  });

  it("renames a place without clashing with itself, and refuses a rename onto another", async () => {
    const [head, karachi] = await listDepots(d, owner()).then((l) => [l.find((x) => x.name === "Head office")!, l.find((x) => x.name === "Karachi port")!]);
    await saveDepot(d, owner(), { name: "Head office", city: "Islamabad", kind: "office" }, head.id);          // same name, other details
    expect((await listDepots(d, owner())).find((x) => x.id === head.id)).toMatchObject({ city: "Islamabad", kind: "office" });
    await expect(saveDepot(d, owner(), { name: "head office" }, karachi.id)).rejects.toBeInstanceOf(UserError);
  });

  it("takes a place off the list and puts it back, and suggestions show only the places on the list", async () => {
    const l = await listDepots(d, owner());
    const port = l.find((x) => x.name === "Karachi port")!;
    await setDepotActive(d, fm(), port.id, false);
    expect(await depotNames(d, logi())).toEqual(["Head office", "Lahore depot"]);
    expect((await listDepots(d, owner())).map((x) => [x.name, x.active])).toContainEqual(["Karachi port", false]);
    await setDepotActive(d, fm(), port.id, true);
    expect(await depotNames(d, logi())).toContain("Karachi port");
    await expect(setDepotActive(d, req(), port.id, false)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("using the list", () => {
  it("is readable by people who pick a place on a form, and gives no suggestions to those who do not", async () => {
    expect((await listDepots(d, req())).length).toBe(3);                         // a requester asks for cargo and trips
    await expect(listDepots(d, aud())).rejects.toBeInstanceOf(ForbiddenError);
    expect(await depotNames(d, aud())).toEqual([]);                              // no error, simply nothing to suggest
  });

  it("counts the vehicles based at each place", async () => {
    await master.addVehicle(d, owner(), { registration_no: "DEP-001", base_location: "Lahore depot" });
    await master.addVehicle(d, owner(), { registration_no: "DEP-002", base_location: "lahore DEPOT " });
    await master.addVehicle(d, owner(), { registration_no: "DEP-003", base_location: "Karachi port" });
    const l = await listDepots(d, owner());
    expect(Object.fromEntries(l.map((x) => [x.name, x.vehicles]))).toEqual({ "Head office": 0, "Karachi port": 1, "Lahore depot": 2 });
  });

  it("is a step of the Get started walk-through, done once a place exists", async () => {
    const fresh = await provisionTenant(d, { name: "Fresh Co", slug: "freshco", ownerUserId: U(2), ownerName: "Fresh Owner" }, tenantMigrations(), { transform: stripExt });
    const m: Membership = { ...fresh, userId: U(2), role: "tenant_admin", vehicleScope: "all" };
    const step = (await getOnboarding(d, m))!.steps.find((s) => s.key === "depots")!;
    expect(step).toMatchObject({ done: false, href: "depots" });
    await saveDepot(d, m, { name: "Main yard" });
    expect((await getOnboarding(d, m))!.steps.find((s) => s.key === "depots")!.done).toBe(true);
  });

  it("is kept apart for each company", async () => {
    const other = await provisionTenant(d, { name: "Other Co", slug: "otherco", ownerUserId: U(3), ownerName: "Other Owner" }, tenantMigrations(), { transform: stripExt });
    const m: Membership = { ...other, userId: U(3), role: "tenant_admin", vehicleScope: "all" };
    expect(await listDepots(d, m)).toEqual([]);
    await saveDepot(d, m, { name: "Lahore depot" });                              // the same name in another company is no clash
    expect((await listDepots(d, m)).length).toBe(1);
    expect((await listDepots(d, owner())).length).toBe(3);
  });
});
