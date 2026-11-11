import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import * as vf from "@/lib/vendorflow/service";
import * as cs from "@/lib/compliance/service";
import * as od from "@/lib/odometer/service";
import { cell, csvFileName, toCsv } from "@/lib/exports/csv";
import { EXPORT_KINDS, MAX_EXPORT_ROWS, exportCsv } from "@/lib/exports/service";
import { getDashboard } from "@/lib/dashboard/service";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number, vehicleScope: "all" | "own" = "all"): Membership => ({ ...t, userId: U(n), role, vehicleScope });
const owner = () => mem("tenant_admin", 1);
const driver = () => mem("requester", 11, "own");
const driver2 = () => mem("requester", 16, "own");
const mgr = () => mem("fleet_manager", 12);
const mgr2 = () => mem("fleet_manager", 13);
const finance = () => mem("finance", 14);
const auditor = () => mem("auditor", 15);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);

describe("csv builder", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(cell('a,b')).toBe('"a,b"'); expect(cell('say "hi"')).toBe('"say ""hi"""'); expect(cell("two\nlines")).toBe('"two\nlines"');
    expect(cell(null)).toBe(""); expect(cell(undefined)).toBe(""); expect(cell(true)).toBe("yes"); expect(cell(0)).toBe("0");
  });
  it("neutralises anything a spreadsheet would run as a formula", () => {
    for (const bad of ["=1+1", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "\t=1", "\r=1"]) expect(cell(bad)).toMatch(/^"?'/);
    expect(cell("=HYPERLINK(\"http://evil\")")).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(cell("fine = text")).toBe("fine = text");               // only a leading character matters
    expect(cell(-5)).toBe("-5");                                    // a real negative number is not text
    expect(cell("-5.00", true)).toBe("-5.00");                      // numbers we format ourselves can opt out
  });
  it("starts with a byte order mark, ends lines with CRLF, and treats headers as plain", () => {
    const csv = toCsv([{ header: "=Name", value: (r: { n: string }) => r.n }, { header: "N", value: () => 2 }], [{ n: "x" }, { n: "=y" }]);
    expect(csv.startsWith("﻿=Name,N\r\n")).toBe(true);
    expect(csv).toContain("\r\nx,2\r\n'=y,2\r\n");
  });
  it("file names are plain", () => expect(csvFileName("job-cards", new Date("2031-03-05T10:00:00Z"))).toBe("job-cards-2031-03-05.csv"));
});

let veh1: string, veh2: string, reason: string, emp11: string, emp16: string, vendorId: string;
let cardA: string, cardB: string;

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  const ids: Record<number, string> = {};
  for (const [n, name] of [[11, "Driver One"], [12, "Manager One"], [13, "Manager Two"], [14, "Finance One"], [16, "Driver Two"]] as const) {
    ids[n] = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` })).id;
    await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), ids[n]]));
  }
  emp11 = ids[11]; emp16 = ids[16];
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[11, "requester"], [12, "fleet_manager"], [13, "fleet_manager"], [14, "finance"], [16, "requester"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  veh1 = (await master.addVehicle(d, owner(), { registration_no: "BKL-245", make: "Isuzu", model: "D-Max", employee_id: emp11, holding_since: "2026-01-01" })).id;
  veh2 = (await master.addVehicle(d, owner(), { registration_no: "BKL-300", make: "Toyota", model: "Hilux", employee_id: emp16, holding_since: "2026-01-01" })).id;
  reason = (await raw(async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'WEAR_BRAKES'")).rows[0])).id;
  vendorId = (await master.saveVendor(d, owner(), { name: '=HYPERLINK("http://evil.example","pay here")' })).id;
  await raw((q) => q.query("update vendors set user_id = $1 where id = $2", [U(21), vendorId]));
  await withPlatform(d, (q) => q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'vendor')", [U(21), t.tenantId]));
  const card = (vehicle: string, by: Membership, requested_by: string) => jc.createJobCard(d, by, { vehicle_id: vehicle, requested_by, reason_code_id: reason, cause_text: "Brake pads worn out, needs work", lines: [{ kind: "part", description: "Pads", qty: "1", unit_cost: "1000" }] }, true);
  cardA = (await card(veh1, driver(), emp11)).id;
  cardB = (await card(veh2, driver2(), emp16)).id;
});

describe("exports", () => {
  const forbidden = (p: Promise<unknown>) => p.then(() => false, (e) => e instanceof ForbiddenError);

  it("knows exactly the exports listed, and refuses anything else", async () => {
    expect(EXPORT_KINDS.sort()).toEqual(["accidents", "budgets", "cargo", "challans", "cost-per-hour", "cost-per-km", "costs-by-vehicle", "documents", "flags", "invoices", "job-cards", "outsourced-trips", "repeat-repairs", "vehicle-requests", "vehicles", "workshop-time"]);
    for (const bad of ["constructor", "__proto__", "toString", "../vehicles", "", "VEHICLES"]) await expect(exportCsv(d, mgr(), bad)).rejects.toBeInstanceOf(UserError);
  });

  it("every export runs and has a header row, for a role that holds its permission", async () => {
    const who: Record<string, Membership> = { vehicles: mgr(), "job-cards": mgr(), "outsourced-trips": mgr(), invoices: finance(), documents: mgr(), accidents: mgr(), challans: mgr(), budgets: mgr(), "costs-by-vehicle": mgr(), "repeat-repairs": mgr(), flags: mgr(), "cost-per-km": mgr(), "cost-per-hour": mgr(), "workshop-time": mgr(), cargo: mgr(), "vehicle-requests": mgr() };
    for (const kind of EXPORT_KINDS) {
      const r = await exportCsv(d, who[kind], kind);
      expect(r.csv.startsWith("﻿"), kind).toBe(true);
      expect(r.fileName).toMatch(new RegExp(`^${kind}-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
    }
  });

  it("each export needs its own permission", async () => {
    const cases: [string, Membership, boolean][] = [
      ["vehicles", driver(), true], ["vehicles", mem("vendor", 21), false],
      ["job-cards", driver(), true], ["job-cards", mem("vendor", 21), false],
      ["invoices", finance(), true], ["invoices", mgr(), true], ["invoices", auditor(), true], ["invoices", driver(), false],
      ["documents", mgr(), true], ["documents", auditor(), true], ["documents", driver(), false], ["documents", mem("vendor", 21), false],
      ["accidents", auditor(), true], ["accidents", driver(), false], ["challans", finance(), true], ["challans", driver(), false],
      ["budgets", finance(), true], ["budgets", driver(), false],
      ["cargo", mgr(), true], ["cargo", auditor(), true], ["cargo", driver(), false], ["vehicle-requests", mgr(), true], ["vehicle-requests", auditor(), true], ["vehicle-requests", driver(), false],
      ["costs-by-vehicle", auditor(), true], ["costs-by-vehicle", driver(), false], ["costs-by-vehicle", mem("vendor", 21), false],
      ["repeat-repairs", auditor(), true], ["repeat-repairs", driver(), false], ["flags", driver(), false], ["flags", finance(), true],
    ];
    for (const [kind, m, ok] of cases) expect(!(await forbidden(exportCsv(d, m, kind))), `${m.role} ${kind}`).toBe(ok);
  });

  it("the vehicles export gives the holder's employee ID next to the holder's name", async () => {
    const lines = (await exportCsv(d, mgr(), "vehicles")).csv.replace(/^﻿/, "").split("\r\n");
    const head = lines[0].split(",");
    expect(head.indexOf("Employee ID")).toBe(head.indexOf("Held by") + 1);
    expect(lines.find((l) => l.includes("BKL-245"))).toMatch(/,E-[^,]+,/);
  });

  it("respects the 'own' scope: a requester gets only their vehicle and their job cards", async () => {
    const v = (await exportCsv(d, driver(), "vehicles")).csv;
    expect(v).toContain("BKL-245"); expect(v).not.toContain("BKL-300");
    const j = (await exportCsv(d, driver(), "job-cards")).csv;
    expect(j).toContain("BKL-245"); expect(j).not.toContain("BKL-300");
    expect((await exportCsv(d, mgr(), "job-cards")).rows).toBe(2);
  });

  it("applies the filters the screen had", async () => {
    expect((await exportCsv(d, mgr(), "vehicles", { q: "hilux" })).csv).not.toContain("BKL-245");
    expect((await exportCsv(d, mgr(), "job-cards", { status: "submitted" })).rows).toBe(2);
    expect((await exportCsv(d, mgr(), "job-cards", { status: "closed" })).rows).toBe(0);
    expect((await exportCsv(d, mgr(), "vehicles", { q: "%" })).rows).toBe(0);                  // wildcards are literal
  });

  it("a workshop name that looks like a formula cannot run in a spreadsheet", async () => {
    await jc.transitionJobCard(d, mgr2(), cardA, "approved");
    await jc.transitionJobCard(d, mgr(), cardA, "vendor_assigned", { vendorId });
    const csv = (await exportCsv(d, mgr(), "job-cards")).csv;
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""pay here"")"`);
    expect(csv).not.toMatch(/,=HYPERLINK/);
    expect(csv).not.toMatch(/,"=HYPERLINK/);
  });

  it("writes who exported what, with the row count, to the audit log", async () => {
    await exportCsv(d, mgr(), "job-cards", { status: "submitted", q: "x".repeat(200) });
    const row = await raw(async (q) => (await q.query<{ actor_id: string; new_data: { rows: number; filters: { status: string; q: string } } }>(
      "select actor_id, new_data from audit_log where table_name = 'export:job-cards' order by id desc limit 1")).rows[0]);
    expect(row.actor_id).toBe(U(12));
    expect(row.new_data.rows).toBe(0);
    expect(row.new_data.filters.status).toBe("submitted");
    expect(row.new_data.filters.q).toHaveLength(80);                                             // over-long filters are cut, not stored whole
    await expect(raw((q) => q.query("update audit_log set actor_id = 'x' where table_name like 'export:%'"))).rejects.toThrow();   // the log stays append-only
    const n = await raw(async (q) => (await q.query<{ c: number }>("select count(*)::int c from audit_log where table_name = 'export:vehicles'")).rows[0].c);
    await forbidden(exportCsv(d, mem("vendor", 21), "vehicles"));
    expect(await raw(async (q) => (await q.query<{ c: number }>("select count(*)::int c from audit_log where table_name = 'export:vehicles'")).rows[0].c)).toBe(n);   // a refused export leaves no row
  });

  it("another workspace exports nothing of ours", async () => {
    const other = await provisionTenant(d, { name: "Other Co", slug: "other", ownerUserId: U(2), ownerName: "O" }, tenantMigrations(), { transform: stripExt });
    const o: Membership = { ...other, userId: U(70), role: "fleet_manager", vehicleScope: "all" };
    expect((await exportCsv(d, o, "vehicles")).rows).toBe(0);
    expect((await exportCsv(d, o, "job-cards")).rows).toBe(0);
  });

  it("refuses to build a file bigger than the cap", async () => {
    await raw((q) => q.query(`insert into challans(vehicle_id, issued_on, amount) select $1, current_date, 1 from generate_series(1, ${MAX_EXPORT_ROWS + 1})`, [veh1]));
    await expect(exportCsv(d, mgr(), "challans")).rejects.toThrow(/Too many rows/);
    expect((await exportCsv(d, mgr(), "challans", { status: "paid" })).rows).toBe(0);
    await raw((q) => q.query("delete from challans"));
  }, 120_000);
});

describe("dashboard", () => {
  const keys = async (m: Membership) => (await getDashboard(d, m)).actions.map((a) => a.key).sort();

  it("a manager sees what waits for them, but not cards they raised themselves", async () => {
    const own = (await jc.createJobCard(d, mgr(), { vehicle_id: veh1, reason_code_id: reason, cause_text: "My own car needs brake work", lines: [] }, true)).id;
    const a = (await getDashboard(d, mgr())).actions.find((x) => x.key === "approve")!;
    expect(a.count).toBe(1);                                                                    // cardB; cardA moved on, `own` is theirs
    expect(a.samples.map((s) => s.href)).toEqual([`job-cards/${cardB}`]);
    expect(a.samples[0].text).toContain("BKL-300");
    expect((await getDashboard(d, mgr2())).actions.find((x) => x.key === "approve")!.count).toBe(2);   // the other manager sees both
    await jc.transitionJobCard(d, mgr2(), own, "cancelled").catch(() => undefined);
    expect(cardA).toBeTruthy();
  });

  it("each role gets its own blocks", async () => {
    // cardA is vendor_assigned, so a manager sees nothing to assign; approve cardB to create something to assign
    await jc.transitionJobCard(d, mgr2(), cardB, "approved");
    expect(await keys(mgr())).toContain("assign");
    expect(await keys(driver())).not.toContain("approve");
    const fin = await getDashboard(d, finance());
    expect(fin.actions.map((a) => a.key)).not.toContain("approve");
    expect(fin.health).not.toBeNull();
    const req = await getDashboard(d, driver());
    expect(req.health).toBeNull();                                                              // no report.view
    expect(req.myVehicles.map((v) => v.registration_no)).toEqual(["BKL-245"]);
    expect((await getDashboard(d, driver2())).myVehicles.map((v) => v.registration_no)).toEqual(["BKL-300"]);
    expect((await getDashboard(d, auditor())).myVehicles).toEqual([]);
    await expect(getDashboard(d, mem("vendor", 21))).rejects.toBeInstanceOf(ForbiddenError);    // workshops use their own page
  });

  it("finance sees invoices to check and checked jobs to close", async () => {
    await vf.submitQuotation(d, mem("vendor", 21), cardA, { lines: [{ kind: "part", description: "Pads", qty: "1", unit_cost: "1000" }] });
    expect((await getDashboard(d, mgr())).actions.find((a) => a.key === "quotes")!.count).toBe(1);
    const q = (await vf.getJobFlow(d, mgr(), cardA)).quotations[0];
    await vf.decideQuotation(d, mgr(), q.id, "approve");
    const wo = (await vf.getJobFlow(d, mgr(), cardA)).workOrder!.id;
    await vf.startWork(d, mem("vendor", 21), wo); await vf.completeWork(d, mem("vendor", 21), wo);
    await vf.submitInvoice(d, mem("vendor", 21), wo, { invoice_no: "I-1", lines: [{ description: "Pads", qty: "1", unit_cost: "1000", quotation_line_id: q.lines[0].id }] });
    expect((await getDashboard(d, finance())).actions.find((a) => a.key === "invoices")!.count).toBe(1);
    const inv = (await vf.listInvoices(d, finance()))[0];
    await vf.verifyInvoice(d, finance(), inv.id, "pay_approved");
    const after = await getDashboard(d, finance());
    expect(after.actions.find((a) => a.key === "invoices")).toBeUndefined();
    expect(after.actions.find((a) => a.key === "close")!.count).toBe(1);
  });

  it("owners of drafts and sent-back cards see them", async () => {
    const draft = (await jc.createJobCard(d, driver(), { vehicle_id: veh1, reason_code_id: reason, cause_text: "Squeaking noise from the front", lines: [] }, false)).id;
    const back = (await jc.createJobCard(d, driver(), { vehicle_id: veh1, reason_code_id: reason, cause_text: "Tyre pressure keeps dropping", lines: [] }, true)).id;
    await jc.transitionJobCard(d, mgr(), back, "returned_for_edit", { comment: "Add a photo of the tyre" });
    const a = (await getDashboard(d, driver())).actions;
    expect(a.find((x) => x.key === "drafts")!.samples[0].href).toBe(`job-cards/${draft}`);
    expect(a.find((x) => x.key === "returned")!.samples[0].href).toBe(`job-cards/${back}`);
    expect((await getDashboard(d, driver2())).actions.find((x) => x.key === "drafts")).toBeUndefined();
  });

  it("odometer, documents and fleet numbers", async () => {
    const cycle = await od.openCycle(d, mgr(), "2031-06", "2031-06-25");
    const links = await od.createLinks(d, mgr(), cycle);
    expect(links.length).toBeGreaterThan(0);
    await od.enterReading(d, mgr(), links[0].submission_id, "5000");
    const m = await getDashboard(d, mgr());
    expect(m.actions.find((a) => a.key === "odo_review")!.count).toBe(1);
    expect(m.actions.find((a) => a.key === "odo_waiting")!.count).toBe(links.length - 1);
    expect((await getDashboard(d, driver())).actions.find((a) => a.key === "odo_review")).toBeUndefined();   // needs odometer.review

    await cs.addDocument(d, mgr(), { vehicle_id: veh1, doc_type: "fitness", expires_on: new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10) });
    await cs.addDocument(d, mgr(), { vehicle_id: veh2, doc_type: "fitness", expires_on: new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10) });
    const own = await getDashboard(d, driver());
    expect(own.myVehicles[0]).toMatchObject({ docs_expired: 1, docs_due: 0 });
    const fleet = (await getDashboard(d, auditor())).health!;
    expect(fleet.documents).toEqual({ expired: 1, due_30: 1 });
    expect(fleet.vehicles.active).toBe(2);
    expect(fleet.monthSpend).toBeGreaterThan(0);
    expect(fleet.fleetBudget).toBeNull();
    const year = new Date().getUTCFullYear();
    await raw((q) => q.query("insert into budgets(vehicle_id, period_start, period_end, amount) values (null, $1, $2, 10000)", [`${year}-01-01`, `${year}-12-31`]));
    expect((await getDashboard(d, auditor())).health!.fleetBudget).toMatchObject({ budget: 10000 });
  });

  it("someone limited to their own vehicle sees only what their own vehicle has cost, and a card with no costs is fine", async () => {
    const mine = await jc.createJobCard(d, driver(), { vehicle_id: veh1, reason_code_id: reason, cause_text: "Wipers streak, cost not known yet", lines: [] }, true);
    const before = (await getDashboard(d, driver2())).expenses!.totalSpend;
    const theirs = await jc.createJobCard(d, driver2(), { vehicle_id: veh2, reason_code_id: reason, cause_text: "Horn weak, another driver's car", lines: [{ kind: "part", description: "Horn", qty: "2", unit_cost: "777" }] }, true);
    const a = (await getDashboard(d, driver())).expenses!;
    expect(a.byVehicle.map((v) => v.registration_no)).toEqual(["BKL-245"]);
    expect(a.recent.map((r) => r.registration_no)).toEqual(a.recent.map(() => "BKL-245"));
    expect(a.recent.find((r) => r.job_no === mine.job_no)).toMatchObject({ cost: 0 });   // no cost entered: the card still counts, at nothing yet
    expect(a.recent.map((r) => r.id)).not.toContain(theirs.id);
    expect(a.totalSpend).toBe(a.byVehicle.reduce((s, v) => s + v.total, 0));
    const b = (await getDashboard(d, driver2())).expenses!;
    expect(b.byVehicle.map((v) => v.registration_no)).toEqual(["BKL-300"]);
    expect(b.totalSpend).toBe(before + 1554);                         // 2 x 777, charged to the holder of that car
    expect(b.monthSpend).toBe(b.totalSpend);
    expect((await getDashboard(d, mgr())).expenses).toBeNull();      // a manager sees the whole fleet, not this panel
    expect((await getDashboard(d, auditor())).expenses).toBeNull();
  });

  it("another workspace sees an empty dashboard", async () => {
    const other = await provisionTenant(d, { name: "Third Co", slug: "third", ownerUserId: U(5), ownerName: "T" }, tenantMigrations(), { transform: stripExt });
    const o = await getDashboard(d, { ...other, userId: U(80), role: "fleet_manager", vehicleScope: "all" });
    expect(o.actions).toEqual([]);
    expect(o.myVehicles).toEqual([]);
    expect(o.health!.vehicles).toEqual({});
  });
});
