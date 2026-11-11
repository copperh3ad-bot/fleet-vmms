# ADR-087: Payment approval, and who may read invoices

**Status:** Accepted (built, not deployed)  **Date:** 2026-11-11  **Amends:** ADR-086

## Context
ADR-086 let Finance record payments but stopped the person who checked an invoice from paying it. The owner answered the build questionnaire
(docs/OWNER-DECISIONS-2026-11-11.md) and chose a different control: Finance may check and pay the same invoice, and a second person is needed
only for large or unusual payments. The owner also asked that the auditor can read invoices and payments (A4).

## Decision
- **B1 reverses the ADR-086 checker rule.** Nobody is stopped from recording a payment because they checked the invoice, or approved or raised the job
  card (or awarded or asked for the trip). The separation now rests on approval by amount and by price (below). The role check remains: only
  `invoice.pay` holders may record a payment.
- **B2, a payment limit.** Setting `payment_approval_limit` (default **50,000**, empty means no limit, company currency). An invoice whose total is
  above it needs a **payment approval** before any payment is recorded. The limit applies to the **invoice total**, not to each part payment, so splitting
  a payment into small parts does not get round it. This is a reading of "a payment above 50,000"; the owner may prefer per payment.
- **B3, over the quote.** Setting `invoice_over_quote_pct` (default **10**). An invoice whose payable amount is more than that percent above the approved
  quote (workshop) or the awarded price (trip) needs a payment approval, **with a reason** of at least 5 characters.
- **Who approves.** New permission `invoice.approve_payment`, held by the Fleet Manager and the Tenant Admin. The person who approves cannot also
  record the payment, except an administrator when nobody else holds `invoice.approve_payment` (the same rule as ADR-077). One approval covers all the
  part payments of that invoice. Approvals cannot be edited or deleted.
- **Reading.** New permission `invoice.read` (Finance, Tenant Admin, Auditor, Fleet Manager). It opens the Invoices list, the invoice review page
  (without the decision form), the provider invoices on the trip page, the invoices export, and the payments with their approval status. It grants no
  write. Checking an invoice still needs `invoice.verify`; recording a payment needs `invoice.pay`.
- The checks live in the database: `payment_approval_needed`, `approve_invoice_payment` and the replaced `record_invoice_payment` (migration 0053), each
  called only after `can()` in the service (CLAUDE.md rule 3). Nothing here changes job card state (rule 4).

## Not decided here
Whether approval should expire, a second approver above a higher limit, and approval by amount per supplier. The owner has not asked for them.

## Consequences
Companies that upgrade get 50,000 and 10 percent as defaults. A company that wants no approvals empties the limit and raises the percentage on the
Service rules page (Company switches). Existing checked invoices above the limit need an approval before they can be paid.
