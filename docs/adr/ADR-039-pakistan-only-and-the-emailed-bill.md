# ADR-039: Pakistan only for now, and bank details only in an emailed bill

Status: accepted, 2026-10-28. Amends ADR-014, ADR-017 and ADR-035 on how a customer is told how to pay; the price, plans and tax rules themselves are unchanged.

## Decision
1. **The app is limited to Pakistan for now.** Sign-up has no country picker; the form sends `PK` (`PAKISTAN_ONLY` in `src/app/signup/form.tsx`). The foreign-customer flows (dollar invoices, no-tax scenario, the country list, the operator's "change country") are **hidden, not removed**: setting the flag to `false` brings the picker back. Browser tests that need a customer abroad set the country directly on its tax record.
2. **No bank, tax or account-holder wording on any public page or on the Billing page.** Removed from pricing, sign-up, FAQ, Terms (section 5 is now "Price and payment"), Privacy, `llms.txt` and the offer bullets. "Token tax" stays: it is a vehicle-papers feature. The Billing page no longer shows the bank account or the tax breakdown.
3. **A customer gets the bank details in one place only: a bill, by email, when its administrator presses "Request bill" on the Billing page.** The system builds the bill (`src/lib/billing/bill.ts`): number (`BILL-<reference>-<date>`), payment reference, the amount, the bank account and payment note from Admin, Settings, and the seller details. The bill is a request for payment, not the tax invoice; the invoice is still issued when the payment is confirmed.
4. **The amount on the bill is what the customer must send**: subtotal, sales tax and total when a tax scenario applies; for a customer that withholds, the amount it keeps back and the net "Send us". Without a tax figure it is the plan price with a rupee estimate.
5. **A copy goes to the Billing mailbox** (who asked, which reference) without the bank account. Replies to the bill go to the Billing email.
6. **Rules:** only the administrator (`admin.settings`, checked first); allowed while the workspace is locked; at most 3 requests an hour per organization (`allowShared`); the button is hidden until bank details are entered; nothing is stored, so no migration. The bank details never appear on a screen and never in the repository (rule 6).

## Consequences
- The Billing email and the bank details (Admin, Settings) must be set before the button shows.
- The customer's tax-details form is still on the Billing page, because the bill's tax figures depend on it. Whether to remove it is open.
- Public pages and the sign-up form now say nothing about foreign customers; the pricing page still shows the plan price from the `plans` table (rule 7).

## Not done
- Card payment.
- Moving plans by payment (ADR-035 step 2).
