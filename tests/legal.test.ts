// The Terms and the Privacy policy (ADR-032): who "we" are comes from Settings and shows as a placeholder when unset, the providers
// named are the ones the code really uses, and the numbers agree with the rest of the site.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOME_FAQ } from "@/lib/faq";
import { LOCK_RETENTION_DAYS, legalFacts } from "@/lib/legal";
import { PLATFORM_SETTINGS, checkPlatformSetting } from "@/lib/billing/settings";

const read = (p: string) => readFileSync(p, "utf8");
const terms = read("src/app/terms/page.tsx");
const privacy = read("src/app/privacy/page.tsx");

describe("who we are comes from Settings", () => {
  it("shows a bracketed placeholder for anything the owner has not entered, so the launch check keeps flagging it", () => {
    const f = legalFacts({});
    for (const v of [f.name, f.address, f.law, f.support, f.privacy]) expect(v).toMatch(/^\[.+\]$/);
    expect(f.registration).toBeNull();
  });
  it("uses what the owner entered, trimmed, and falls back to the support email for privacy requests", () => {
    const f = legalFacts({ seller_legal_name: " Acme Fleet (Pvt) Ltd ", legal_address: "1 Main Rd, Lahore", legal_registration: "0123456", legal_jurisdiction: "the laws of Pakistan", support_email: "support@fleetotg.com" });
    expect(f).toEqual({ name: "Acme Fleet (Pvt) Ltd", address: "1 Main Rd, Lahore", registration: "0123456", law: "the laws of Pakistan", support: "support@fleetotg.com", privacy: "support@fleetotg.com" });
  });
  it("the three new settings exist and are checked like the rest", () => {
    for (const k of ["legal_address", "legal_registration", "legal_jurisdiction"]) expect(PLATFORM_SETTINGS.some((d) => d.key === k)).toBe(true);
    expect(checkPlatformSetting("legal_jurisdiction", "  the laws of Pakistan  ")).toBe("the laws of Pakistan");
    expect(() => checkPlatformSetting("legal_address", "x".repeat(241))).toThrow(/too long/);
  });
  it("both pages take every fact from legalFacts and hard-code none of them", () => {
    for (const src of [terms, privacy]) {
      expect(src).toContain("legalFacts(");
      expect(src).not.toMatch(/\[company legal name|\[Support email|\[database provider|\[period\]/);
    }
  });
});

describe("what the pages say matches what the service does", () => {
  it("names every provider that handles personal data, and no payment-card or tracking provider", () => {
    for (const p of ["Supabase", "Netlify", "Resend", "Zoho", "Anthropic"]) expect(privacy).toContain(p);
    expect(privacy).not.toMatch(/Stripe|Google Analytics|Facebook|Meta Pixel/i);
    expect(read("package.json")).not.toMatch(/stripe|posthog|segment|mixpanel|@sentry|gtag/i);
  });
  it("states the same 30-day keep-after-lock period as the home page", () => {
    expect(LOCK_RETENTION_DAYS).toBe(30);
    expect(HOME_FAQ.find((f) => /after the trial/i.test(f.q))!.a).toContain(`${LOCK_RETENTION_DAYS} days`);
    expect(terms).toContain("{LOCK_RETENTION_DAYS} days");
    expect(privacy).toContain("{LOCK_RETENTION_DAYS} days");
  });
  it("does not put a price in either page (the price lives in the plans table, ADR-014)", () => {
    for (const src of [terms, privacy]) expect(src).not.toMatch(/\$\s?\d|USD\s?\d|Rs\.?\s?\d|PKR\s?\d/i);
  });
  it("covers what a customer and the owner each need: ownership and export for you, limits and payment for us", () => {
    for (const t of ["belong to you", "export your data", "as is", "limited to the fees", "Governing law", "withhold"]) expect(terms.toLowerCase()).toContain(t.toLowerCase());
    for (const t of ["Two roles", "do not sell personal information", "Your choices and rights", "Cookies", "Children"]) expect(privacy).toContain(t);
  });
  it("links the two pages to each other", () => {
    expect(terms).toContain('href="/privacy"');
    expect(privacy).toContain('href="/terms"');
  });
});
