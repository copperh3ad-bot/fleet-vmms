# ADR-020: About us page

Status: accepted, 2026-10-24. Owner request: an About us page that centres on the problems of running a fleet that led to the product.

## Decision
1. **`/about` (public, static).** Reads no data and takes no input, like the terms and privacy pages, so it adds no attack surface beyond a name in `PUBLIC_PATHS`.
2. **Content rule.** Each block pairs a problem with something the product does today. No statistics, customer names, testimonials or team names appear unless the owner supplies them. A claim is checked against the code before it is written (for example, "cannot approve their own request" is enforced in the database; "a different person must verify the invoice" is not enforced, so the page does not say it).
3. **Pricing wording.** The page describes the price as about one month's wage of an unskilled labourer and shows no figure, matching the other public pages. It changes with them.

## Not done
- No founder or team section, photos or contact details: the owner has not given them. Add them under this ADR when supplied.
