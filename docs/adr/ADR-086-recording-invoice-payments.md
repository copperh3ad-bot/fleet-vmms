# ADR-086: Recording payment of invoices

**Status:** Accepted (built, not deployed). **Amended by ADR-087 the same day:** the segregation-of-duties rule below (the checker cannot pay) was reversed by the owner; large and over-quote payments now need an approval instead.  **Date:** 2026-11-11

## Context
Finance could verify a workshop invoice (ADR-007) or a logistics provider's trip invoice (ADR-078) but there was nowhere to record that it was
paid. The `paid` status existed in the schema for workshop invoices and nothing could reach it. The full-flow QA run (QA-FULLFLOW-2026-11-10, finding F-05)
and the owner's flow ("Accounts pays workshop and vendor invoices") both need it.

## Decision
- New permission `invoice.pay`, held by Finance and the Tenant Admin. The Auditor reads nothing new here.
- New table `invoice_payments`: one row per payment (payment number, amount, date, method, reference, note, who recorded it), for either a workshop
  invoice or a trip invoice (exactly one of the two). Part payments are allowed; the amount due is the verified payable amount plus tax for a
  workshop invoice, and the verified payable amount for a trip invoice.
- Only a **verified** invoice can be paid. A payment may not take the total above the amount due. The date may not be in the future. Every method except
  cash needs a reference (cheque number, transfer id).
- A workshop invoice becomes `paid` when the payments reach the amount due (and goes back to `verified` if a payment is voided). A trip invoice keeps
  its status and is shown as paid when the payments reach the amount due, so the provider-link functions of migration 0046 stay untouched.
- Payments are append-only: they cannot be edited or deleted. A mistake is corrected by **voiding** the payment with a reason (5 characters or more)
  and recording it again. Void rows stay visible with who voided them and why.
- **Segregation of duties:** the person who verified the invoice, or who approved or raised the job card (or awarded or requested the trip), cannot
  record its payment. The exception is the same as for checking invoices (ADR-077): an administrator when nobody else holds `invoice.pay`.
  In a company with one finance person, that person verifies and the administrator pays.
- Both functions (`record_invoice_payment`, `void_invoice_payment`) are the only way in, and every call is checked by `can()` in the service
  before it reaches the database (CLAUDE.md rule 3). The audit trigger records each change.
- No job card state changes (CLAUDE.md rule 4): paying does not move a job card, which closes after verification as before.

## Not decided here
Payment approval limits, bank file export, reconciliation against bank statements, and tax withholding on the payment. The owner has not asked for them.

## Consequences
The Invoices page "Paid" tab now has content. Vehicle cost already counted verified and paid invoices, so costs do not change.
