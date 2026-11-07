import { describe, expect, it } from "vitest";
import { CATALOG, FIRST_YEAR, MAKES, OTHER, modelsOf, resolveChoice, yearChoices } from "@/lib/master/vehicle-catalog";
import { vehicleSchema } from "@/lib/master/schemas";

// ADR-052: make, model and year are drop-downs on the Add vehicle form, with "Other" so nothing is ever refused for not being listed.
describe("the vehicle drop-downs", () => {
  it("lists each make once, each model once, and never uses the reserved word as a name", () => {
    expect(new Set(MAKES).size).toBe(MAKES.length);
    for (const m of MAKES) {
      expect(m).not.toBe(OTHER);
      expect(new Set(modelsOf(m)).size).toBe(modelsOf(m).length);
      for (const x of modelsOf(m)) expect(x.length).toBeLessThanOrEqual(60);          // what a model may be
    }
    expect(MAKES).toEqual(expect.arrayContaining(["Toyota", "Suzuki", "Honda", "Isuzu", "Hino"]));
    expect(CATALOG.Toyota).toContain("Hilux");
    expect(modelsOf("Nobody")).toEqual([]);          // a make that is not listed has no models: the model is typed
  });

  it("offers every year the form will accept, newest first, up to next year", () => {
    const ys = yearChoices(2026);
    expect(ys[0]).toBe(2027);
    expect(ys.at(-1)).toBe(FIRST_YEAR);
    expect(ys).toEqual([...ys].sort((a, b) => b - a));
    for (const y of ys) expect(vehicleSchema.shape.year.safeParse(String(y)).success).toBe(true);
  });

  it("turns the choice and the typed name into the name that is saved", () => {
    expect(resolveChoice("Toyota", "ignored")).toBe("Toyota");
    expect(resolveChoice(OTHER, "  Zotye  ")).toBe("Zotye");
    expect(resolveChoice(OTHER, "")).toBe("");          // "Other" with nothing typed is empty, so the form asks for it
    expect(resolveChoice("", "typed")).toBe("");
  });

  it("every listed make and model is accepted as a vehicle", () => {
    for (const make of MAKES) for (const model of modelsOf(make).length ? modelsOf(make) : ["Anything"])
      expect(vehicleSchema.safeParse({ registration_no: "ABC-123", make, model }).success).toBe(true);
  });
});
