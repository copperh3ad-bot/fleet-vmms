# ADR-057: Monthly price PKR 43,000 and one month free for a yearly payment

Status: accepted, 2026-11-07. Owner decision: "Per month price is 43000. Yearly subscription gets one month free." Amends ADR-014 and ADR-052 and CLAUDE.md rule 7 (which named USD 149).

## Decision
- **Basic is PKR 43,000 per month** per organization. The amount is still stored in the `plans` table only. The owner enters it in Admin, Plans (Price 43000, Currency PKR); this change does not write it anywhere in code or in the live database.
- **Paying for 12 months at once gives 12 months of access for 11 months' price** (one month free). `billedMonths()` in `src/lib/billing/months.ts` is the only place the rule lives. Fewer than 12 months are charged in full; 24 months would be 22.
- The customer's claim form still takes "Months paid for" (1 to 12). For 12, the amount expected is 11 times the monthly price.

## Where it applies
- `settle` (confirming a claim or recording a payment by hand): the paid-until date moves by the months of access (12), while the invoice amount and tax are worked out on `billedMonths(months)` (11). The invoice row keeps `months = 12`.
- `previewClaimTax` and `quoteTax`: same arithmetic, so the operator sees the right total before confirming.
- Admin Payments "Expected" amount, and the Billing page wording and form hint.

## Not changed
- No schema change. Existing customers keep the price and currency they joined at (ADR-052). To move them to PKR 43,000 the owner edits their billing record or they re-join.
- Public pages and the flyer do not state the price (CLAUDE.md rule 7); say it on the pricing page once the owner enters it in Admin.

## Owner steps
Admin, Plans: Price 43000, Currency PKR. Then check a trial sign-up shows "Rs 43,000".

## Tests
`tests/yearly-offer.test.ts`.
