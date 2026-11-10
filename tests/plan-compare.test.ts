import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMPARE, proOnlyRows } from "@/lib/plan-compare";
import { guardDecision } from "@/lib/auth/routing";
import { INDEXABLE_PATHS } from "@/lib/site";

// ADR-063: the Compare plans page.
const rows = COMPARE.flatMap((g) => g.rows);

describe("the comparison data", () => {
  it("gives Pro everything Basic has, and Basic everything except the fleet operations, AI, WhatsApp and logistics provider rows", () => {
    for (const r of rows) if (r.basic) expect(r.pro).toBe(true);
    expect(proOnlyRows().map((r) => r.feature).every((f) => /AI|WhatsApp|[Ll]ogistics provider|Trip scheduling|Cargo requests/.test(f))).toBe(true);
    expect(proOnlyRows()).toHaveLength(9);
    expect(rows.filter((r) => r.basic).length).toBeGreaterThan(30);
  });
  it("has no empty or repeated feature, and no group without rows", () => {
    expect(new Set(rows.map((r) => r.feature)).size).toBe(rows.length);
    for (const g of COMPARE) { expect(g.title.trim()).not.toBe(""); expect(g.rows.length).toBeGreaterThan(0); }
    for (const r of rows) expect(r.feature.trim().length).toBeGreaterThan(5);
  });
  it("states no price, currency or figure anywhere (CLAUDE.md rule 7)", () => {
    const text = JSON.stringify(COMPARE) + readFileSync("src/app/compare/page.tsx", "utf8");
    expect(text).not.toMatch(/\bPKR\b|\bUSD\b|\bRs\.?\s?\d|\$\s?\d|\b\d{2,}[,.]?\d{3}\b|per month\s+\d|43,?000|149/);
  });
});

describe("the page", () => {
  const src = readFileSync("src/app/compare/page.tsx", "utf8");
  it("is public, in the sitemap, and reads its prices from the plans table", () => {
    expect(guardDecision("/compare", false)).toEqual({ action: "next" });
    expect(INDEXABLE_PATHS).toContain("/compare");
    expect(src).toMatch(/loadOffer\(/);
    expect(src).toMatch(/loadProOffer\(/);
  });
  it("has one h1 (from the hero), a captioned table with headers, and a text label for every mark", () => {
    expect(src.match(/<PageHero\b/g)?.length).toBe(1);
    expect(src.match(/<h1\b/g)).toBeNull();
    expect(src).toMatch(/<caption/);
    expect(src).toMatch(/scope="col"/);
    expect(src).toMatch(/scope="row"/);
    expect(src).toMatch(/aria-label=\{`\$\{label\}: included`\}/);
    expect(src).toMatch(/aria-label=\{`\$\{label\}: not included`\}/);
  });
});
