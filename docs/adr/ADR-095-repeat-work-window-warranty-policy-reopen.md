# ADR-095: Repeat work, part 2: 30-day window, same workshop, warranty, policy on screen, reopening a rejected card

Status: built (tenant migration 0063). Owner decisions G1, G2, G3, G5 of 2026-11-11. Continues ADR-094.

## Decision

- **Window (G1):** the repeat window is 30 days. Migration 0063 moves a company that still has the old default of 60 to 30; a company that set its own number keeps it. New companies get 30. The demo company keeps 60 so its six-week repeat still shows.
- **Same workshop (G1):** on the review screen, choosing a workshop that already worked on the same vehicle within the window (outside routine service) makes the card a repeat. The form shows the "who pays, and why" fields as soon as such a workshop is picked (`ReviewContext.vendorRepeats`), and approval needs the answer, as in ADR-094.
- **Warranty (G2):** a workshop's repair carries a 7-day warranty (`WARRANTY_DAYS`). When the invoice page is for a card raised within 7 days after the same workshop finished work on the same vehicle, a note says so and asks the checker to consider redoing it free. It is a note, not a block.
- **Policy on screen (G3):** the job card and invoice pages show the company's policy rules that touch the card, read-only: the driver's share of repairs (the rule, whether it applies to this reason, and the amount: the invoice payable, else the approved quotation, else the estimate, times the percentage), who bears an accident repair (using the linked accident and the driver's history), and whether the vehicle is due for replacement. The rules and numbers are the company's own settings (`policy_*`), read from the policy the company entered; the test document was Union Fabrics' Vehicle Policy of 1 March 2026 (6-year replacement, first two accidents covered one year apart, 60/40 sharing of other repairs). Nothing here blocks a decision.
- **Reopen (G5):** the requester may send a rejected job card for approval again, with a reason of at least a few words. The guard allows `rejected -> submitted` (from 0054 plus that one step); transition_job_card already limits submitting to the card's requester. The reason is kept in the card's history.

## Not done

- The 60/40 rule as stated in the Union Fabrics document excludes consumables; the company setting excludes routine service, wear items and accident repairs, which is the closest existing category list.
- The warranty length is a constant, not a company setting.
