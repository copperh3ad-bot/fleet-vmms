import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import type { Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import * as an from "@/lib/analytics/service";
import { EXPORT_KINDS, exportCsv } from "@/lib/exports/service";
import { getDashboard } from "@/lib/dashboard/service";
import { seedDemo } from "@/lib/demo/seed";

let d: Awaited<ReturnType<typeof testDriver>>;
let empty: { tenantId: string; schema: string };
let other: { tenantId: string; schema: string };
const mem = (t: { tenantId: string; schema: string }, role: string): Membership => ({ ...t, userId: "00000000-0000-0000-0000-0000000000aa", role, vehicleScope: "all" });
const rows = <T,>(t: { schema: string }, sql: string) => withTenant(d, { schema: t.schema, userId: "00000000-0000-0000-0000-0000000000aa", role: "tenant_admin" }, async (q) => (await q.query<T>(sql)).rows);

beforeAll(async () => {
  d = await testDriver();
  empty = await provisionTenant(d, { name: "Demo Workspace", slug: "demo" }, tenantMigrations(), { transform: stripExt });      // no owner: created by the operator script
  other = await provisionTenant(d, { name: "Real Customer", slug: "real", ownerUserId: "00000000-0000-0000-0000-000000000001", ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  await master.addVehicle(d, mem(other, "tenant_admin"), { registration_no: "REAL-1" });
});

describe("demo seed", () => {
  it("fills an empty workspace and says what it added", async () => {
    const s = await seedDemo(d, empty);
    expect(s).toMatchObject({ employees: 8, vendors: 3, vehicles: 7, budgets: 2 });
    expect(s.jobCards).toBe(12);
    expect(s.documents).toBeGreaterThan(15);
  });

  it("refuses to run again, and refuses a workspace that already has vehicles", async () => {
    await expect(seedDemo(d, empty)).rejects.toThrow(/already has vehicles/);
    await expect(seedDemo(d, other)).rejects.toThrow(/already has vehicles/);
    expect(await rows(other, "select registration_no from vehicles")).toEqual([{ registration_no: "REAL-1" }]);      // untouched
    expect(await rows(other, "select 1 from employees where employee_no like 'E-%'")).toHaveLength(0);
  });

  it("creates people without logins: nobody can sign in as them", async () => {
    const members = await withPlatform(d, async (q) => (await q.query("select 1 from public.tenant_memberships where tenant_id = $1", [empty.tenantId])).rows);
    expect(members).toHaveLength(0);
  });

  it("covers every stage of a job card", async () => {
    const st = (await rows<{ status: string }>(empty, "select distinct status from job_cards")).map((r) => r.status).sort();
    expect(st).toEqual(expect.arrayContaining(["closed", "draft", "invoiced", "in_progress", "quotation_received", "returned_for_edit", "submitted"]));
    expect((await rows<{ c: number }>(empty, "select count(*)::int c from job_card_events"))[0].c).toBeGreaterThan(40);
  });

  it("gives the reports and flags something to show", async () => {
    const m = mem(empty, "fleet_manager");
    const flags = (await an.getFlags(d, m)).map((f) => `${f.registration_no}:${f.flag}`);
    expect(flags).toEqual(expect.arrayContaining(["BKL-302:repeat_repair", "BKL-300:document_expired", "BKL-245:document_due"]));
    const w = await an.whyItKeepsBreaking(d, m);
    expect(w.repeats.some((r) => r.registration_no === "BKL-302" && r.previous_vendor === "Al-Noor Auto Works")).toBe(true);
    const c = await an.costOverview(d, m, 12);
    expect(c.total).toBeGreaterThan(100000);
    expect(c.byVendor.map((x) => x.label)).toContain("Al-Noor Auto Works");
  });

  it("an invoice with an extra line is waiting for finance, and the dashboards have content", async () => {
    const inv = await rows<{ unapproved_lines: number; variance: string }>(empty, "select unapproved_lines::int, variance::text from v_invoice_check where unapproved_lines > 0");
    expect(inv.length).toBeGreaterThan(0);
    const f = await getDashboard(d, mem(empty, "finance"));
    expect(f.actions.map((a) => a.key)).toContain("invoices");
    const mgr = await getDashboard(d, mem(empty, "fleet_manager"));
    expect(mgr.actions.map((a) => a.key)).toEqual(expect.arrayContaining(["quotes", "docs_expired"]));
    expect(mgr.health!.vehicles.active).toBe(7);
    expect(mgr.health!.fleetBudget).toMatchObject({ budget: 900000 });
  });

  it("every export runs on it", async () => {
    for (const kind of EXPORT_KINDS) {
      const r = await exportCsv(d, mem(empty, kind === "invoices" ? "finance" : "fleet_manager"), kind);
      expect(r.csv.length, kind).toBeGreaterThan(20);
    }
    expect((await exportCsv(d, mem(empty, "fleet_manager"), "vehicles")).rows).toBe(7);
  });

  it("leaves other workspaces alone", async () => {
    expect((await getDashboard(d, mem(other, "fleet_manager"))).actions).toEqual([]);
    expect((await rows<{ c: number }>(other, "select count(*)::int c from job_cards"))[0].c).toBe(0);
  });
});
