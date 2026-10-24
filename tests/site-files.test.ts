// The files crawlers and phones ask for (ADR-023): what is listed is public, what is private is never listed.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { guardDecision, PUBLIC_PATHS } from "@/lib/auth/routing";
import { INDEXABLE_PATHS, pageMeta, PRIVATE_PREFIXES, SITE_URL } from "@/lib/site";

describe("robots.txt", () => {
  it("allows the site, asks crawlers to leave every private area, and names the sitemap", () => {
    const r = robots();
    const rule = (Array.isArray(r.rules) ? r.rules[0] : r.rules) as { allow?: string; disallow?: string[] };
    expect(rule.allow).toBe("/");
    for (const p of ["/w/", "/admin", "/o/", "/invite/", "/api/", "/auth/", "/setup"]) expect(rule.disallow).toContain(p);
    expect(r.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });
});

describe("sitemap.xml", () => {
  it("lists only pages anyone can open, once each, on the site's own address", () => {
    const urls = sitemap().map((s) => s.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const u of urls) {
      expect(u.startsWith(SITE_URL)).toBe(true);
      const path = u.slice(SITE_URL.length) || "/";
      expect(PUBLIC_PATHS, `${path} is in the sitemap but is not public`).toContain(path);
      expect(guardDecision(path, false)).toEqual({ action: "next" });
    }
  });
  it("never lists a private or plumbing address", () => {
    for (const p of INDEXABLE_PATHS) for (const priv of PRIVATE_PREFIXES) expect(p.startsWith(priv), `${p} starts with ${priv}`).toBe(false);
    for (const p of ["/login", "/forgot-password", "/reset-password", "/api/health", "/admin"]) expect(sitemap().map((s) => s.url)).not.toContain(`${SITE_URL}${p}`);
  });
});

describe("security.txt", () => {
  const txt = readFileSync("public/.well-known/security.txt", "utf8");
  it("has a contact, a canonical address and a date that has not passed", () => {
    expect(txt).toMatch(/^Contact: https:\/\/\S+$/m);
    expect(txt).toContain(`Canonical: ${SITE_URL}/.well-known/security.txt`);
    const exp = txt.match(/^Expires: (\S+)$/m)?.[1];
    expect(exp && Date.parse(exp) > Date.now() + 30 * 86_400_000, "security.txt expires within 30 days: set a new date").toBe(true);
  });
});

describe("link previews", () => {
  it("each page gets matching title and description for the page, a link card and a site name", () => {
    const m = pageMeta("About us · Fleet OTG", "Why Fleet OTG exists.");
    expect(m.title).toBe("About us · Fleet OTG");
    expect(m.openGraph).toMatchObject({ title: "About us · Fleet OTG", description: "Why Fleet OTG exists.", siteName: "Fleet OTG" });
    expect(m.twitter).toMatchObject({ card: "summary_large_image", title: "About us · Fleet OTG" });
  });
  it("the share picture is the size link previews expect, and the phone icon is square and opaque", () => {
    const png = (f: string) => { const b = readFileSync(f); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] }; };
    expect(png("src/app/opengraph-image.png")).toMatchObject({ w: 1200, h: 630 });
    expect(png("src/app/apple-icon.png")).toMatchObject({ w: 180, h: 180, colorType: 2 });   // colour type 2: RGB with no transparency
  });
});
