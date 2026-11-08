# ADR-068: Moving between Basic and Pro by paying (step 2 of ADR-035)

Status: **proposed, 2026-11-08; owner decisions recorded below; build on the owner's go.** Owner direction: focus on Basic and Pro; "Go" on writing this ADR. Owner answers (2026-11-08): only Basic users get a free 3-day Pro trial, then confirm Pro by payment, which **starts with the next renewal**; downgrade at the end of the paid period; **any Basic customer** may buy Pro; a company on its free trial may pay for Pro directly. Builds on ADR-035 (plans and bands), ADR-057 (price and 12-for-11), ADR-053 (NTN before invoice), ADR-065 (figures on `/pricing` only) and the billing code in `src/lib/billing/` (`settle`, `confirmClaim`, `setOrgPlan`, `submitClaim`). No price is set or written here (CLAUDE.md rule 7); the figures come from `plans` and `plan_bands`.

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

### 3. Upgrade (Basic to Pro): a free 3-day Pro trial, then Pro from the next renewal
- **Pro trial, for Basic customers only.** A Basic organization (trial or paying) may start a free 3-day Pro trial from Billing, **once per organization** (assumption, see below). While it runs, Pro features work (AI reading and job cards by WhatsApp) with the existing trial limit on AI readings (`limits.ai_trial_reads`, a small taste, the owner's to raise in the plan). The plan stays Basic; the organization carries `pro_trial_ends_at`. When it ends, Pro features switch off and Basic continues; the Billing page then offers "Switch to Pro".
- **Confirming Pro by payment starts Pro at the next renewal.** The customer files a claim for Pro (any time, ideally at renewal); the quoted Pro price and months are stored on the claim. On confirmation the paid period extends from where the current one ends (`settle` already does this), the invoice is at the Pro price, and the plan switches to Pro **when the current paid period ends** (`pending_plan_key = pro`, `pending_plan_from = the old period end`). No credit, no proration, no refund: the Basic time already paid stays Basic.
- **A company still on its free trial that pays for Pro directly** has no paid period, so its `pending_plan_from` is the confirmation date and Pro starts at once. Until then the trial gives Basic features plus the Pro trial option above.

### 4. Downgrade (Pro to Basic): at the end of the paid period, no refunds
- The administrator asks to move to Basic: `pending_plan_key = standard`, `pending_plan_from = the current period end`. The next claim is at Basic's price. Nothing is refunded; Pro works until the period ends.
- When Basic takes effect: the AI is switched off and **job cards by WhatsApp are switched off** (`wa_jobcards_enabled = false`), audited, so no Pro feature runs on Basic. Existing job cards stay.
- The operator can still move any organization at any time (`setOrgPlan`, unchanged in effect), for gifts and corrections.

### 5. Who may buy Pro
Any Basic customer (owner decision). The job-card threshold `pro_offer_min_job_cards` (ADR-035) no longer gates purchase; it may remain as a hint on the Billing page ("busy fleets benefit most") or be retired. The operator may always move anyone.

### 5a. One place decides the plan in force
Every feature check (AI reading, WhatsApp job cards, Pro rows) goes through one function, `activePlan(org)`: if `pending_plan_from` has passed it applies the pending switch (plan, price copy, allowance, `plan_changes` row) and returns the new plan; during a Pro trial it returns Basic with the Pro features and trial limits. A daily job (the existing 03:00 UTC scheduled function) also applies due switches, so a switch happens even if nobody opens the app. A customer never has to be switched by hand.

### 6. What the customer and the owner see
- **Billing, "Your plan":** current plan, period end, the pending switch and its date, a "Try Pro free for 3 days" button (Basic only, once), a "Switch to Pro" or "Move to Basic at the end of the period" action, and the amount to pay for the months chosen (12-for-11 and tax as today). A signed-in customer sees the figures; the public pages still do not (ADR-065).
- **Admin, Payments:** each claim shows the plan it is for, the date the switch takes effect and the tax preview; confirm remains one action.
- **Emails** (`payment-mails.ts`): the received and confirmed mails name the plan and when it starts.

## Data (control plane, migration 0019; no tenant migration)
- `payment_claims`: `quoted_price_cents`, `quoted_currency`, `quoted_ai_reads_per_day` (plan_key exists).
- `invoices`: `plan_key`.
- `org_billing`: `pending_plan_key`, `pending_plan_from`, `pro_trial_ends_at` (null until the trial is taken; once set it is never cleared, which is how "once" is enforced).
- `plan_changes` with an audit trigger. Idempotent; `npx tsx scripts/embed-migrations.mts` after editing `db/`. **A live migration needs the owner's explicit yes.**

## Tests
A Pro claim confirmed mid-period (invoice at the Pro price, period extended, plan still Basic until the old period end, then Pro with price and allowance); a trial company paying for Pro (Pro at once); the 3-day Pro trial (features on, trial limit, off after 3 days, refused a second time, refused for a Pro customer); a downgrade at period end that switches the AI and WhatsApp job cards off; `activePlan` applying a due switch on read and by the daily job; a price change between claim and confirm (the quote wins); a rejected claim; tax and 12-for-11 with a plan switch; the operator move unchanged; tenant filters and audit coverage tests updated; browser scenario for the Billing page.

## Phases
1. Migration 0019 and the shared switch function; `submitClaim` writes the quote; `confirmClaim` switches and settles at the quote; tests.
2. Billing page: plan choice, amount, switch and downgrade actions; Admin payments display.
3. Downgrade at period end with the feature shut-off; emails; browser scenario.
4. Deploy with the owner's yes (migration, then app); live check with a test organization comped or on the owner's own company.

## Not in this ADR
Card payments (still bank transfer, ADR-014); usage-based billing; refunds or credit notes; mid-period proration in money; per-user pricing; more than two plans or more bands than the owner sets.

## Honest limits
- No proration: a customer who moves to Pro at renewal pays Pro only from then, and one who downgrades keeps Pro to the period's end but is not refunded. The ledger stays simple (one invoice per payment, always at one price).
- A claim is still checked by a person against the bank, so Pro is not instant at the moment of transfer. A trial company waits for confirmation before Pro starts.
- Pro's price and band come from the owner's tables: if the owner later adds bands, a switch uses the band for the vehicle count at claim time.

## Decided by the owner (2026-11-08)
1. Pro starts with the next renewal after payment; no credit or proration. Basic customers get a free 3-day Pro trial first.
2. Downgrade at the end of the paid period, no refund.
3. Any Basic customer may buy Pro.
4. A company on its free trial may pay for Pro directly.

## Assumptions to confirm before the build
- The Pro trial is **once per organization**, and a Pro customer or a Pro-trial-in-progress cannot start another.
- During the Pro trial the AI uses the plan's existing small trial allowance (`ai_trial_reads`, 10 in all). WhatsApp job card drafts count as AI readings, so 10 drafts or documents in total. Raise the limit in the plan if a fuller taste is wanted.
- A new sign-up's own 3-day trial stays Basic; the Pro trial is a separate button, not automatic.
