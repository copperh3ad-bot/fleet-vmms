import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as svc from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import { parseCsv, csvToObjects } from "@/lib/master/csv";
import { plateKey } from "@/lib/master/schemas";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
let other: { tenantId: string; schema: string };
const mem = (role: string, n: number, tenant = t, vehicleScope: "all" | "own" = "all"): Membership => ({ ...tenant, userId: U(n), role, vehicleScope });
const admin = () => mem("tenant_admin", 1);
let empA: string, empB: string, empC: string;

beforeAll(async () => {
  d = await testDriver();
  const m = tenantMigrations();
  const o = { transform: stripExt };
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: U(1), ownerName: "Owner" }, m, o);
  other = await provisionTenant(d, { name: "Other Co", slug: "other", ownerUserId: U(2), ownerName: "Other Owner" }, m, o);
  empA = (await svc.saveEmployee(d, admin(), { full_name: "Ayesha Khan", employee_no: "E-001", email: "ayesha@example.com" })).id;
  empB = (await svc.saveEmployee(d, admin(), { full_name: "Bilal Raza", employee_no: "E-002" })).id;
  empC = (await svc.saveEmployee(d, admin(), { full_name: "Chand Ali", employee_no: "E-003" })).id;
});

const plate = (n: number) => `TST-${String(n).padStart(3, "0")}`;
let seq = 100;
const newVehicle = (extra: Record<string, unknown> = {}) => svc.addVehicle(d, admin(), { registration_no: plate(seq++), make: "Toyota", model: "Hilux", year: "2022", ...extra });

describe("permission matrix", () => {
  // Expected from ADR-002: only admin and fleet manager change master data. Read-only roles read vehicles. Vendor reads nothing here.
  const roles: Record<string, { read: boolean; write: boolean; people: boolean }> = {
    tenant_admin:  { read: true,  write: true,  people: true },
    fleet_manager: { read: true,  write: true,  people: true },
    finance:       { read: true,  write: false, people: false },
    requester:     { read: true,  write: false, people: false },
    auditor:       { read: true,  write: false, people: false },
    vendor:        { read: false, write: false, people: false },
  };
  let vid: string;
  beforeAll(async () => { vid = (await newVehicle()).id; });

  for (const [role, want] of Object.entries(roles)) {
    describe(role, () => {
      const m = () => mem(role, 50);
      const expectAccess = async (allowed: boolean, call: () => Promise<unknown>) => {
        if (allowed) await call().catch((e) => { expect(e).not.toBeInstanceOf(ForbiddenError); });
        else await expect(call()).rejects.toBeInstanceOf(ForbiddenError);
      };
      it("vehicle.read: list and view", async () => {
        await expectAccess(want.read, () => svc.listVehicles(d, m()));
        await expectAccess(want.read, () => svc.getVehicle(d, m(), vid));
      });
      it("vehicle.write: add, status, custody, import, picker", async () => {
        await expectAccess(want.write, () => svc.addVehicle(d, m(), { registration_no: plate(seq++) }));
        await expectAccess(want.write, () => svc.updateVehicleStatus(d, m(), vid, "active"));
        await expectAccess(want.write, () => svc.changeCustody(d, m(), { vehicle_id: vid, employee_id: empA }));
        await expectAccess(want.write, () => svc.endCustody(d, m(), vid));
        await expectAccess(want.write, () => svc.previewVehicleImport(d, m(), "registration_no\nZZZ-1"));
        await expectAccess(want.write, () => svc.commitVehicleImport(d, m(), "registration_no\nZZZ-2"));
        await expectAccess(want.write, () => svc.listEmployeeOptions(d, m()));
      });
      it("employee.manage and vendor.manage", async () => {
        await expectAccess(want.people, () => svc.listEmployees(d, m()));
        await expectAccess(want.people, () => svc.saveEmployee(d, m(), { full_name: `Person ${role}` }));
        await expectAccess(want.people, () => svc.listVendors(d, m()));
        await expectAccess(want.people, () => svc.saveVendor(d, m(), { name: `Workshop ${role}` }));
        await expectAccess(want.people, () => svc.setVendorStatus(d, m(), U(99), "blocked"));
      });
    });
  }

  it("a forbidden call changes nothing", async () => {
    const count = () => withTenant(d, admin(), async (q) => (await q.query<{ c: number }>("select count(*)::int c from vehicles")).rows[0].c);
    const before = await count();
    await expect(svc.addVehicle(d, mem("auditor", 51), { registration_no: "NOPE-1" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.commitVehicleImport(d, mem("requester", 52), "registration_no\nNOPE-2")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await count()).toBe(before);
  });
});

describe("tenant isolation for master data", () => {
  it("a member of one workspace never sees another's vehicles or people", async () => {
    await svc.addVehicle(d, admin(), { registration_no: "ISO-1" });
    const otherAdmin = mem("tenant_admin", 2, other);
    expect((await svc.listVehicles(d, otherAdmin)).map((v) => v.registration_no)).not.toContain("ISO-1");
    expect((await svc.listEmployees(d, otherAdmin)).map((e) => e.full_name)).not.toContain("Ayesha Khan");
    // the same plate is free in the other workspace
    await expect(svc.addVehicle(d, otherAdmin, { registration_no: "ISO-1" })).resolves.toBeTruthy();
  });
});

describe("vehicles", () => {
  it("adds a vehicle with first odometer, custodian, oil change baseline, insurance, documents and budget in one go", async () => {
    const { id } = await svc.addVehicle(d, admin(), {
      registration_no: " bkl-245 ", make: "Isuzu", model: "NPR", year: "2021", fuel_type: "Diesel", vehicle_class: "truck",
      odometer_km: "48200", employee_id: empA, holding_since: "2026-01-01",
      baselines: [{ service_type_key: "oil_change", last_done_on: "2026-09-01", last_odometer_km: "47000" }],
      insurance: { insurer: "EFU", policy_no: "P-1", valid_from: "2026-01-01", valid_to: "2026-12-31", premium: "90000" },
      documents: [{ doc_type: "fitness", reference: "F-1", expires_on: "2027-01-01" }],
      budget_amount: "250000", budget_from: "2026-01-01", budget_to: "2026-12-31",
    });
    const v = await svc.getVehicle(d, admin(), id);
    expect(v?.registration_no).toBe("BKL-245");
    expect(v?.odometer_km).toBe("48200.0");
    expect(v?.holder_name).toBe("Ayesha Khan");
    expect(v?.pm.find((p) => p.label.toLowerCase().includes("oil"))?.status).toBe("ok");
    const counts = await withTenant(d, admin(), async (q) => (await q.query<Record<string, number>>(
      `select (select count(*)::int from insurance_policies where vehicle_id=$1) ins, (select count(*)::int from compliance_docs where vehicle_id=$1) docs,
              (select count(*)::int from budgets where vehicle_id=$1) bud`, [id])).rows[0]);
    expect(counts).toEqual({ ins: 1, docs: 1, bud: 1 });
  });

  it("saves a vehicle whose insurance has an expiry but no policy number (found by the activity log on the live site)", async () => {
    // The form fills in the insurer and the start date when they are left empty; the policy number must be filled in too, or the database refuses the whole vehicle.
    const { id } = await svc.addVehicle(d, admin(), { registration_no: "INS-001", insurance: { insurer: "Not recorded yet", policy_no: "", valid_from: "2025-12-31", valid_to: "2026-12-31" } });
    const row = await withTenant(d, admin(), async (q) => (await q.query<{ insurer: string; policy_no: string }>("select insurer, policy_no from insurance_policies where vehicle_id = $1", [id])).rows[0]);
    expect(row).toEqual({ insurer: "Not recorded yet", policy_no: "Not recorded yet" });
    const b = await svc.addVehicle(d, admin(), { registration_no: "INS-002", insurance: { insurer: "EFU", valid_from: "2026-01-01", valid_to: "2026-12-31" } });
    expect((await withTenant(d, admin(), async (q) => (await q.query<{ policy_no: string }>("select policy_no from insurance_policies where vehicle_id = $1", [b.id])).rows[0])).policy_no).toBe("Not recorded yet");
  });

  it("saves the full combination the QA report used: insurance without a policy number, two documents and a budget, in one submit", async () => {
    const { id } = await svc.addVehicle(d, admin(), {
      registration_no: "QA-FULL-1", make: "Toyota", model: "Corolla", year: "2022", fuel_type: "petrol", odometer_km: "50000",
      insurance: { insurer: "Not recorded yet", valid_from: "2026-03-31", valid_to: "2027-03-31" },
      documents: [{ doc_type: "fitness", expires_on: "2027-06-30" }, { doc_type: "token_tax", expires_on: "2027-06-30" }],
      budget_amount: "400000", budget_from: "2026-01-01", budget_to: "2026-12-31",
    });
    const n = await withTenant(d, admin(), async (q) => (await q.query<Record<string, number>>(
      "select (select count(*)::int from insurance_policies where vehicle_id=$1) ins, (select count(*)::int from compliance_docs where vehicle_id=$1) docs, (select count(*)::int from budgets where vehicle_id=$1) bud", [id])).rows[0]);
    expect(n).toEqual({ ins: 1, docs: 2, bud: 1 });
  });

  it("turns a missing required value anywhere into a plain message instead of a server error", async () => {
    await expect(withTenant(d, admin(), (q) => q.query("insert into insurance_policies(vehicle_id, insurer, policy_no, valid_from, valid_to) select id, 'X', null, now(), now() from vehicles limit 1"))).rejects.toThrow(/not-null/);
    await expect(Promise.resolve().then(() => svc.friendly(new Error('null value in column "policy_no" of relation "insurance_policies" violates not-null constraint')))).rejects.toMatchObject({ message: expect.stringMatching(/policy no/i) });
  });

  it("blocks duplicate plates however they are typed, with a plain message", async () => {
    await svc.addVehicle(d, admin(), { registration_no: "ABC-123" });
    for (const dup of ["abc-123", "ABC 123", "ABC123", " Abc-123 "]) {
      await expect(svc.addVehicle(d, admin(), { registration_no: dup })).rejects.toMatchObject({
        name: "Error", message: "A vehicle with this registration number already exists.", fields: { registration_no: "Already registered" },
      });
    }
    expect(plateKey("abc 123")).toBe(plateKey("ABC-123"));
  });

  it("a failed duplicate leaves no half-saved vehicle", async () => {
    const before = (await svc.listVehicles(d, admin())).length;
    await expect(svc.addVehicle(d, admin(), { registration_no: "ABC-123", odometer_km: "10", employee_id: empA })).rejects.toBeInstanceOf(UserError);
    expect((await svc.listVehicles(d, admin())).length).toBe(before);
  });

  it("reports field errors, not a crash", async () => {
    await expect(svc.addVehicle(d, admin(), { registration_no: "", year: "1800", odometer_km: "-5", fuel_type: "steam" })).rejects.toMatchObject({
      fields: expect.objectContaining({ registration_no: expect.any(String), year: expect.any(String), odometer_km: expect.any(String), fuel_type: expect.any(String) }),
    });
    await expect(svc.addVehicle(d, admin(), { registration_no: "BUD-1", budget_amount: "1000" })).rejects.toMatchObject({ fields: { budget_amount: expect.any(String) } });
  });

  it("search and status filter", async () => {
    await svc.addVehicle(d, admin(), { registration_no: "SRCH-9", make: "Suzuki", model: "Bolan" });
    expect((await svc.listVehicles(d, admin(), { search: "bolan" })).map((v) => v.registration_no)).toEqual(["SRCH-9"]);
    expect(await svc.listVehicles(d, admin(), { search: "100%_" })).toEqual([]);
    const { id } = await svc.addVehicle(d, admin(), { registration_no: "OLD-1" });
    await svc.updateVehicleStatus(d, admin(), id, "disposed");
    expect((await svc.listVehicles(d, admin(), { status: "disposed" })).map((v) => v.registration_no)).toEqual(["OLD-1"]);
    await expect(svc.updateVehicleStatus(d, admin(), id, "stolen")).rejects.toBeInstanceOf(UserError);
  });

  it("a requester with scope 'own' sees only vehicles held by their own employee record", async () => {
    const userId = U(70);
    const me = (await svc.saveEmployee(d, admin(), { full_name: "Driver Seventy", employee_no: "E-070" })).id;
    await withTenant(d, admin(), (q) => q.query("update employees set user_id = $2 where id = $1", [me, userId]));
    const mine = (await newVehicle({ registration_no: "OWN-1", employee_id: me })).id;
    const notMine = (await newVehicle({ registration_no: "OWN-2", employee_id: empB })).id;
    const m = mem("requester", 70, t, "own");
    expect((await svc.listVehicles(d, m)).map((v) => v.registration_no)).toEqual(["OWN-1"]);
    expect(await svc.getVehicle(d, m, mine)).not.toBeNull();
    expect(await svc.getVehicle(d, m, notMine)).toBeNull();
  });
});

describe("custody", () => {
  it("keeps every past holder and has exactly one current holder", async () => {
    const { id } = await newVehicle({ employee_id: empA, holding_since: "2026-01-01" });
    await svc.changeCustody(d, admin(), { vehicle_id: id, employee_id: empB, from: "2026-03-01" });
    await svc.changeCustody(d, admin(), { vehicle_id: id, employee_id: empC, from: "2026-06-01" });
    const v = await svc.getVehicle(d, admin(), id);
    expect(v?.custody.map((c) => [c.full_name, c.from_date, c.to_date])).toEqual([
      ["Chand Ali", "2026-06-01", null],
      ["Bilal Raza", "2026-03-01", "2026-05-31"],
      ["Ayesha Khan", "2026-01-01", "2026-02-28"],
    ]);
    expect(v?.holder_name).toBe("Chand Ali");
    // cost lands on whoever held the vehicle at the time
    const who = (on: string) => withTenant(d, admin(), async (q) => (await q.query<{ n: string }>(
      "select e.full_name n from employees e where e.id = custodian_on($1, $2::date)", [id, on])).rows[0]?.n);
    expect(await who("2026-02-15")).toBe("Ayesha Khan");
    expect(await who("2026-04-10")).toBe("Bilal Raza");
    expect(await who("2026-09-01")).toBe("Chand Ali");
  });

  it("rejects a no-op, a backdated start, an inactive person, and ending a vehicle nobody holds", async () => {
    const { id } = await newVehicle({ employee_id: empA, holding_since: "2026-05-01" });
    await expect(svc.changeCustody(d, admin(), { vehicle_id: id, employee_id: empA })).rejects.toThrow(/already holds/);
    await expect(svc.changeCustody(d, admin(), { vehicle_id: id, employee_id: empB, from: "2026-04-01" })).rejects.toThrow(/must start on or after/);
    const gone = (await svc.saveEmployee(d, admin(), { full_name: "Left Company" })).id;
    await svc.saveEmployee(d, admin(), { full_name: "Left Company", active: false }, gone);
    await expect(svc.changeCustody(d, admin(), { vehicle_id: id, employee_id: gone, from: "2026-06-01" })).rejects.toThrow(/not active/);
    await svc.endCustody(d, admin(), id, "2026-07-01");
    await expect(svc.endCustody(d, admin(), id)).rejects.toThrow(/no current holder/);
    expect((await svc.getVehicle(d, admin(), id))?.holder_name).toBeNull();
    // old holder is still on record after the vehicle is returned
    expect((await svc.getVehicle(d, admin(), id))?.custody).toHaveLength(1);
  });

  it("a handover dated the day the current holder started replaces them; a day later keeps them in the history", async () => {
    const { id } = await newVehicle({ employee_id: empA, holding_since: "2026-05-01" });
    await svc.changeCustody(d, admin(), { vehicle_id: id, employee_id: empB, from: "2026-05-01" });
    let v = await svc.getVehicle(d, admin(), id);
    expect(v?.holder_name).toBe("Bilal Raza");
    expect(v?.custody.map((c) => [c.full_name, c.from_date, c.to_date])).toEqual([["Bilal Raza", "2026-05-01", null]]);
    await svc.changeCustody(d, admin(), { vehicle_id: id, employee_id: empC, from: "2026-05-02" });
    v = await svc.getVehicle(d, admin(), id);
    expect(v?.custody.map((c) => [c.full_name, c.to_date])).toEqual([["Chand Ali", null], ["Bilal Raza", "2026-05-01"]]);
  });

  it("a failed change leaves the current holder in place", async () => {
    const { id } = await newVehicle({ employee_id: empA, holding_since: "2026-05-01" });
    await expect(svc.changeCustody(d, admin(), { vehicle_id: id, employee_id: empB, from: "2026-01-01" })).rejects.toBeInstanceOf(UserError);
    const v = await svc.getVehicle(d, admin(), id);
    expect(v?.holder_name).toBe("Ayesha Khan");
    expect(v?.custody).toHaveLength(1);
  });
});

describe("employees and vendors", () => {
  it("blocks a duplicate employee number and vendor name (any case)", async () => {
    await expect(svc.saveEmployee(d, admin(), { full_name: "Somebody Else", employee_no: "e-001" })).rejects.toMatchObject({ fields: { employee_no: "Already used" } });
    await svc.saveVendor(d, admin(), { name: "Ali Motors", categories: ["engine", "electrical"], phone: "0300" });
    await expect(svc.saveVendor(d, admin(), { name: "  ALI MOTORS " })).rejects.toThrow(/already exists/);
  });
  it("validates email and edits in place", async () => {
    await expect(svc.saveEmployee(d, admin(), { full_name: "Bad Mail", email: "nope" })).rejects.toMatchObject({ fields: { email: expect.any(String) } });
    const { id } = await svc.saveVendor(d, admin(), { name: "Quick Tyres" });
    await svc.saveVendor(d, admin(), { name: "Quick Tyres Ltd", categories: ["tyres"] }, id);
    await svc.setVendorStatus(d, admin(), id, "blocked");
    const v = (await svc.listVendors(d, admin())).find((x) => x.id === id);
    expect(v).toMatchObject({ name: "Quick Tyres Ltd", categories: ["tyres"], status: "blocked" });
    await expect(svc.saveVendor(d, admin(), { name: "Ghost" }, U(999))).rejects.toThrow(/not found/);
  });
  it("the employee list shows how many vehicles each person holds now", async () => {
    const e = (await svc.listEmployees(d, admin())).find((x) => x.id === empC);
    expect(e?.vehicles).toBeGreaterThanOrEqual(1);
  });
});

describe("csv parser", () => {
  it("handles quotes, escaped quotes, commas and newlines inside quotes, CRLF, BOM and blank lines", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n"line1\nline2",z\n')).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["line1\nline2", "z"]]);
  });
  it("rejects an unclosed quote and an empty file", () => {
    expect(() => parseCsv('a,b\n"oops,1')).toThrow(/quote/);
    expect(() => csvToObjects("")).toThrow(/empty/);
  });
  it("lower-cases headers and tolerates short rows", () => {
    expect(csvToObjects("Registration No, Make\nA-1").rows[0].values).toEqual({ registration_no: "A-1", make: "" });
  });
});

describe("csv import", () => {
  const csv = (lines: string[]) => ["registration_no,make,model,year,vehicle_class,fuel_type,odometer_km,employee_no,holding_since,last_oil_change,last_oil_change_km", ...lines].join("\n");
  const count = () => withTenant(d, admin(), async (q) => (await q.query<{ c: number }>("select count(*)::int c from vehicles")).rows[0].c);

  it("previews row-level errors and saves nothing", async () => {
    await svc.addVehicle(d, admin(), { registration_no: "EXIST-1" });
    const before = await count();
    const p = await svc.previewVehicleImport(d, admin(), csv([
      "IMP-1,Toyota,Hilux,2022,pickup,diesel,1000,E-001,2026-01-01,2026-08-01,900",
      "imp 1,Toyota,Hilux,2022,pickup,diesel,,,,,",
      "exist-1,Honda,City,2020,car,petrol,,,,,",
      "IMP-4,Honda,City,1800,car,steam,-3,E-999,31/12/2026,,",
      "IMP-5,Honda,City,2020,car,petrol,,,,,",
    ]));
    expect(p).toMatchObject({ total: 5, ok: 2, failed: 3 });
    const by = Object.fromEntries(p.rows.map((r) => [r.row, r.errors.join(" | ")]));
    expect(by[2]).toBe("");
    expect(by[3]).toMatch(/same plate as row 2/);
    expect(by[4]).toMatch(/already exists/);
    expect(by[5]).toMatch(/year/);
    expect(by[5]).toMatch(/fuel_type/);
    expect(by[5]).toMatch(/odometer_km/);
    expect(by[5]).toMatch(/E-999/);
    expect(by[5]).toMatch(/holding_since/);
    expect(by[6]).toBe("");
    expect(await count()).toBe(before);
  });

  it("is all or nothing: one bad row blocks the whole import", async () => {
    const before = await count();
    await expect(svc.commitVehicleImport(d, admin(), csv(["GOOD-1,Toyota,Hilux,2022,,,,,,,", "BAD-1,Toyota,Hilux,1800,,,,,,,"]))).rejects.toThrow(/1 row\(s\) have errors.*nothing was imported/);
    expect(await count()).toBe(before);
  });

  it("imports good rows with custodian, odometer and last oil change", async () => {
    const r = await svc.commitVehicleImport(d, admin(), csv([
      "CSV-1,Toyota,Hilux,2022,pickup,diesel,12000,E-002,2026-02-01,2026-09-01,11500",
      "CSV-2,Suzuki,Bolan,2019,van,petrol,,,,,",
    ]));
    expect(r.imported).toBe(2);
    const v = (await svc.listVehicles(d, admin(), { search: "CSV-1" }))[0];
    expect(v.holder_name).toBe("Bilal Raza");
    expect(v.odometer_km).toBe("12000.0");
    const full = await svc.getVehicle(d, admin(), v.id);
    expect(full?.pm.some((p) => p.status === "ok")).toBe(true);
    // running the same file again is refused (duplicates), not doubled
    await expect(svc.commitVehicleImport(d, admin(), csv(["CSV-1,Toyota,Hilux,2022,,,,,,,"]))).rejects.toBeInstanceOf(UserError);
  });

  it("rejects files with no plate column, no rows, or too many rows", async () => {
    await expect(svc.previewVehicleImport(d, admin(), "make,model\nA,B")).rejects.toThrow(/registration_no/);
    await expect(svc.previewVehicleImport(d, admin(), "registration_no")).rejects.toThrow(/no vehicles/);
    const big = "registration_no\n" + Array.from({ length: 501 }, (_, i) => `BIG-${i}`).join("\n");
    await expect(svc.previewVehicleImport(d, admin(), big)).rejects.toThrow(/limit is 500/);
  });

  it("flags unknown columns but still imports the rest", async () => {
    const p = await svc.previewVehicleImport(d, admin(), "registration_no,favourite_colour\nUNK-1,blue");
    expect(p.unknownColumns).toEqual(["favourite_colour"]);
    expect(p.ok).toBe(1);
  });
});
