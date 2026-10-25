// One cost, said the same way everywhere. The dashboard, the reports page, the CSV exports and the own-vehicle panel all read
// v_vehicle_job_cost; this test fails if any of them drifts from the others for the same data.
import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import type { Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import { costOverview } from "@/lib/analytics/service";
import { exportCsv } from "@/lib/exports/service";
import { getDashboard } from "@/lib/dashboard/service";
import { findActiveTenant, membershipIn } from "@/lib/auth/can";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number, vehicleScope: "all" | "own" = "all"): Membership => ({ ...t, userId: U(n), role, vehicleScope });
const owner = () => mem("tenant_admin", 1);
const driver = () => mem("requester", 11, "own");
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);

/** Reads one numeric column of an export, summed. */
async function sumColumn(kind: string, header: string): Promise<number> {
  const csv = (await exportCsv(d, owner(), kind)).csv.replace(/^﻿/, "");
  const [head, ...rows] = csv.split("\r\n").filter(Boolean);
  const idx = head.split(",").indexOf(header);
  expect(idx).toBeGreaterThanOrEqual(0);
  return rows.reduce((a, r) => a + Number(r.split(",")[idx] || 0), 0);
}

let veh1: string, veh2: string, reason: string, emp11: string;
const card = (vehicle: string, by: Membership, cost: string) => jc.createJobCard(d, by, { vehicle_id: vehicle, reason_code_id: reason, cause_text: "Brake pads worn out, needs work", lines: [{ kind: "part", description: "Pads", qty: "1", unit_cost: cost }] }, true);

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  emp11 = (await master.saveEmployee(d, owner(), { full_name: "Driver One", employee_no: "E-11" })).id;
  await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(11), emp11]));
  await withPlatform(d, (q) => q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'requester')", [U(11), t.tenantId]));
  veh1 = (await master.addVehicle(d, owner(), { registration_no: "BKL-245", employee_id: emp11, holding_since: "2026-01-01" })).id;
  veh2 = (await master.addVehicle(d, owner(), { registration_no: "BKL-300" })).id;
  reason = (await raw(async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'WEAR_BRAKES'")).rows[0])).id;
  await card(veh1, driver(), "1000");                                    // submitted: counted at its estimate
  await card(veh2, owner(), "2500");                                     // submitted: counted at its estimate
  await jc.createJobCard(d, owner(), { vehicle_id: veh2, reason_code_id: reason, cause_text: "A draft that is never counted", lines: [{ kind: "part", description: "Pads", qty: "1", unit_cost: "9999" }] }, false);   // draft: not counted
});

describe("cost is the same number on every surface", () => {
  it("dashboard, reports page and both exports agree, and a draft is not counted", async () => {
    const dash = await getDashboard(d, owner());
    const overview = await costOverview(d, owner(), 12);
    const byVehicle = await sumColumn("costs-by-vehicle", "Cost (all time)");
    const jobCards = await sumColumn("job-cards", "Cost counted");
    expect(dash.health?.monthSpend).toBe(3500);
    expect(overview.total).toBe(3500);
    expect(byVehicle).toBe(3500);
    expect(jobCards).toBe(3500);
    expect(overview.jobs).toBe(2);
    expect(overview.byVehicle.reduce((a, x) => a + x.cost, 0)).toBe(3500);
    expect(overview.byMonth.reduce((a, x) => a + x.cost, 0)).toBe(3500);
  });
  it("the own-vehicle panel shows only that person's vehicle, and it adds up to the same ledger", async () => {
    const mine = (await getDashboard(d, driver())).expenses;
    expect(mine?.totalSpend).toBe(1000);
    expect(mine?.monthSpend).toBe(1000);
    expect(mine?.byVehicle.map((v) => v.registration_no)).toEqual(["BKL-245"]);
    const all = (await getDashboard(d, owner())).health?.monthSpend ?? 0;
    expect(all).toBeGreaterThanOrEqual(mine!.monthSpend);
  });
  it("the workspace currency reaches the signed-in context, so labels follow it", async () => {
    await withPlatform(d, (q) => q.query("update public.tenants set currency = 'USD' where id = $1", [t.tenantId]));
    const slug = (await withPlatform(d, async (q) => (await q.query<{ slug: string }>("select slug from public.tenants where id = $1", [t.tenantId])).rows[0].slug));
    const tenant = (await findActiveTenant(d, slug))!;
    expect(tenant.currency).toBe("USD");
    expect((await membershipIn(d, tenant, U(11)))?.currency).toBe("USD");
  });
});
