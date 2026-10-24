// The offline job card form (ADR-022): a one-page Excel workbook a person can fill in on a phone or computer with no
// connection, print, and later upload. It carries drop-down lists for the vehicle, reason, category and priority, so the
// values that come back are ones the system knows. Reading it back is strict: a fixed marker, fixed cell positions, size
// and zip limits, and every value mapped through the lists this workspace gave out. What comes out is the same untrusted
// input the on-screen form produces; createJobCard still checks the permission and the rules.
import ExcelJS from "exceljs";
import { CATEGORIES, LINE_KINDS, PRIORITIES } from "./schemas";

export const FORM_ID = "FLEETOTG-JOBCARD-v1";
export const MAX_FORM_BYTES = 1_000_000;
const MAX_UNZIPPED_BYTES = 10_000_000;
const MAX_ENTRIES = 100;
export const FORM_LINES = 15;

export type FormVehicle = { id: string; registration_no: string; make: string | null; model: string | null };
export type FormReason = { id: string; category: string; label: string };
export type FormContext = { company: string; vehicles: FormVehicle[]; reasons: FormReason[] };

export type FormProblem = { field: string; message: string };
export type ReadForm = { input: Record<string, unknown>; problems: FormProblem[] };

// Where each answer lives. The labels are in column A; every answer is in column B.
const ROW = { marker: 2, vehicle: 6, category: 7, reason: 8, cause: 9, detail: 10, priority: 11, needed: 12, odometer: 13, linesHead: 16, lines: 17 } as const;

const NAVY = "FF0F1E28", INPUT = "FFFFF7D6", GREY = "FF5B6B78";
const border = { top: { style: "thin" as const, color: { argb: "FFC3CDD4" } }, bottom: { style: "thin" as const, color: { argb: "FFC3CDD4" } }, left: { style: "thin" as const, color: { argb: "FFC3CDD4" } }, right: { style: "thin" as const, color: { argb: "FFC3CDD4" } } };

const pretty = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
export const vehicleLabel = (v: FormVehicle) => [v.registration_no, [v.make, v.model].filter(Boolean).join(" ")].filter(Boolean).join(" – ");
/** "Worn brake pads (Wear and tear)": the label alone can repeat across categories, so the category is shown too. */
export const reasonLabel = (r: FormReason) => `${r.label} (${pretty(r.category)})`;

// ---------------------------------------------------------------------------------------------------- building

export async function buildJobCardForm(ctx: FormContext): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Fleet OTG";
  wb.created = new Date();

  const ws = wb.addWorksheet("Job card", { views: [{ showGridLines: false }], pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } } });
  const lists = wb.addWorksheet("Lists", { state: "hidden" });
  const col = (n: number, head: string, values: string[]) => { lists.getCell(1, n).value = head; values.forEach((v, i) => { lists.getCell(i + 2, n).value = v; }); };
  col(1, "Vehicles", ctx.vehicles.map(vehicleLabel));
  col(2, "Reasons", ctx.reasons.map(reasonLabel));
  col(3, "Categories", CATEGORIES.map(pretty));
  col(4, "Priorities", PRIORITIES.map(pretty));
  col(5, "Kinds", LINE_KINDS.map(pretty));
  const range = (letter: string, n: number) => `Lists!$${letter}$2:$${letter}$${Math.max(n, 1) + 1}`;

  ws.columns = [{ width: 30 }, { width: 46 }, { width: 10 }, { width: 14 }, { width: 14 }];

  ws.mergeCells("A1:E1");
  const title = ws.getCell("A1");
  title.value = "Job card request form";
  title.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  title.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 30;

  const note = (r: number, text: string, h = 18) => { ws.mergeCells(`A${r}:E${r}`); const c = ws.getCell(`A${r}`); c.value = text; c.font = { size: 9, color: { argb: GREY } }; c.alignment = { wrapText: true, vertical: "top" }; ws.getRow(r).height = h; };
  ws.getCell(`A${ROW.marker}`).value = "Form";
  ws.getCell(`B${ROW.marker}`).value = FORM_ID;
  ws.getCell(`A${ROW.marker + 1}`).value = "Company";
  ws.getCell(`B${ROW.marker + 1}`).value = ctx.company;
  for (const r of [ROW.marker, ROW.marker + 1]) { ws.getCell(`A${r}`).font = { size: 9, color: { argb: GREY } }; ws.getCell(`B${r}`).font = { size: 9, color: { argb: GREY } }; }
  note(5, "Fill in the yellow cells. Where a cell has a small arrow, choose from the list. Save the file, then in Fleet OTG open Job cards, Upload filled forms. Fields marked * are needed. Do not add, move or delete rows.", 38);

  const field = (row: number, label: string, required: boolean) => {
    const a = ws.getCell(`A${row}`);
    a.value = required ? `${label} *` : label;
    a.font = { bold: true, size: 11 };
    a.alignment = { vertical: "middle", wrapText: true };
    const b = ws.getCell(`B${row}`);
    b.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } };
    b.border = border;
    b.protection = { locked: false };
    b.alignment = { vertical: "top", wrapText: true };
    ws.getRow(row).height = 24;
    return b;
  };
  const list = (cell: ExcelJS.Cell, formula: string, what: string) => { cell.dataValidation = { type: "list", allowBlank: true, formulae: [formula], showErrorMessage: true, errorStyle: "stop", errorTitle: what, error: `Choose a ${what.toLowerCase()} from the list.` }; };

  list(field(ROW.vehicle, "Vehicle", true), range("A", ctx.vehicles.length), "Vehicle");
  const cat = field(ROW.category, "Type of job", true); list(cat, range("C", CATEGORIES.length), "Type"); cat.value = pretty("corrective");
  list(field(ROW.reason, "Reason", true), range("B", ctx.reasons.length), "Reason");
  const cause = field(ROW.cause, "What went wrong", true); ws.getRow(ROW.cause).height = 64;
  cause.dataValidation = { type: "textLength", operator: "greaterThanOrEqual", allowBlank: true, formulae: [10], showErrorMessage: true, errorStyle: "stop", errorTitle: "Too short", error: "Say what went wrong, at least 10 characters." };
  field(ROW.detail, "More detail", false); ws.getRow(ROW.detail).height = 48;
  const pri = field(ROW.priority, "Priority", true); list(pri, range("D", PRIORITIES.length), "Priority"); pri.value = pretty("normal");
  const needed = field(ROW.needed, "Needed by (date)", false); needed.numFmt = "yyyy-mm-dd"; needed.alignment = { horizontal: "left" };
  needed.dataValidation = { type: "date", operator: "greaterThan", allowBlank: true, formulae: [new Date(Date.UTC(2020, 0, 1))], showErrorMessage: true, errorStyle: "stop", errorTitle: "Date", error: "Enter a date, for example 2026-11-30." };
  const odo = field(ROW.odometer, "Odometer now (km)", false); odo.alignment = { horizontal: "left" };
  odo.dataValidation = { type: "decimal", operator: "between", allowBlank: true, formulae: [0, 99999999], showErrorMessage: true, errorStyle: "stop", errorTitle: "Odometer", error: "Enter the reading as a number." };

  ws.mergeCells(`A${ROW.linesHead - 1}:E${ROW.linesHead - 1}`);
  const lh = ws.getCell(`A${ROW.linesHead - 1}`);
  lh.value = "Parts, labour and services you already know about (optional)";
  lh.font = { bold: true, size: 11 };
  ws.getRow(ROW.linesHead - 1).height = 24;
  lh.alignment = { vertical: "bottom" };
  ["Type", "Description", "Qty", "Unit cost", "Line total"].forEach((h, i) => {
    const c = ws.getCell(ROW.linesHead, i + 1);
    c.value = h; c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } }; c.border = border;
  });
  for (let i = 0; i < FORM_LINES; i++) {
    const r = ROW.lines + i;
    for (let c = 1; c <= 4; c++) {
      const cell = ws.getCell(r, c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } }; cell.border = border; cell.protection = { locked: false };
      if (c === 1) list(cell, range("E", LINE_KINDS.length), "Type");
      if (c === 3 || c === 4) { cell.dataValidation = { type: "decimal", operator: "greaterThanOrEqual", allowBlank: true, formulae: [0], showErrorMessage: true, errorStyle: "stop", errorTitle: "Number", error: "Enter a number, 0 or more." }; cell.alignment = { horizontal: "right" }; }
    }
    const total = ws.getCell(r, 5);
    total.value = { formula: `IF(AND(ISNUMBER(C${r}),ISNUMBER(D${r})),C${r}*D${r},"")`, result: "" };
    total.border = border; total.numFmt = "#,##0.00"; total.font = { color: { argb: GREY } };
  }
  note(ROW.lines + FORM_LINES + 1, "Prices are in the currency you normally use in Fleet OTG. Estimates are fine; the workshop's quotation is checked later.", 28);

  // Locked so the layout the reader depends on cannot be changed by accident. No password: anyone can unprotect it, and a
  // changed layout is simply refused on upload.
  await ws.protect("", { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------------------------------- reading

/** Sums the sizes the zip says its files will have, without unpacking anything, so a file built to explode is refused first. */
export function zipLooksSafe(b: Uint8Array): string | null {
  if (b.length < 22 || b[0] !== 0x50 || b[1] !== 0x4b) return "That is not an Excel file. Save the form as .xlsx and try again.";
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return "That file is damaged or is not an Excel file.";
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  if (count > MAX_ENTRIES) return "That file has too many parts to be this form.";
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) return "That file is damaged or is not an Excel file.";
    total += dv.getUint32(p + 24, true);
    p += 46 + dv.getUint16(p + 28, true) + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return total > MAX_UNZIPPED_BYTES ? "That file is far larger than this form should be." : null;
}

function text(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("").trim();
    if ("result" in v && v.result !== undefined) return text(v.result as ExcelJS.CellValue);
    if ("text" in v && typeof v.text === "string") return v.text.trim();   // a hyperlink
  }
  return "";
}

const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export async function readJobCardForm(bytes: Uint8Array, ctx: FormContext): Promise<ReadForm> {
  const problems: FormProblem[] = [];
  const bad = (field: string, message: string) => { problems.push({ field, message }); };
  if (bytes.length === 0) return { input: {}, problems: [{ field: "file", message: "The file is empty." }] };
  if (bytes.length > MAX_FORM_BYTES) return { input: {}, problems: [{ field: "file", message: "The file is too large. A filled form is well under 1 MB." }] };
  const unsafe = zipLooksSafe(bytes);
  if (unsafe) return { input: {}, problems: [{ field: "file", message: unsafe }] };

  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer); } catch { return { input: {}, problems: [{ field: "file", message: "We could not open that file. Save it as .xlsx and try again." }] }; }
  const ws = wb.getWorksheet("Job card");
  if (!ws || text(ws.getCell(`B${ROW.marker}`).value) !== FORM_ID) return { input: {}, problems: [{ field: "file", message: "This is not the Fleet OTG job card form, or it is an older version. Download a fresh blank form and fill that in." }] };
  const at = (row: number) => text(ws.getCell(`B${row}`).value);

  const input: Record<string, unknown> = {};

  const vehicleText = at(ROW.vehicle);
  if (!vehicleText) bad("Vehicle", "Choose the vehicle.");
  else {
    const plate = key(vehicleText.split(" – ")[0]);
    const v = ctx.vehicles.find((x) => key(x.registration_no) === plate) ?? ctx.vehicles.find((x) => key(vehicleLabel(x)) === key(vehicleText));
    if (!v) bad("Vehicle", `"${vehicleText}" is not a vehicle you can raise a job card for.`); else input.vehicle_id = v.id;
  }

  const catText = at(ROW.category);
  const cat = CATEGORIES.find((c) => key(pretty(c)) === key(catText) || c === key(catText));
  if (!catText) bad("Type of job", "Choose the type of job."); else if (!cat) bad("Type of job", `"${catText}" is not one of the types in the list.`); else input.category = cat;

  const reasonText = at(ROW.reason);
  if (!reasonText) bad("Reason", "Choose the reason.");
  else {
    const hits = ctx.reasons.filter((r) => key(reasonLabel(r)) === key(reasonText));
    const loose = hits.length ? hits : ctx.reasons.filter((r) => key(r.label) === key(reasonText));
    if (loose.length === 1) input.reason_code_id = loose[0].id;
    else bad("Reason", loose.length > 1 ? `"${reasonText}" matches more than one reason. Choose it from the list.` : `"${reasonText}" is not a reason in the list.`);
  }

  input.cause_text = at(ROW.cause);
  if (!input.cause_text) bad("What went wrong", "Say what went wrong.");
  else if ((input.cause_text as string).length < 10) bad("What went wrong", "Say what went wrong, at least 10 characters.");
  input.description = at(ROW.detail);

  const priText = at(ROW.priority);
  const pri = PRIORITIES.find((p) => key(pretty(p)) === key(priText) || p === key(priText));
  if (!priText) bad("Priority", "Choose the priority."); else if (!pri) bad("Priority", `"${priText}" is not one of the priorities in the list.`); else input.priority = pri;

  const neededCell = ws.getCell(`B${ROW.needed}`).value;
  const neededText = neededCell instanceof Date ? neededCell.toISOString().slice(0, 10) : text(neededCell);
  if (neededText) { if (/^\d{4}-\d{2}-\d{2}$/.test(neededText) && !Number.isNaN(Date.parse(neededText))) input.needed_by = neededText; else bad("Needed by", `"${neededText}" is not a date. Use a date such as 2026-11-30.`); }

  const odoText = at(ROW.odometer).replace(/,/g, "");
  if (odoText) { if (/^\d+(\.\d+)?$/.test(odoText)) input.odometer_km = odoText; else bad("Odometer", `"${odoText}" is not a number.`); }

  const lines: Record<string, unknown>[] = [];
  for (let i = 0; i < FORM_LINES; i++) {
    const r = ROW.lines + i;
    const [kindT, descT, qtyT, costT] = [1, 2, 3, 4].map((c) => text(ws.getCell(r, c).value).replace(/,/g, c >= 3 ? "" : ","));
    if (!kindT && !descT && !qtyT && !costT) continue;
    const label = `Line ${i + 1}`;
    const kind = kindT ? LINE_KINDS.find((k) => key(pretty(k)) === key(kindT) || k === key(kindT)) : "service";
    if (!kind) { bad(label, `"${kindT}" is not one of the types in the list.`); continue; }
    if (!descT) { bad(label, "Describe the line."); continue; }
    if (qtyT && !/^\d+(\.\d+)?$/.test(qtyT)) { bad(label, `Quantity "${qtyT}" is not a number.`); continue; }
    if (costT && !/^\d+(\.\d+)?$/.test(costT)) { bad(label, `Unit cost "${costT}" is not a number.`); continue; }
    lines.push({ kind, description: descT, qty: qtyT, unit_cost: costT });
  }
  input.lines = lines;
  return { input, problems };
}
