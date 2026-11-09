# ADR-081: Daily caps on messages per phone number to the WhatsApp line

Status: accepted, 2026-11-09 (owner requests: restrict the number of messages a user can send to WhatsApp in a day; then: only users registered in the Logistics department may send 100 a day in an organisation, everyone else 10).

## Decision
- Each phone number may send a set number of messages a day to the Fleet OTG WhatsApp number. Counted in the signed webhook (ADR-042) before any processing, using the shared rate-limit table (ADR-006).
- **Two caps.** A number registered in a company's **Logistics department** may send **100** a day; **every other number may send 10**, whatever its role, and so may a number nobody has registered.
- "Registered in the Logistics department" means: in an active company, an active employee with a login has this number (last ten digits compared, as in ADR-079), the login's membership is active, and its role is tied to the Logistics department in `role_departments` (ADR-048: today the `logistics` role). Department names compare after trimming and ignoring case. If the number is registered in several companies, the Logistics registration in any one of them gives the higher cap.
- Past the cap: nothing is processed (no menu step, no photo stored, no AI reading, no job card), the sender is told once that day, and later messages that day are ignored in silence.
- Both caps are the owner's settings on Admin > Settings: `wa_daily_messages` (Logistics department, empty means 100) and `wa_daily_messages_other` (everyone else, empty means 10). A value that is not a whole number from 1 to 100,000 falls back to the default. If a setting cannot be read, or the sender cannot be looked up, the default or the lower cap applies.
- The day is the UTC day, which ends at 05:00 in Pakistan (the rate-limit buckets are UTC). Every inbound message counts, including taps on menu lists and photos. Counting is per number, not per company.

## Why
A job card by the menu is about 8 to 10 messages plus up to three photos. Ten a day is enough for a quick odometer reading or a trip request, but a full questionnaire may need the owner to raise the lower cap; the Logistics department raises many requests and runs the day-to-day, so it gets room. The cap guards against loops, floods and cost; the owner changes either figure without a deploy.

## Consequences
- In addition to the per-address limit of 300 calls per 10 minutes already on the webhook.
- Each message costs a sender lookup (the same kind the menu does). Fine at this size; cache by number if the number of companies grows.
- Messages Meta delivers twice count twice. Acceptable at this size.
- **Watch:** with 10 a day for everyone else, one job card questionnaire (about 8 to 10 messages) can use up an ordinary employee's whole day. The owner should confirm 10 is intended, or raise `wa_daily_messages_other`.
