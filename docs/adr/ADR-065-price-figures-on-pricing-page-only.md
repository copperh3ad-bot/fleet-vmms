# ADR-065: Price figures appear on the Pricing page only; everywhere else uses a comparison

Status: accepted, 2026-11-08. Owner direction: pricing comes at the Pricing page only and shows the actual price of each plan; for marketing, Basic is as much as an unskilled labourer's monthly wage, and Pro costs no more than a fleet manager's monthly salary.

## Decision
- `/pricing` shows the real figure of each plan, read from the `plans` and `plan_bands` tables (CLAUDE.md rule 7: the price is entered in Admin, Plans, never in code). Basic: the plan price. Pro: its band price ("Every fleet size" while there is one band).
- Every other public page, the customer flyer, the investor flyer and the Compare page carry no figure. They say, for Basic, "The monthly wage of an unskilled labourer" (`Offer.headline`, unchanged) and, for Pro, "Less than a fleet manager's monthly salary" (`PRO_HEADLINE` in `src/lib/billing/offer.ts`, carried on `ProOffer.headline`).
- The landing price box names both plans in words and links to `/pricing`.

## Consequences
- A price change in Admin, Plans shows on `/pricing` and nowhere else; no page or flyer needs editing.
- The comparison lines are marketing claims about the owner's pricing relative to a wage and a salary. If a price is raised enough to break either comparison, the lines must change with it.
- Verified on a local build: the figures `Rs 43,000` and `Rs 65,000` appear on `/pricing` only (checked on /, /features, /compare, /about, /contact, /signup, /terms, /privacy and llms.txt).
