// The vehicle sheet (ADR-038): a blank Excel (and CSV) form a company can download BEFORE it signs up, fill in while it waits, and upload in one go when its workspace is ready,
// so a trial is spent trying the product, not typing a fleet in. It holds no customer data: it is the same blank sheet for everyone, built from the same column list the import
// reads (VEHICLE_CSV_COLUMNS), so the two cannot drift apart. The import also reads the filled-in Excel file directly (xlsxToCsv), so there is no "save as CSV" step.
import ExcelJS from "exceljs";
import { FUEL_TYPES, VEHICLE_CLASSES } from "./schemas";
import { VEHICLE_CSV_COLUMNS } from "./service";

export const VEHICLE_SHEET_NAME = "Vehicles";
export const MAX_SHEET_ROWS = 500;
export const MAX_SHEET_BYTES = 2_000_000;

const NOTES: Record<(typeof VEHICLE_CSV_COLUMNS)[number], string> = {
  registration_no: "Required. The number plate, as on the vehicle. Each one once.",
  make: "For example Toyota, Isuzu, Suzuki.",
  model: "For example Hilux, NPR, Bolan.",
  year: "Year of manufacture, like 2021.",
  vehicle_class: `One of: ${VEHICLE_CLASSES.join(", ")}.`,
  fuel_type: `One of: ${FUEL_TYPES.join(", ")}.`,
  vin: "Chassis number, if you have it.",
  engine_no: "Engine number, if you have it.",
  colour: "Optional.",
  base_location: "Where the vehicle is usually kept: a city, depot or site.",
  odometer_km: "The reading today, in kilometres.",
  employee_no: "The employee code of the person who holds it. Add your employees first (Employees page), or leave this empty and assign later.",
  holding_since: "When that person started holding it, as a date like 2026-01-31.",
  last_oil_change: "Date of the last oil change, like 2026-01-31. It starts the oil change reminder.",
  last_oil_change_km: "Odometer reading at that oil change.",
};

const EXAMPLE = ["BKL-245", "Isuzu", "NPR", 2021, "truck", "diesel", "", "", "White", "Lahore depot", 48200, "E-001", "2026-01-01", "2026-09-01", 47000];
const WIDTH: Record<string, number> = { registration_no: 16, make: 14, model: 14, year: 8, vehicle_class: 14, fuel_type: 12, vin: 22, engine_no: 16, colour: 12, base_location: 18, odometer_km: 14, employee_no: 14, holding_since: 15, last_oil_change: 16, last_oil_change_km: 18 };

export async function buildVehicleSheet(trialLimit?: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Fleet OTG";
  wb.created = new Date("2026-10-28T00:00:00Z");          // fixed, so the same file is made every time

  const ws = wb.addWorksheet(VEHICLE_SHEET_NAME, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = VEHICLE_CSV_COLUMNS.map((k) => ({ header: k, key: k, width: WIDTH[k] ?? 14 }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.alignment = { vertical: "middle" };
  head.eachCell((c, n) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: n === 1 ? "FFC2410C" : "FF15191D" } };      // the one required column stands out
    c.note = NOTES[VEHICLE_CSV_COLUMNS[n - 1]];
  });
  head.height = 22;
  const col = (k: (typeof VEHICLE_CSV_COLUMNS)[number]) => String.fromCharCode(65 + VEHICLE_CSV_COLUMNS.indexOf(k));
  const validations = (ws as unknown as { dataValidations: { add: (range: string, v: object) => void } }).dataValidations;      // the library supports it; its typings omit it
  const list = (k: (typeof VEHICLE_CSV_COLUMNS)[number], values: readonly string[]) =>
    validations.add(`${col(k)}2:${col(k)}${MAX_SHEET_ROWS + 1}`, { type: "list", allowBlank: true, formulae: [`"${values.join(",")}"`], showErrorMessage: true, errorTitle: "Choose from the list", error: `Use one of: ${values.join(", ")}` });
  list("vehicle_class", VEHICLE_CLASSES);
  list("fuel_type", FUEL_TYPES);
  for (const k of ["holding_since", "last_oil_change"] as const) ws.getColumn(VEHICLE_CSV_COLUMNS.indexOf(k) + 1).numFmt = "yyyy-mm-dd";
  ws.getColumn(1).numFmt = "@";                              // plates are text, so a plate like 0123 is not turned into a number

  const ex = wb.addWorksheet("Example");
  ex.addRow([...VEHICLE_CSV_COLUMNS]).font = { bold: true };
  ex.addRow(EXAMPLE);
  ex.columns = VEHICLE_CSV_COLUMNS.map((k) => ({ width: WIDTH[k] ?? 14 }));

  const rm = wb.addWorksheet("Read me");
  rm.getColumn(1).width = 110;
  for (const line of [
    "Fleet OTG: vehicle sheet",
    "",
    "1. Fill in the sheet called Vehicles, one vehicle per row, starting on row 2. Do not change or remove the column names in row 1.",
    "2. Only registration_no (the number plate) is needed. Everything else is optional, so start with just the plates if that is quicker, and add details later.",
    `3. Up to 500 vehicles in one upload. For more, upload in batches.${trialLimit ? ` A free trial includes up to ${trialLimit} vehicles, so put the ones you most want to try first; you can add the rest once you subscribe.` : ""}`,
    "4. vehicle_class and fuel_type have a drop-down list. Dates are written like 2026-01-31.",
    "5. employee_no must match an employee code already in your workspace. Add your employees first, or leave it empty and assign vehicles later.",
    "6. When your workspace is ready, open Vehicles, then Import, and upload this file as it is. You do not need to save it as CSV. You will see what will be saved, and any problems, before anything is added.",
    "7. The sheet called Example shows one filled-in row. It is not uploaded.",
    "",
    "Nothing here is sent anywhere until you upload it in your own workspace.",
  ]) rm.addRow([line]);
  rm.getRow(1).font = { bold: true, size: 14 };
  rm.eachRow((r) => { r.alignment = { wrapText: true, vertical: "top" }; });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The same blank sheet as CSV, for anyone without Excel. The first line is the column names; the rest is empty. */
export const vehicleSheetCsv = () => `${VEHICLE_CSV_COLUMNS.join(",")}\n`;

// ------------------------------------------------------------------------------------------ reading a filled-in sheet

const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("").trim();
    if ("result" in o) return cellText(o.result as ExcelJS.CellValue);              // a formula: its value, not its text
    if (typeof o.text === "string") return o.text.trim();                           // a hyperlink: the words shown
  }
  return "";
}

/**
 * Turns a filled-in vehicle sheet (.xlsx) into the CSV text the import already understands. It reads the sheet called Vehicles (or the first sheet), takes row 1 as the column
 * names, skips empty rows, and writes dates as YYYY-MM-DD. It only reads cell values: no macro, link or formula in the file is run or followed.
 */
export async function xlsxToCsv(bytes: Uint8Array): Promise<string> {
  if (bytes.length > MAX_SHEET_BYTES) throw new Error("The Excel file is larger than 2 MB. Split it into smaller files.");
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer); } catch { throw new Error("That file could not be read as an Excel (.xlsx) file."); }
  const ws = wb.getWorksheet(VEHICLE_SHEET_NAME) ?? wb.worksheets[0];
  if (!ws) throw new Error("The Excel file has no sheets.");
  const width = Math.min(ws.columnCount || VEHICLE_CSV_COLUMNS.length, 40);
  const grab = (r: ExcelJS.Row) => Array.from({ length: width }, (_, i) => cellText(r.getCell(i + 1).value));
  const header = grab(ws.getRow(1));
  while (header.length > 0 && header[header.length - 1] === "") header.pop();
  const lines = [header.map(csvCell).join(",")];
  const last = Math.min(ws.rowCount, MAX_SHEET_ROWS + 1 + 50);                      // a little beyond the limit so the importer can say "too many rows" rather than silently stopping
  for (let n = 2; n <= last; n++) {
    const cells = grab(ws.getRow(n)).slice(0, header.length);
    if (cells.every((c) => c === "")) continue;
    lines.push(cells.map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}
