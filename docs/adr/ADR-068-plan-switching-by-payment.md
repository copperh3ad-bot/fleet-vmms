# ADR-068: Moving between Basic and Pro by paying (step 2 of ADR-035)

Status: **proposed, 2026-11-08; build only after the owner confirms the decisions below.** Owner direction: focus on Basic and Pro; "Go" on writing this ADR. Builds on ADR-035 (plans and bands), ADR-057 (price and 12-for-11), ADR-053 (NTN before invoice), ADR-065 (figures on `/pricing` only) and the billing code in `src/lib/billing/` (`settle`, `confirmClaim`, `setOrgPlan`, `submitClaim`). No price is set or written here (CLAUDE.md rule 7); the figures come from `plans` and `plan_bands`.

## The gap
Pro is priced (one band, no vehicle limit) and shown on `/pricing`, but a company cannot buy it. Today only the operator can move an organization to Pro by hand (`setOrgPlan`, from its page in Admin). `payment_claims.plan_key` exists (control 0015) but nothing writes or reads it. Billing never asks which plan a payment is for, and `confirmClaim` always settles at the price copied onto `org_billing`.

## How billing works now (what this must not break)
- `org_billing` holds the plan (`plan_key`), a price copy (`price_cents`, `currency`), the AI allowance (`ai_reads_per_day`), `status`, `current_period_end`.
- A customer files **one pending claim** (amount, currency, paid date, bank reference, months 1 to 12, receipt). The operator checks the bank and **confirms**; `settle` then extends the period from where it ended (or today), takes the tax for `price x billedMonths(months)`, writes the invoice and posts the ledger entry in one transaction.
- No invoice without the customer's NTN (ADR-053). A price change touches nobody already paying: the price copy is taken when they join or renew.

## Decision (recommended; owner decisions below)

### 1. The claim names the plan and quotes the price
- The Billing page offers the plan choice (Basic, or Pro when it is priced and the organization is eligible, see 5). The claim stores `plan_key`, the **quoted price** (`quoted_price_cents`, `quoted_currency`) and, for Pro, the **band's AI allowance** at the moment of the claim. The amount the customer transfers is therefore the amount we confirm against, even if the owner changes a price while the transfer is in flight.
- The band is decided by the organization's vehicle count at claim time (`vehicleCount`, as `setOrgPlan` does). With one band this is always the same price.
- The tax preview shown to the customer and the operator (`previewClaimTax`, `quoteTax`) uses the claim's quote, not `org_billing`.

### 2. Confirming a claim switches the plan
- `confirmClaim`, in the same transaction as the invoice and ledger entry: if the claim's plan differs from `org_billing.plan_key`, apply the switch (plan, price copy, currency, allowance), **then** settle at the claim's quoted price. One function does the switch for both this path and `setOrgPlan` so the two cannot disagree.
- Every switch writes a row in a new `plan_changes` table (organization, from, to, date, who, the claim and invoice it came with, or "operator"), with an audit trigger. The invoice records the plan it was for (`invoices.plan_key`) and says so in its line.
- A rejected claim changes nothing.

### 3. Upgrade (Basic to Pro): effective on confirmation, unused time credited as time
- Pro starts when the payment is confirmed. The new paid period runs from the confirmation date for the months paid.
- **Unused Basic time is credited as extra Pro time, not as money:** extra days = remaining Basic days x Basic price / Pro price, rounded down, added to the period end. This keeps the invoice at the full price (tax and ledger unchanged, no credit note, no refund), and nobody pays twice for the same days.
- A **trial** organization has no paid time: choosing Pro and paying simply starts Pro from the confirmation date. While on trial, Pro gives the small AI taste only (ADR-035 decision 5).

### 4. Downgrade (Pro to Basic): at the end of the paid period, no refunds
- The administrator asks to move to Basic; it is recorded on the organization (`pending_plan_key`) and takes effect when the paid period ends or at the next renewal confirmation, whichever comes first. The next claim is then at Basic's price. Nothing is refunded; Pro features work until the period ends.
- When Basic takes effect: the AI is switched off and **job cards by WhatsApp are switched off** (`wa_jobcards_enabled = false`), with an audit entry, so no Pro feature runs on a Basic plan. Existing job cards stay as they are.
- The operator can still move any organization at any time (`setOrgPlan`, unchanged in effect), for gifts and corrections.

### 5. Who is offered Pro
- ADR-035 offers Pro to organizations above a job-card threshold (`pro_offer_min_job_cards`, 20 a day). **OWNER:** keep that gate for self-service purchase, or let any Basic customer buy Pro. The operator may always move anyone. If the gate stays, the Billing page says why Pro is not offered and points to Contact us, instead of hiding it.

### 6. What the customer and the owner see
- **Billing, "Your plan":** current plan, price (a signed-in customer sees the figure; the public pages still do not, ADR-065), period end, a "Switch to Pro" or "Move to Basic at the end of the period" action, and the amount to pay for the months chosen (with the 12-for-11 discount and tax as today).
- **Admin, Payments:** each claim shows the plan it is for, the switch it will cause, the credited days and the tax preview; confirm remains one action.
- **Emails** (`payment-mails.ts`): the received and confirmed mails name the plan and the new period.

## Data (control plane, migration 0019; no tenant migration)
- `payment_claims`: `quoted_price_cents`, `quoted_currency`, `quoted_ai_reads_per_day` (plan_key exists).
- `invoices`: `plan_key`.
- `org_billing`: `pending_plan_key`.
- `plan_changes` with an audit trigger. Idempotent; `npx tsx scripts/embed-migrations.mts` after editing `db/`. **A live migration needs the owner's explicit yes.**

## Tests
A paid upgrade end to end (claim, confirm, plan, price, allowance, invoice, ledger balanced, period with the credit); a trial upgrade; a downgrade at period end that switches the AI and WhatsApp job cards off; a price change between claim and confirm (the quote wins); a rejected claim; an ineligible organization refused when the gate is on; tax and 12-for-11 with a plan switch; the operator move unchanged; tenant filters and audit coverage tests updated; browser scenario for the Billing page.

## Phases
1. Migration 0019 and the shared switch function; `submitClaim` writes the quote; `confirmClaim` switches and settles at the quote; tests.
2. Billing page: plan choice, amount, switch and downgrade actions; Admin payments display.
3. Downgrade at period end with the feature shut-off; emails; browser scenario.
4. Deploy with the owner's yes (migration, then app); live check with a test organization comped or on the owner's own company.

## Not in this ADR
Card payments (still bank transfer, ADR-014); usage-based billing; refunds or credit notes; mid-period proration in money; per-user pricing; more than two plans or more bands than the owner sets.

## Honest limits
- Credit-as-time is simple and keeps the ledger clean, but it is not a refund: a customer who downgrades early forfeits the rest of a Pro period.
- A claim is still checked by a person against the bank, so an upgrade is not instant at the moment of transfer. A trial customer waits for confirmation before Pro starts.
- Pro's price and band come from the owner's tables: if the owner later adds bands, a switch uses the band for the vehicle count at claim time.

## OWNER decisions
1. **Upgrade credit:** unused Basic time credited as extra Pro days (recommended), or no credit (Pro starts, new period, full price), or Pro starts at the next renewal.
2. **Downgrade timing:** at the end of the paid period, no refund (recommended), or immediately.
3. **Who may buy Pro themselves:** only organizations above the job-card threshold (as ADR-035), or any Basic customer.
4. **Trial:** may a trial organization pay for Pro directly (recommended), or must it pay for Basic first.
