# ADR-089: Workshop scorecard, rating and quotation warnings

Status: accepted 2026-11-11 (owner decisions C2 to C4, docs/OWNER-DECISIONS-2026-11-11.md). Built, not deployed.

## Decision
- Beside every quotation on a job card, the page shows that workshop's record for the **last 12 months**: jobs done, average days (issue to completion),
  on time (completed within the days its quotation promised), bill versus quote (checked invoices as a percent of the approved amount), repeat repairs
  (a later job card for the same vehicle and the same reason within 30 days of the workshop finishing) and the Fleet Manager's average rating.
- The Fleet Manager (and the administrator) may **rate** a workshop 1 to 5 and **flag** it. A flag needs a written reason. The latest rating row decides
  whether the workshop shows as flagged. Permission `vendor.rate`, table `vendor_ratings` (tenant migration 0056), audited.
- **Warn, never block** (C3): approving a quotation more than `quote_over_estimate_pct` (company setting, default 10) above the job card's estimate, or one
  that takes the vehicle over its current budget, needs a written reason of at least 5 letters. The reason is kept in the job card event comment.

## Not in this decision
Asking 2 to 3 workshops for the same card (C1) is ADR-090. It changes the single-vendor job card state machine and the unauthenticated quotation link functions
(`quote_link_info`, `submit_quotation_via_link`). It is a separate step with its own ADR.

## Consequences
The demo seed passes an approval note, because its quotations are above their estimates.
Rework counted here is the simple 30-day rule; the repeat-work rule with a warranty window and who pays (owner item G) will replace it.
