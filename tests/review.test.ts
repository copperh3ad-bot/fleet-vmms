import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as jc from "@/lib/jobcards/service";
import { UserError } from "@/lib/master/service";
import { seedDemo } from "@/lib/demo/seed";

let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, userId: string): Membership => ({ ...t, userId, role, vehicleScope: "all" });
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, mem("tenant_admin", "00000000-0000-0000-0000-0000000000aa"), fn);
const userOf = (no: string) => raw(async (q) => (await q.query<{ user_id: string }>("select user_id from employees where employee_no = $1", [no])).rows[0].user_id);
const cardOf = (plate: string, status: string) => raw(async (q) => (await q.query<{ id: string }>(
  "select jc.id from job_cards jc join vehicles v on v.id = jc.vehicle_id where v.registration_no = $1 and jc.status = $2 order by jc.created_at desc limit 1", [plate, status])).rows[0].id);
const vendorId = (name: string) => raw(async (q) => (await q.query<{ id: string }>("select id from vendors where name = $1", [name])).rows[0].id);
const NOBODY = "00000000-0000-0000-0000-0000000000f1";
const MISSING = "00000000-0000-4000-8000-0000000000bb";

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Demo Workspace", slug: "demo" }, tenantMigrations(), { transform: stripExt });
  await seedDemo(d, t);
});

describe("review screen context", () => {
  it("shows the earlier job that came back, the budget impact, the workshop record and the queue", async () => {
    const approver = mem("fleet_manager", await userOf("E-202"));
    const job = await cardOf("BKL-302", "submitted");
    const r = (await jc.getReviewContext(d, approver, job))!;
    expect(r.vehicle).toMatchObject({ holder: "Usman Qureshi", odometer_km: 62400 });
    expect(r.repeat).toMatchObject({ reason: "Brake wear", vendor: "Al-Noor Auto Works" });
    expect(r.repeat!.days_ago).toBeGreaterThan(40);
    expect(r.budget!.budget).toBe(60000);
    expect(r.budget!.after).toBeGreaterThan(r.budget!.spent);                             // approving adds the estimate
    expect(r.vendors.find((v) => v.name === "Al-Noor Auto Works")!.warning).toMatch(/Did the .* brake wear job\. Ask about guarantee\./);
    expect(r.vendors.find((v) => v.name === "Al-Noor Auto Works")!.jobs).toBeGreaterThanOrEqual(2);
    expect(r.vendors.find((v) => v.name === "Quick Fix Motors")!.warning).toBeNull();
    expect(r.vendors.find((v) => v.name === "Metro Tyre House")).toMatchObject({ jobs: 0, avg_days: null });   // no history yet
    expect(r.queue!.total).toBe(5);
    // walking forward through the queue reaches the end and never loops
    const seen = new Set<string>();
    let cur: string | null = job;
    while (cur && !seen.has(cur)) { seen.add(cur); cur = (await jc.getReviewContext(d, approver, cur))!.queue?.next ?? null; }
    expect(cur).toBeNull();
    expect(seen.size).toBeGreaterThanOrEqual(1);
  });

  it("people who cannot assign a workshop get no workshop list; unknown cards give nothing; workshops are refused", async () => {
    const job = await cardOf("BKL-302", "submitted");
    expect((await jc.getReviewContext(d, mem("finance", NOBODY), job))!.vendors).toEqual([]);
    expect(await jc.getReviewContext(d, mem("fleet_manager", await userOf("E-201")), MISSING)).toBeNull();
    await expect(jc.getReviewContext(d, mem("vendor", NOBODY), job)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("approve and assign in one step", () => {
  it("the person who raised the card cannot do it, and nothing changes", async () => {
    const usman = "00000000-0000-0000-0000-0000000000c2";
    await raw((q) => q.query("update employees set user_id = $1 where employee_no = 'E-104'", [usman]));
    const job = await cardOf("BKL-302", "submitted");
    await expect(jc.approveAndAssign(d, mem("fleet_manager", usman), job, { vendorId: await vendorId("Quick Fix Motors") })).rejects.toThrow(/segregation/i);
    expect(await raw(async (q) => (await q.query<{ status: string; vendor_id: string | null }>("select status, vendor_id from job_cards where id = $1", [job])).rows[0])).toEqual({ status: "submitted", vendor_id: null });
  });

  it("needs a workshop, and both permissions", async () => {
    const approver = mem("fleet_manager", await userOf("E-202"));
    const job = await cardOf("BKL-302", "submitted");
    await expect(jc.approveAndAssign(d, approver, job, { vendorId: "" })).rejects.toThrow(/Choose a workshop/);
    const v = await vendorId("Quick Fix Motors");
    await expect(jc.approveAndAssign(d, mem("finance", NOBODY), job, { vendorId: v })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(jc.approveAndAssign(d, mem("requester", NOBODY), job, { vendorId: v })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await raw(async (q) => (await q.query<{ status: string }>("select status from job_cards where id = $1", [job])).rows[0])).status).toBe("submitted");
  });

  it("approves and assigns: both events in order, the approver recorded, the comment kept, the workshop told", async () => {
    const approver = mem("fleet_manager", await userOf("E-202"));
    const job = await cardOf("BKL-302", "submitted");
    // BKL-302 repeats an earlier job (demo data), so the approver must say who pays (ADR-094)
    const refused = await jc.approveAndAssign(d, approver, job, { vendorId: await vendorId("Quick Fix Motors"), comment: "Check the guarantee first" }).catch((e) => e);
    expect(refused).toBeInstanceOf(UserError);
    expect((refused as UserError).fields).toMatchObject({ repeat_payer: expect.any(String), repeat_payer_reason: expect.any(String) });
    expect((await jc.getJobCard(d, approver, job))!.status).toBe("submitted");                    // nothing was approved
    await expect(jc.approveAndAssign(d, approver, job, { vendorId: await vendorId("Quick Fix Motors"), repeatPayer: "workshop", repeatReason: "ok" })).rejects.toBeInstanceOf(UserError);   // too short a reason
    await jc.approveAndAssign(d, approver, job, { vendorId: await vendorId("Quick Fix Motors"), comment: "Check the guarantee first", repeatPayer: "workshop", repeatReason: "Same fault came back inside the guarantee" });
    const c = (await jc.getJobCard(d, approver, job))!;
    expect(c.repeat_payer).toBe("workshop");                                                     // kept on the card with the earlier card it repeats
    expect(c.repeat_payer_reason).toBe("Same fault came back inside the guarantee");
    expect(c.repeat_of_no).toMatch(/^JC-/);
    expect(c.status).toBe("vendor_assigned");
    expect(c.approver_name).toBe("Ayesha Noor");
    expect(c.vendor_name).toBe("Quick Fix Motors");
    expect(c.events.slice(-2).map((e) => e.to_status)).toEqual(["approved", "vendor_assigned"]);
    expect(c.events.at(-2)!.comment).toBe("Check the guarantee first");
  });

  it("re-tagging the reason while approving keeps the requester's original", async () => {
    const approver = mem("fleet_manager", await userOf("E-202"));
    const job = await cardOf("BKL-300", "submitted");
    const misuse = await raw(async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'MISUSE_OVERLOAD'")).rows[0].id);
    await jc.approveAndAssign(d, approver, job, { vendorId: await vendorId("Metro Tyre House"), reasonCodeId: misuse });
    const c = (await jc.getJobCard(d, approver, job))!;
    expect(c.reason_label).toMatch(/overload/i);
    expect(c.requested_reason_label).toMatch(/tyre/i);
  });

  it("a card whose reason is \"previous repair not effective\" repeats the latest earlier job on the vehicle, whatever the window (ADR-094)", async () => {
    const approver = mem("fleet_manager", await userOf("E-202"));
    const pick = await raw(async (q) => (await q.query<{ id: string }>(
      `select jc.id from job_cards jc where jc.status in ('submitted','returned_for_edit','draft')
          and exists (select 1 from job_cards p join reason_codes pr on pr.id = p.reason_code_id where p.vehicle_id = jc.vehicle_id and p.id <> jc.id and p.created_at < jc.created_at
                       and p.status not in ('draft','cancelled','rejected') and pr.category <> 'scheduled_service')
        order by jc.created_at limit 1`)).rows[0]);
    expect(pick).toBeDefined();
    const poor = await raw(async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'REPEAT_POOR_REPAIR'")).rows[0].id);
    await raw((q) => q.query("update job_cards set reason_code_id = $2 where id = $1", [pick.id, poor]));
    expect((await jc.getReviewContext(d, approver, pick.id))!.repeat).not.toBeNull();
  });
});
