# ADR-031: Search, answer-engine and AI-assistant optimisation

Status: accepted, 2026-10-28. Builds on ADR-023 (crawler files and link previews), which listed "no structured data" as not done.

## Decision
1. **Structured data (schema.org JSON-LD)** is rendered in each page's first HTML by `src/components/json-ld.tsx`, built in `src/lib/seo.ts`:
   Organization and WebSite on every page; SoftwareApplication and FAQPage on the home page; FAQPage and breadcrumbs on Pricing; WebPage
   and breadcrumbs on Features. It states only facts the page already says in words. No ratings, reviews, addresses, founders, telephone
   numbers or prices are made up, and **the price is never repeated in markup** because it lives in the plans table (ADR-014, rule 7).
2. **One source for the FAQ.** `src/lib/faq.ts` feeds both the visible questions and the FAQPage markup, so a person and a crawler read the
   same words. A test checks they match and that no answer states a price.
3. **A Features page (`/features`)**: static, answer-first text (what the product is in the opening paragraph, who it is for, how a repair
   moves through it, eight problems and what answers each). Public, listed in the sitemap, linked from the header, the phone menu and the
   footer. It adds no data access, so it joins the public pages in rule 5.
4. **`/llms.txt`**: a plain-text summary for AI assistants (llmstxt.org). Static, lists only pages that are in the sitemap, names no
   customer and no price. Public under rule 5.
5. **`robots.txt` names the AI search and answer crawlers** (OAI-SearchBot, ChatGPT-User, GPTBot, Claude-SearchBot, Claude-User, ClaudeBot,
   PerplexityBot, Perplexity-User, Google-Extended, Applebot-Extended), allows the public site and repeats every private rule for them,
   because a crawler that finds a rule naming it ignores the `*` rule. The owner may keep a crawler out of model training by moving its name
   to a `disallow: "/"` rule. `/q/` (one-time workshop links) joins the private prefixes.
6. **Titles and descriptions** say what the product is in the words people search for ("fleet maintenance management software").

## Why
People now ask assistants and answer engines what software to use. They quote pages that state plainly what a product is, who it is for and
what it does, and that machines can read without guessing. Claims that are made up, or that drift from the page, get quoted wrongly.

## Not done
- No per-page share pictures, and the share picture (`opengraph-image.png`) still has the old colours.
- No reviews, case studies or customer numbers: none exist yet, and none are invented. Adding real ones is the biggest remaining gain.
- No blog or comparison pages, and no Search Console or Bing Webmaster verification (the owner does these, docs/OPERATIONS.md).
