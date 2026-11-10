// What search engines, answer engines and AI assistants read (ADR-031): structured data, the plain-text summary and the crawler
// rules. Nothing here may be made up: no price, no rating, no customer, and no private address.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { GET as llms } from "@/app/llms.txt/route";
import { HOME_FAQ, PRICING_FAQ } from "@/lib/faq";
import { breadcrumbLd, faqLd, ldString, organizationLd, softwareLd, webPageLd, websiteLd } from "@/lib/seo";
import { PRIVATE_PREFIXES, SITE_URL } from "@/lib/site";

describe("structured data", () => {
  it("names the organisation and the site at the site's own address, and nothing invented", () => {
    const o = organizationLd(), w = websiteLd(), s = softwareLd();
    expect(o).toMatchObject({ "@type": "Organization", name: "Fleet OTG", url: SITE_URL });
    expect(w).toMatchObject({ "@type": "WebSite", url: SITE_URL });
    expect(s).toMatchObject({ "@type": "SoftwareApplication", applicationCategory: "BusinessApplication" });
    for (const d of [o, w, s]) for (const k of ["aggregateRating", "review", "address", "founder", "telephone", "offers", "price"]) expect(d, `${d["@type"]} must not carry ${k}`).not.toHaveProperty(k);
  });
  it("the FAQ data holds a question and an answer each, with no price in the text", () => {
    for (const f of [...HOME_FAQ, ...PRICING_FAQ]) {
      expect(f.q.endsWith("?")).toBe(true);
      expect(f.a.length).toBeGreaterThan(40);
      expect(f.a, `${f.q} states a price`).not.toMatch(/\$\s?\d|USD\s?\d|Rs\.?\s?\d|PKR\s?\d|per month/i);
    }
    expect(new Set(HOME_FAQ.map((f) => f.q)).size).toBe(HOME_FAQ.length);
  });
  it("the FAQ page markup carries the same questions and answers a person reads", () => {
    const ld = faqLd(HOME_FAQ) as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    expect(ld.mainEntity.map((q) => q.name)).toEqual(HOME_FAQ.map((f) => f.q));
    expect(ld.mainEntity.map((q) => q.acceptedAnswer.text)).toEqual(HOME_FAQ.map((f) => f.a));
  });
  it("breadcrumbs and page markup use absolute addresses on the site", () => {
    const b = breadcrumbLd([["Fleet OTG", "/"], ["Features", "/features"]]) as { itemListElement: { position: number; item: string }[] };
    expect(b.itemListElement.map((i) => i.item)).toEqual([SITE_URL, `${SITE_URL}/features`]);
    expect(b.itemListElement.map((i) => i.position)).toEqual([1, 2]);
    expect(webPageLd("t", "/features", "d")).toMatchObject({ url: `${SITE_URL}/features` });
  });
  it("cannot be used to close the script tag early", () => {
    const out = ldString({ x: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).x).toBe("</script><script>alert(1)</script>");
  });
});

describe("llms.txt", () => {
  it("summarises the product, lists only public pages, and says nothing about customers or prices", async () => {
    const r = llms();
    expect(r.headers.get("content-type")).toContain("text/plain");
    const t = await r.text();
    expect(t.startsWith("# Fleet OTG\n")).toBe(true);
    expect(t).toMatch(/^> .+/m);
    const listed = [...t.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
    expect(listed.length).toBeGreaterThan(4);
    const sitemapUrls = new Set(sitemap().map((s) => s.url));
    for (const u of listed) expect(sitemapUrls.has(u), `${u} is in llms.txt but not in the sitemap`).toBe(true);
    for (const p of PRIVATE_PREFIXES) expect(listed.some((u) => u.startsWith(`${SITE_URL}${p}`)), `llms.txt links into ${p}`).toBe(false);
    expect(t).not.toMatch(/\$\s?\d|USD\s?\d|Rs\.?\s?\d|PKR\s?\d/i);
  });
});

describe("robots.txt for answer engines", () => {
  const rules = (robots().rules as { userAgent?: string | string[]; allow?: string; disallow?: string[] }[]);
  it("names the AI search and answer crawlers, allows the public site and repeats every private rule for them", () => {
    const ai = rules.find((r) => Array.isArray(r.userAgent) && r.userAgent.includes("OAI-SearchBot"));
    expect(ai).toBeTruthy();
    for (const bot of ["ChatGPT-User", "Claude-SearchBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]) expect(ai!.userAgent).toContain(bot);
    expect(ai!.allow).toBe("/");
    for (const p of PRIVATE_PREFIXES) expect(ai!.disallow, `${p} must stay private for AI crawlers`).toContain(p);
  });
  it("keeps one-time quotation links and driver links out of every crawler's reach", () => {
    for (const r of rules) { expect(r.disallow).toContain("/q/"); expect(r.disallow).toContain("/o/"); }
  });
});

describe("the features page and the pages that carry markup", () => {
  it("is listed in the sitemap and has one h1, a definition up front and no prices", () => {
    expect(sitemap().map((s) => s.url)).toContain(`${SITE_URL}/features`);
    const src = readFileSync("src/app/features/page.tsx", "utf8");
    // The one h1 comes from PageHero, which renders exactly one.
    expect(src.match(/<PageHero\b/g)?.length).toBe(1);
    expect(src.match(/<h1\b/g)).toBeNull();
    expect(readFileSync("src/components/page-hero.tsx", "utf8").match(/<h1\b/g)?.length).toBe(1);
    expect(src).toMatch(/Fleet OTG is fleet maintenance and operations software/);
    expect(src).not.toMatch(/\$\s?\d|USD\s?\d|Rs\.?\s?\d|PKR\s?\d/i);
  });
  it("puts structured data on the layout, the home page and the pricing page", () => {
    expect(readFileSync("src/app/layout.tsx", "utf8")).toContain("organizationLd()");
    expect(readFileSync("src/app/landing.tsx", "utf8")).toContain("faqLd(HOME_FAQ)");
    expect(readFileSync("src/app/pricing/page.tsx", "utf8")).toContain("faqLd(PRICING_FAQ)");
  });
});
