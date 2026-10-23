// Smoke test: seed the demo workspace, then run the data behind every screen as each kind of person.
// Managers and administrators must get an answer from every loader; other roles must either get one or be refused
// with ForbiddenError, never any other error (a broken query, a missing column, an unhandled null).
import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { seedDemo } from "@/lib/demo/seed";
import { allLoaders } from "./loaders";
import * as master from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import * as od from "@/lib/odometer/service";
import * as cs from "@/lib/compliance/service";
import * as ct from "@/lib/control/service";

let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
let manager: string;
const mem = (role: string, userId = "00000000-0000-0000-0000-0000000000aa"): Membership => ({ ...t, userId, role, vehicleScope: "all" });
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, mem("tenant_admin"), fn);

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Demo Workspace", slug: "demo" }, tenantMigrations(), { transform: stripExt });
  await seedDemo(d, t);
  manager = (await raw(async (q) => (await q.query<{ user_id: string }>("select user_id from employees where employee_no = 'E-202'")).rows[0])).user_id;
});

/** Every screen's loaders, given real ids from the seeded data. */
const loaders = (m: Membership) => allLoaders(d, m, mem("finance"));

describe("every screen's data on the seeded demo workspace", () => {
  it("is not empty where the demo has data", async () => {
    const m = mem("fleet_manager", manager);
    expect((await master.listVehicles(d, m)).length).toBeGreaterThanOrEqual(7);
    expect((await jc.listJobCards(d, m)).length).toBeGreaterThanOrEqual(9);
    expect((await cs.listDocuments(d, m)).length).toBeGreaterThan(0);
    expect((await od.listCycles(d, m)).length).toBeGreaterThan(0);
    expect((await ct.getBudgetBoard(d, m, { filter: "all" })).total).toBeGreaterThan(0);
  });

  it("every loader answers for at least one role, and no role ever gets anything but an answer or a refusal", async () => {
    const answered = new Set<string>(), all = new Set<string>();
    for (const role of ["fleet_manager", "tenant_admin", "finance", "auditor", "requester", "vendor"]) {
      const m = mem(role, role === "fleet_manager" ? manager : undefined);
      const list = await loaders(m).catch((e: unknown) => { expect(`${role} preload: ${e instanceof ForbiddenError ? "refused" : (e as Error).message}`).toBe(`${role} preload: refused`); return []; });
      for (const [name, run] of list) {
        all.add(name);
        const r = await run().then(() => "ok", (e: unknown) => (e instanceof ForbiddenError ? "refused" : `${role} ${name}: ${(e as Error).message}`));
        expect(r === "ok" || r === "refused" ? "fine" : r).toBe("fine");
        if (r === "ok") answered.add(name);
      }
    }
    expect([...all].filter((n) => !answered.has(n))).toEqual([]);
  });
});
