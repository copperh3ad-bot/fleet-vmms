# ADR-081: A daily cap on messages per phone number to the WhatsApp line

Status: accepted, 2026-11-09 (owner request: restrict the number of messages a user can send to WhatsApp in a day).

## Decision
- Each phone number may send a set number of messages a day to the Fleet OTG WhatsApp number. Counted in the signed webhook (ADR-042) before any processing, using the shared rate-limit table (ADR-006).
- Past the cap: nothing is processed (no menu step, no photo stored, no AI reading, no job card), the sender is told once that day, and later messages that day are ignored in silence.
- The cap is the owner's setting `wa_daily_messages` on Admin > Settings. Empty means 100. A value that is not a whole number from 1 to 100,000 falls back to 100. If the setting cannot be read, 100 applies.
- The day is the UTC day, which ends at 05:00 in Pakistan (the rate-limit buckets are UTC).
- It applies to every number, known employee or stranger, and counts every inbound message, including taps on menu lists and photos. Counting is per number, not per company.

## Why 100
A job card by the menu is about 8 to 10 messages plus up to three photos; a day with several requests still fits. The cap is a guard against loops, floods and cost, not a work limit. The owner changes it without a deploy.

## Consequences
- This is in addition to the per-address limit of 300 calls per 10 minutes already on the webhook.
- Messages Meta delivers twice count twice. Acceptable at this size.
