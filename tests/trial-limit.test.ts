// The free trial's vehicle limit (ADR-038) and the vehicle sheet. The limit is the owner's setting (empty means 10), applies only while the trial runs, is counted on the
// server for adding one vehicle and for importing a sheet, and does not count disposed vehicles. A filled-in Excel sheet is read back into the CSV the import understands.
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import type { Membership } from "@/lib/auth/can";
import { loadAccess } from "@/lib/billing/state";
import { DEFAULT_TRIAL_MAX_VEHICLES, trialCapFor, trialRoomMessage, trialVehicleCap } from "@/lib/billing/trial";
import { addVehicle, commitVehicleImport, previewVehicleImport, updateVehicleStatus } from "@/lib/master/service";
import { MAX_SHEET_BYTES, VEHICLE_SHEET_NAME, buildVehicleSheet, vehicleSheetCsv, xlsxToCsv } from "@/lib/master/vehicle-sheet";
import { VEHICLE_CSV_COLUMNS } from "@/lib/master/service";
import { harness, type Org } from "./billing-harness";

let h: Awaited<ReturnType<typeof harness>>;
let org: Org;
let trial: Membership, subscribed: Membership;
let seq = 0;
const plate = () => `TRL-${String(++seq).padStart(3, "0")}`;
const csv = (n: number) => `registration_no\n${Array.from({ length: n }, plate).join("\n")}\n`;

beforeAll(async () => {
  h = await harness();
  org = await h.org("Trial Limit Co");
  const billing = await loadAccess(h.control, org.tenantId);
  expect(billing.state).toBe("trial");
  trial = { ...org.admin, billing };
  subscribed = { ...org.admin, billing: { ...billing, state: "active" } };
});

describe("how many vehicles a trial allows", () => {
  it("is 10 unless the owner sets another number", async () => {
    expect(await trialVehicleCap(h.router)).toBe(DEFAULT_TRIAL_MAX_VEHICLES);
    expect(DEFAULT_TRIAL_MAX_VEHICLES).toBe(10);
    await h.set("trial_max_vehicles", "3");
    expect(await trialVehicleCap(h.router)).toBe(3);
  });

  it("applies only while the trial runs", async () => {
    expect(await trialCapFor(h.router, trial)).toBe(3);
    expect(await trialCapFor(h.router, subscribed)).toBeNull();
  });
});

describe("adding one vehicle during a trial", () => {
  it("stops at the cap with a message that points to Billing, and disposed vehicles do not count", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await addVehicle(h.router, trial, { registration_no: plate() })).id);
    await expect(addVehicle(h.router, trial, { registration_no: plate() })).rejects.toThrow(/free trial includes up to 3 vehicles.*Billing/);
    await updateVehicleStatus(h.router, trial, ids[0], "disposed");
    await addVehicle(h.router, trial, { registration_no: plate() });                       // room again
    await expect(addVehicle(h.router, trial, { registration_no: plate() })).rejects.toThrow(/free trial includes up to 3/);
  });

  it("is not enforced once the organization has subscribed", async () => {
    await addVehicle(h.router, subscribed, { registration_no: plate() });
    await addVehicle(h.router, subscribed, { registration_no: plate() });
  });
});

describe("importing a sheet during a trial", () => {
  it("the preview says how much room is left, and the upload is refused as a whole when it would go over", async () => {
    await h.set("trial_max_vehicles", "8");                                                // 5 live vehicles so far (4 + 2 disposed-excluded), so 3 free
    const p = await previewVehicleImport(h.router, trial, csv(4));
    expect(p.ok).toBe(4);
    expect(p.trial).toMatchObject({ cap: 8, existing: 5, room: 3 });
    expect(p.trial!.note).toBe(trialRoomMessage(8, 5, 4));
    await expect(commitVehicleImport(h.router, trial, csv(4))).rejects.toThrow(/Upload only the first 3/);
    const after = await previewVehicleImport(h.router, trial, csv(1));
    expect(after.trial!.existing).toBe(5);                                                  // nothing was saved by the refused upload
  });

  it("goes through when it fits", async () => {
    expect(await commitVehicleImport(h.router, trial, csv(3))).toMatchObject({ imported: 3 });
    await expect(commitVehicleImport(h.router, trial, csv(1))).rejects.toThrow(/free trial includes up to 8/);
  });

  it("a subscribed organization sees no trial note and may import past the trial number", async () => {
    const p = await previewVehicleImport(h.router, subscribed, csv(2));
    expect(p.trial).toBeUndefined();
    expect(await commitVehicleImport(h.router, subscribed, csv(12))).toMatchObject({ imported: 12 });
  });
});

describe("the blank vehicle sheet", () => {
  it("has the import's own columns, in order, a required first column, and the lists for class and fuel", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildVehicleSheet()) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([VEHICLE_SHEET_NAME, "Example", "Read me"]);
    const header = wb.getWorksheet(VEHICLE_SHEET_NAME)!.getRow(1).values as unknown[];
    expect(header.slice(1)).toEqual([...VEHICLE_CSV_COLUMNS]);
    expect(wb.getWorksheet(VEHICLE_SHEET_NAME)!.getRow(2).hasValues).toBe(false);          // blank: no customer data
    expect(vehicleSheetCsv()).toBe(`${VEHICLE_CSV_COLUMNS.join(",")}\n`);
  });

  it("says the trial number in its read-me only when it is given, and is the same file every time", async () => {
    const text = async (limit?: number) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await buildVehicleSheet(limit)) as unknown as ArrayBuffer);
      const lines: string[] = [];
      wb.getWorksheet("Read me")!.eachRow((r) => lines.push(String(r.getCell(1).value)));
      return lines.join("\n");
    };
    expect(await text(10)).toContain("A free trial includes up to 10 vehicles");
    expect(await text()).not.toContain("free trial includes");
  });
});

describe("reading a filled-in sheet", () => {
  async function filled(rows: unknown[][], opts: { header?: string[]; sheet?: string } = {}) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(opts.sheet ?? VEHICLE_SHEET_NAME);
    ws.addRow(opts.header ?? [...VEHICLE_CSV_COLUMNS]);
    for (const r of rows) ws.addRow(r);
    return new Uint8Array(await wb.xlsx.writeBuffer());
  }

  it("turns rows into CSV, skips empty rows, writes dates as YYYY-MM-DD and quotes commas", async () => {
    const out = await xlsxToCsv(await filled([
      ["ABC-1", "Toyota", "Hilux, double cab", 2021, "pickup", "diesel", "", "", "", "", 1000, "", new Date("2026-01-31T00:00:00Z")],
      [],
      ["ABC-2"],
    ], { header: ["registration_no", "make", "model", "year", "vehicle_class", "fuel_type", "vin", "engine_no", "colour", "base_location", "odometer_km", "employee_no", "holding_since"] }));
    expect(out.split("\n")).toEqual([
      "registration_no,make,model,year,vehicle_class,fuel_type,vin,engine_no,colour,base_location,odometer_km,employee_no,holding_since",
      'ABC-1,Toyota,"Hilux, double cab",2021,pickup,diesel,,,,,1000,,2026-01-31',
      "ABC-2,,,,,,,,,,,,",
      "",
    ]);
  });

  it("reads the Vehicles sheet, or the first sheet when there is none of that name", async () => {
    expect(await xlsxToCsv(await filled([["ONLY-1"]], { sheet: "Fleet" }))).toContain("ONLY-1");
  });

  it("the CSV it makes goes through the real import", async () => {
    const text = await xlsxToCsv(await filled([[plate()], [plate()]], { header: ["registration_no"] }));
    const p = await previewVehicleImport(h.router, subscribed, text);
    expect(p).toMatchObject({ total: 2, ok: 2, failed: 0 });
  });

  it("refuses a file that is too large or is not an Excel file, in plain words", async () => {
    await expect(xlsxToCsv(new Uint8Array(MAX_SHEET_BYTES + 1))).rejects.toThrow(/larger than 2 MB/);
    await expect(xlsxToCsv(new TextEncoder().encode("registration_no\nABC-1\n"))).rejects.toThrow(/could not be read as an Excel/);
  });

  it("reads a formula as its value and never its text", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(VEHICLE_SHEET_NAME);
    ws.addRow(["registration_no", "make"]);
    ws.addRow(["F-1", { formula: "1+1", result: "Computed" } as ExcelJS.CellValue]);
    const out = await xlsxToCsv(new Uint8Array(await wb.xlsx.writeBuffer()));
    expect(out).toContain("F-1,Computed");
    expect(out).not.toContain("1+1");
  });
});
