# ADR-094: Repeat work: the approver says who pays, and why, on each repeat card

Status: built (tenant migration 0062). Owner decisions G1 and G2 of 2026-11-11, with the owner's answer that **the reason given on the card justifies which party pays**.

## Context

The owner asked whether a repeat repair is paid by the company, the workshop (under its guarantee) or the driver. A fixed rule per cause was proposed. The owner chose instead that the **written reasoning on each repeat card** decides, case by case.

## Decision

- A job card is a **repeat** when, on the same vehicle and outside routine service, an earlier card (not draft, cancelled or rejected) falls within the repeat window (setting `flag_repeat_days`) and has the same reason or the same type of service on one of its lines. A card whose own reason is "previous repair not effective" repeats the latest earlier card whatever the window. One function, `findRepeat`, serves the review screen and the approval.
- **Approving a repeat card on the review screen needs two answers:** who pays (the company, the workshop under its guarantee, or the driver) and a written reason of at least a few words. Without them the approval is refused and nothing changes. The answer is kept on the card (`repeat_payer`, `repeat_payer_reason`) with the earlier card it repeats (`repeat_of`); it is audited like the rest of the card.
- The answer is **shown, not enforced**: on the job card, and above the decision on the invoice page ("This job repeats JC-…, the approver said the workshop pays, reason …"). The invoice checker still sets what is payable. When the answer is "the workshop", the invoice page reminds the checker to consider a lower amount.
- Enforcement is on the review screen path (`approveAndAssign`). The generic status change records an answer if one is given but does not require it, so data loads and tests that approve many cards on one vehicle are unaffected.

## Not decided here, still to build

- **Window.** The owner's window is 30 days; the setting `flag_repeat_days` still defaults to 60 in existing companies. Changing a company's number is the company's choice, so it was not changed.
- Same workshop as the earlier card (the workshop is not known until after approval) and the 7-day warranty period.
- Policy rules from the Vehicle Policy shown read-only on the approval and invoice screens (G3).
- A requester reopening a rejected card with a reason (G5).
