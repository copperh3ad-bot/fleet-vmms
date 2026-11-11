# ADR-090: Asking two or three workshops for an estimate on one job card

Status: accepted 2026-11-11 (owner decision C1, docs/OWNER-DECISIONS-2026-11-11.md). Built, not deployed. Tenant migration 0057.

## Decision
- A person who may assign workshops can ask up to **three workshops in all** (the one assigned plus two more) for an estimate on the same job card, while the
  card is `vendor_assigned` or `quotation_received`.
- `job_cards.vendor_id` stays "the workshop on the card": the first one asked, and after approval **the winner**. Extra workshops are rows in
  `job_card_invitees`. Because the winner is written to `vendor_id`, work orders, invoice links, WhatsApp notices, reports and the vendor views downstream
  needed no change.
- Each asked workshop gets **its own single-use link** (ADR-030). Making a new link for one workshop revokes only that workshop's earlier unused link.
  A workshop sends one estimate at a time; after a decline it may send another.
- The card moves to `quotation_received` on the **first** estimate. Later ones just join it, so the history shows one such event.
- **Approving** one estimate declines every other waiting estimate (their workshops get a notice), sets the card's workshop to the winner and issues the work
  order. **Declining** one estimate keeps the card open while another estimate is waiting (the history records the decline); when none is left the card goes
  back to `vendor_assigned`, as before.
- The side-by-side view is the existing quotation list on the card, now with the workshop scorecard beside each quote (ADR-089).

## Security
The unauthenticated link functions keep their shape and their `quotation_link` role. Only the test "is this workshop the one on the card" became
`workshop_invited(job, vendor)` (the card's workshop or an invitee), and a workshop with an estimate already waiting gets no second page. The page still shows
nothing about other workshops, prices or budgets. New functions are revoked from public (0037 rule) and the changed view is `security_invoker`.

## Changed in the database (0057)
Table `job_card_invitees`; functions `workshop_invited`, `workshop_has_waiting_estimate`, `invite_workshop`, `uninvite_workshop`; redefined
`submit_quotation`, `approve_quotation`, `reject_quotation`, `quote_link_info`, `submit_quotation_via_link`, `inbound_target`, `file_workshop_email` and the view
`v_vendor_job_requests`.

## Not done
Sending one message to all asked workshops at once (each is asked with its own button); a minimum number of estimates before approval; an automatic
suggestion of which workshops to ask. A job card whose workshop is changed by assigning again does not clear its extra workshops.
