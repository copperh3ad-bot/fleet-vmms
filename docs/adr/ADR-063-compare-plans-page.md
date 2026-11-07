# ADR-063: A public Compare plans page

Status: accepted, 2026-11-08 (built, not deployed). Owner request: "Make a plans and features comparison page."

## Decision
- A new public page, **`/compare`** ("Compare plans"), shows Basic and Pro side by side in one table: rows grouped under Job cards and approvals, Workshops, Vehicles/people/servicing, Costs and reports, Accounts and security, and AI and WhatsApp. Basic has every row except the two in the last group; Pro has all of them (ADR-035).
- **No price is in the code or the page text** (CLAUDE.md rule 7). The column heads read the owner's figures from the plans table through the same functions the Pricing page uses (`loadOffer`, `loadProOffer`): Basic shows its headline, period and trial days; Pro shows "Priced by the size of your fleet" once the owner has entered every band, and "Coming in the second phase" until then. The page links to Pricing for what each plan costs and how paying works.
- The rows are data in `src/lib/plan-compare.ts`, not copy in the page, so a test can keep them honest: every row is something the product does today, Basic has everything that is not an AI row, and no row states a figure.
- It follows the rules for a public page (CLAUDE.md rule 5, added there): in `PUBLIC_PATHS`, the sitemap (`INDEXABLE_PATHS`), `llms.txt`, the public chat paths, the footer and the phone menu; linked from Pricing. It uses the shared shell and hero, one `h1`, a real table with a caption, column and row headers, and a text label for every tick and dash (no information by colour or icon alone).
- No new endpoint, no form, no data collected.

## Not done
The Pricing page still lists the plans; this page is the detailed comparison. Nothing about either was merged.

## Tests
`tests/plan-compare.test.ts`; the routing, sitemap and browser-suite public-page lists include `/compare`.
