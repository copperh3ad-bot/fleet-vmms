// The offline job card form (ADR-022): what is built, what is read back, and what is refused.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildJobCardForm, FORM_ID, FORM_LINES, MAX_FORM_BYTES, readJobCardForm, reasonLabel, vehicleLabel, zipLooksSafe, type FormContext } from "@/lib/jobcards/offline-form";
import { jobCardSchema } from "@/lib/jobcards/schemas";

const V1 = "11111111-1111-4111-8111-111111111111", V2 = "22222222-2222-4222-8222-222222222222";
const R1 = "33333333-3333-4333-8333-333333333333", R2 = "44444444-4444-4444-8444-444444444444", R3 = "55555555-5555-4555-8555-555555555555";
const ctx: FormContext = {
  company: "Acme Transport",
  vehicles: [{ id: V1, registration_no: "LHR-1001", make: "Toyota", model: "Hilux" }, { id: V2, registration_no: "KHI-77", make: null, model: null }],
  reasons: [{ id: R1, category: "wear_and_tear", label: "Worn brake pads" }, { id: R2, category: "defect", label: "Oil leak" }, { id: R3, category: "wear_and_tear", label: "Oil leak" }],
};

async function filled(set: (ws: ExcelJS.Worksheet) => void, c: FormContext = ctx): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildJobCardForm(c) as unknown as ArrayBuffer);
  set(wb.getWorksheet("Job card")!);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
const complete = (ws: ExcelJS.Worksheet) => {
  ws.getCell("B6").value = vehicleLabel(ctx.vehicles[0]);
  ws.getCell("B8").value = reasonLabel(ctx.reasons[0]);
  ws.getCell("B9").value = "Brakes squeal and the pedal feels soft";
};

describe("the blank form", () => {
  it("is one page with the marker, lists, drop-downs and a locked layout", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildJobCardForm(ctx) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Job card", "Lists"]);
    expect(wb.getWorksheet("Lists")!.state).toBe("hidden");
    const ws = wb.getWorksheet("Job card")!;
    expect(ws.getCell("B2").value).toBe(FORM_ID);
    expect(ws.getCell("B3").value).toBe("Acme Transport");
    expect(ws.getCell("B6").dataValidation.type).toBe("list");
    expect(ws.getCell("B6").dataValidation.formulae?.[0]).toBe("Lists!$A$2:$A$3");
    expect(ws.getCell("B8").dataValidation.formulae?.[0]).toBe("Lists!$B$2:$B$4");
    expect(ws.getCell("B7").value).toBe("Corrective");
    expect(ws.getCell("B11").value).toBe("Normal");
    expect(ws.getCell("A17").dataValidation.type).toBe("list");
    expect(ws.getCell("B6").protection?.locked).toBe(false);
    expect(ws.getCell("A6").protection?.locked ?? true).toBe(true);
    expect(wb.getWorksheet("Lists")!.getCell("A2").value).toBe("LHR-1001 – Toyota Hilux");
    expect(wb.getWorksheet("Lists")!.getCell("A3").value).toBe("KHI-77");
  });

  it("still builds when there are no vehicles or reasons yet", async () => {
    const buf = await buildJobCardForm({ company: "New Co", vehicles: [], reasons: [] });
    expect((await readJobCardForm(new Uint8Array(buf), { company: "New Co", vehicles: [], reasons: [] })).problems.map((p) => p.field)).toContain("Vehicle");
  });
});

describe("reading a filled form", () => {
  it("turns a complete form into the input the job card schema accepts", async () => {
    const bytes = await filled((ws) => {
      complete(ws);
      ws.getCell("B7").value = "Accident"; ws.getCell("B10").value = "Happened on the motorway";
      ws.getCell("B11").value = "High"; ws.getCell("B12").value = new Date(Date.UTC(2026, 10, 30)); ws.getCell("B13").value = 48210;
      ws.getCell("A17").value = "Part"; ws.getCell("B17").value = "Brake pads (front)"; ws.getCell("C17").value = 2; ws.getCell("D17").value = 4500.5;
      ws.getCell("B18").value = "Labour";
    });
    const r = await readJobCardForm(bytes, ctx);
    expect(r.problems).toEqual([]);
    expect(r.input).toMatchObject({ vehicle_id: V1, category: "accident", reason_code_id: R1, priority: "high", needed_by: "2026-11-30", odometer_km: "48210", description: "Happened on the motorway" });
    expect(r.input.lines).toEqual([{ kind: "part", description: "Brake pads (front)", qty: "2", unit_cost: "4500.5" }, { kind: "service", description: "Labour", qty: "", unit_cost: "" }]);
    const parsed = jobCardSchema.parse(r.input);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[1]).toMatchObject({ qty: 1, unit_cost: 0 });
  });

  it("accepts the plate typed on its own, in any case, and a date typed as text", async () => {
    const r = await readJobCardForm(await filled((ws) => { complete(ws); ws.getCell("B6").value = "  khi-77 "; ws.getCell("B12").value = "2026-12-01"; }), ctx);
    expect(r.problems).toEqual([]);
    expect(r.input).toMatchObject({ vehicle_id: V2, needed_by: "2026-12-01" });
  });

  it("says what is missing on a blank form, by the name on the form", async () => {
    const r = await readJobCardForm(await filled(() => undefined), ctx);
    expect(r.problems.map((p) => p.field)).toEqual(["Vehicle", "Reason", "What went wrong"]);
  });

  it("refuses values that are not in the lists, and numbers and dates that are not", async () => {
    const r = await readJobCardForm(await filled((ws) => {
      complete(ws);
      ws.getCell("B6").value = "ZZZ-999"; ws.getCell("B7").value = "Fun"; ws.getCell("B8").value = "Mystery"; ws.getCell("B9").value = "short";
      ws.getCell("B11").value = "Whenever"; ws.getCell("B12").value = "next week"; ws.getCell("B13").value = "lots";
      ws.getCell("A17").value = "Gold"; ws.getCell("B17").value = "x";
      ws.getCell("B18").value = "Tyre"; ws.getCell("C18").value = "two";
      ws.getCell("C19").value = 3;
    }), ctx);
    expect(r.problems.map((p) => p.field)).toEqual(["Vehicle", "Type of job", "Reason", "What went wrong", "Priority", "Needed by", "Odometer", "Line 1", "Line 2", "Line 3"]);
    expect(r.problems[0].message).toContain("ZZZ-999");
  });

  it("asks for the exact choice when a reason name repeats across categories", async () => {
    const both = await readJobCardForm(await filled((ws) => { complete(ws); ws.getCell("B8").value = "Oil leak"; }), ctx);
    expect(both.problems[0].message).toContain("more than one");
    const exact = await readJobCardForm(await filled((ws) => { complete(ws); ws.getCell("B8").value = reasonLabel(ctx.reasons[1]); }), ctx);
    expect(exact.input.reason_code_id).toBe(R2);
  });

  it("reads at most the lines the form has", async () => {
    const r = await readJobCardForm(await filled((ws) => { complete(ws); for (let i = 0; i < FORM_LINES; i++) ws.getCell(17 + i, 2).value = `Item ${i + 1}`; }), ctx);
    expect(r.problems).toEqual([]);
    expect((r.input.lines as unknown[]).length).toBe(FORM_LINES);
  });
});

describe("what is refused outright", () => {
  const file = (msg: Promise<{ problems: { field: string; message: string }[] }>) => msg.then((r) => (r.problems.length === 1 && r.problems[0].field === "file" ? r.problems[0].message : `NOT REFUSED: ${JSON.stringify(r.problems)}`));

  it("an empty file, a non-Excel file, a damaged zip and a file that is too large", async () => {
    expect(await file(readJobCardForm(new Uint8Array(), ctx))).toContain("empty");
    expect(await file(readJobCardForm(new TextEncoder().encode("a,b,c\n1,2,3"), ctx))).toContain("not an Excel file");
    expect(await file(readJobCardForm(new Uint8Array([0x50, 0x4b, ...new Array(60).fill(7)]), ctx))).toContain("damaged");
    expect(await file(readJobCardForm(new Uint8Array(MAX_FORM_BYTES + 1), ctx))).toContain("too large");
  });

  it("a real workbook that is not this form, and the form with its marker changed", async () => {
    const other = new ExcelJS.Workbook(); other.addWorksheet("Sheet1").getCell("A1").value = "hello";
    expect(await file(readJobCardForm(new Uint8Array(await other.xlsx.writeBuffer()), ctx))).toContain("not the Fleet OTG job card form");
    expect(await file(readJobCardForm(await filled((ws) => { complete(ws); ws.getCell("B2").value = "FLEETOTG-JOBCARD-v0"; }), ctx))).toContain("older version");
  });

  it("a zip whose directory claims it unpacks to far more than the limit", () => {
    const name = new TextEncoder().encode("a.xml");
    const cd = new Uint8Array(46 + name.length); const c = new DataView(cd.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint32(24, 500_000_000, true); c.setUint16(28, name.length, true); cd.set(name, 46);
    const eocd = new Uint8Array(22); const e = new DataView(eocd.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(10, 1, true); e.setUint32(12, cd.length, true); e.setUint32(16, 0, true);
    const zip = new Uint8Array([...cd, ...eocd]);
    expect(zipLooksSafe(zip)).toContain("far larger");
  });
});
