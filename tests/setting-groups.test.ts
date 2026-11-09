import { describe, expect, it } from "vitest";
import { PLATFORM_SETTINGS } from "@/lib/billing/settings";
import { SETTING_GROUPS, groupedSettings } from "@/lib/billing/setting-groups";

// The operator's Settings screen is grouped for reading; grouping must never hide a setting or invent one.
describe("the settings screen groups", () => {
  it("shows every setting exactly once", () => {
    const shown = groupedSettings().flatMap((g) => g.defs.map((d) => d.key));
    expect(shown.sort()).toEqual(PLATFORM_SETTINGS.map((d) => d.key).sort());
    expect(new Set(shown).size).toBe(shown.length);
  });
  it("names only settings that exist, and every setting is placed in a section (none falls into Other)", () => {
    const known = new Set(PLATFORM_SETTINGS.map((d) => d.key));
    for (const g of SETTING_GROUPS) for (const k of g.keys) expect(known.has(k)).toBe(true);
    expect(groupedSettings().some((g) => g.id === "other")).toBe(false);
  });
  it("puts a setting nobody placed under Other instead of hiding it", () => {
    const extra = { key: "brand_new", label: "Brand new", hint: "x", max: 10 };
    const g = groupedSettings([...PLATFORM_SETTINGS, extra]);
    expect(g.at(-1)).toMatchObject({ id: "other" });
    expect(g.at(-1)!.defs.map((d) => d.key)).toEqual(["brand_new"]);
  });
});
