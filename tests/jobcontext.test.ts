import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import { seedDemo } from "@/lib/demo/seed";

let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
let manager: Membership;
const mem = (role: string, userId: string, vehicleScope: "all" | "own" = "all"): Membership => ({ ...t, userId, role, vehicleScope });
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, mem("tenant_admin", "00000000-0000-0000-0000-0000000000aa"), fn);
const idOf = (plate: string) => raw(async (q) => (await q.query<{ id: string }>("select id from vehicles where registration_no = $1", [plate])).rows[0].id);
const userOf = (no: string) => raw(async (q) => (await q.query<{ user_id: string }>("select user_id from employees where employee_no = $1", [no])).rows[0].user_id);
let reason: string;

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Demo Workspace", slug: "demo" }, tenantMigrations(), { transform: stripExt });
  await seedDemo(d, t);
  manager = mem("fleet_manager", await userOf("E-201"));
  reason = (await raw(async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'WEAR_TYRES'")).rows[0])).id;
});

describe("job card form context", () => {
  it("shows the vehicle, holder, budget and the last jobs (up to three)", async () => {
    const c = (await jc.getJobContext(d, manager, await idOf("BKL-302")))!;
    expect(c.vehicle).toMatchObject({ registration_no: "BKL-302", holder: "Usman Qureshi", odometer_km: 62400 });
    expect(c.budget).toMatchObject({ budget: 60000 });
    expect(c.lastJobs).toHaveLength(2);                                               // this vehicle has had two jobs
    expect(c.lastJobs[0].created_at >= c.lastJobs[1].created_at).toBe(true);        // newest first
    expect((await jc.getJobContext(d, manager, await idOf("BKL-245")))!.lastJobs.length).toBeLessThanOrEqual(3);
    expect(c.repeatWindowDays).toBe(60);
  });

  it("offers the service that is due, and warns about the same fault raised recently", async () => {
    const overdue = (await jc.getJobContext(d, manager, await idOf("BKL-300")))!;
    expect(overdue.due.some((x) => x.service_type_key === "oil_change" && x.status === "overdue")).toBe(true);
    const fine = (await jc.getJobContext(d, manager, await idOf("BKL-245")))!;
    expect(fine.due).toEqual([]);                                                     // oil change done 20 days ago
    const brakes = (await jc.getJobContext(d, manager, await idOf("BKL-302")))!;
    const rb = brakes.recent.find((r) => r.reason === "Brake wear")!;
    expect(rb.days_ago).toBeGreaterThan(40);
    expect(rb.days_ago).toBeLessThanOrEqual(60);                                      // inside the 60-day window
    expect(brakes.recent.some((r) => r.reason === "Scheduled service" || r.reason === "Routine scheduled service")).toBe(false);   // routine service never counts
    const quiet = (await jc.getJobContext(d, manager, await idOf("ICT-452")))!;
    expect(quiet.recent).toEqual([]);
    expect(quiet.budget).toBeNull();
  });

  it("a person limited to their own vehicle only gets their own, and unknown vehicles give nothing", async () => {
    await raw((q) => q.query("update employees set user_id = '00000000-0000-0000-0000-0000000000d9' where employee_no = 'E-101'"));
    const own = mem("requester", "00000000-0000-0000-0000-0000000000d9", "own");       // Imran holds BKL-245
    expect(await jc.getJobContext(d, own, await idOf("BKL-245"))).not.toBeNull();
    await expect(jc.getJobContext(d, own, await idOf("BKL-300"))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await jc.getJobContext(d, manager, "00000000-0000-4000-8000-0000000000aa")).toBeNull();
    await expect(jc.getJobContext(d, mem("finance", "00000000-0000-0000-0000-0000000000f1"), await idOf("BKL-245"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("another workspace sees nothing", async () => {
    const other = await provisionTenant(d, { name: "Other", slug: "other" }, tenantMigrations(), { transform: stripExt });
    expect(await jc.getJobContext(d, { ...other, userId: manager.userId, role: "fleet_manager", vehicleScope: "all" }, await idOf("BKL-245"))).toBeNull();
  });
});

describe("odometer on a job card", () => {
  const input = (vehicle: string, km: string) => ({ vehicle_id: vehicle, reason_code_id: reason, cause_text: "Front tyre losing air slowly", odometer_km: km, lines: [] });

  it("cannot be lower than the reading on file, in the words the design uses", async () => {
    const v = await idOf("BKL-245");
    const e = await jc.createJobCard(d, manager, { ...input(v, "40000"), requested_by: await raw(async (q) => (await q.query<{ id: string }>("select id from employees where employee_no = 'E-101'")).rows[0].id) }, false).catch((x) => x);
    expect(e).toBeInstanceOf(UserError);
    expect(e.fields.odometer_km).toBe("Must be at least 48,210");
    expect(e.message).toMatch(/at least 48,210 km, the reading on file/);
  });

  it("the same reading, or a higher one, is accepted and moves the vehicle on", async () => {
    const v = await idOf("BKL-245");
    const by = await raw(async (q) => (await q.query<{ id: string }>("select id from employees where employee_no = 'E-101'")).rows[0].id);
    await jc.createJobCard(d, manager, { ...input(v, "48210"), requested_by: by }, false);
    await jc.createJobCard(d, manager, { ...input(v, "48400"), requested_by: by }, false);
    expect(await raw(async (q) => (await q.query<{ km: string }>("select odometer_km::text km from vehicles where id = $1", [v])).rows[0].km)).toBe("48400.0");
    const again = await jc.createJobCard(d, manager, { ...input(v, "48300"), requested_by: by }, false).catch((x) => x);
    expect(again.fields.odometer_km).toBe("Must be at least 48,400");                // now the new reading is the one on file
  });

  it("a card with no odometer is still allowed (drafts)", async () => {
    const v = await idOf("BKL-300");
    const by = await raw(async (q) => (await q.query<{ id: string }>("select id from employees where employee_no = 'E-102'")).rows[0].id);
    await expect(jc.createJobCard(d, manager, { vehicle_id: v, requested_by: by, reason_code_id: reason, cause_text: "Left tyre needs a look", lines: [] }, false)).resolves.toBeDefined();
  });
});
