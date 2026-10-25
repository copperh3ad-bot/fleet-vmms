# ADR-030: Workshops send estimates through a link on their phone

Status: accepted, 2026-10-25. Owner request: "vendors must be allowed to submit estimates through the link they will receive on their phone numbers, these estimates must be recorded against a job card number."

## Decision
1. **A single-use link, one per job card.** When a job card is waiting for a workshop's estimate (`vendor_assigned`), a person who may assign workshops or decide on quotations presses "Send the workshop a link for the estimate" on the card. The link is `/q/<token>`, a 32-byte random token. Only its SHA-256 is stored (`public.quotation_links`, with the control-plane route `link_routes.kind = 'quotation'`). It works once and lasts 7 days. Making a new link ends the old one. Unknown, used, expired and revoked links look the same.
2. **It goes to the workshop's own phone number and nowhere else** (same rule as ADR-026). The number comes from the vendor record and must be one a message can reach; if it is missing the card says so and points to Vendors. The screen offers "Send on WhatsApp" and "Send as a text message" with the number shown, and never prints or copies the link.
3. **The page shows only what the workshop needs**: the job card number, the plate and vehicle, what is wanted and the date it is needed by. It does not show who raised the card, any budget, the cost of earlier work, or other workshops' quotes (`quote_link_info`).
4. **The estimate is recorded against that job card.** Lines, days needed, warranty, validity and notes are saved as an ordinary quotation on the card (vendor and card from the link, never from what the page sends). The card moves to "quotation received" with the event "Estimate sent by the workshop through a link", and everyone who may decide on quotations gets the usual notice. The new Quotations page lists it. Approval still needs a person with `quotation.approve`.
5. **Narrow database access.** The route runs as database role `quotation_link`: no table access, EXECUTE on `quote_link_info` and `submit_quotation_via_link` only, both SECURITY DEFINER with a pinned search path. The submit function marks the link used and saves the estimate in one step, so a refused estimate never burns the link. Views and submissions are rate limited by address and by token, as for the odometer link.
6. **Rule 5 of CLAUDE.md** gains this endpoint: the single-use workshop estimate link under ADR-030.

## Not changed
- A workshop with a login still quotes through "My work".
- Invoices and work progress still need that login; the link carries an estimate only.

## Needs the owner
Run the migrations on the live database: platform `0011`, control `0013` and tenant `0022` (`npx tsx --env-file=.env.local scripts/migrate-tenants.mts`).
Server-side sending of the message (WhatsApp Business or SMS) is still the owner's choice, as in ADR-026.
