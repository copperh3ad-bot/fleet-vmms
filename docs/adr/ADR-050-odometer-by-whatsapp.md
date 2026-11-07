# ADR-050: The monthly odometer request on WhatsApp, answered by a reply

Status: accepted, 2026-11-07. Owner request: "the app sends WhatsApps every month and the driver replies with the odometer reading"; vehicles with an hour meter are excluded. Builds on ADR-006 (odometer link), ADR-042 (WhatsApp replies), ADR-049 (the app sends WhatsApp itself).

## Decision
1. **Off by default.** Setting `odometer_whatsapp` (0 or 1) and `odometer_send_day` (1 to 28, default 1), in Settings. Needs `WHATSAPP_ODOMETER_TEMPLATE` in Netlify (the approved template `fleetotg_odometer`); without it nothing is sent and the manual links work as before.
2. **Sending.** A daily scheduled function (`netlify/functions/odometer-whatsapp.mts`, 04:00 UTC) opens the month's odometer cycle on the send day if nobody has, and sends each holder one message from the Fleet OTG number: the holder's name, the plate and the month, asking them to **reply** with the reading. One reminder follows after 3 days to anyone still pending. Holders with no phone number, vehicles with no holder, and **vehicles that track engine hours** are left out; they keep the link flow. A failed send is counted and tried again the next day; it logs no number.
3. **Matching a reply.** WhatsApp's Reply sends us the id of the message answered. Each message sent is stored as a hash of `wa:<id>` in `odometer_wa_messages` and routed in the control plane (`link_routes`, kind `odoreply`, migration control 0016), the way workshop replies are. A message that is not a reply, or answers something else, goes on to the workshop handler. A plain number sent without Reply is never guessed at: the same number can work for several companies.
4. **Filing.** The webhook role runs one function, `file_odometer_reply(hash, from, reading)` (migration 0032, security definer, pinned search path). It checks that the **sender's number is the holder's** (last ten digits), that the cycle is open and the submission still waiting, and that the number is in range, then saves a **submission** exactly as the link does. It approves nothing and moves no odometer; the reviewer approves, with the usual note rule for a lower or too-fast reading. A reply from another number, or to an unknown message, is not answered at all, so a stranger learns nothing.
5. **Reading the reply.** Only a number counts: digits with commas or spaces, one decimal, optional "km". Words, photos and anything else get a short "reply with the odometer as a number only" and save nothing. A second reply gets "we already have a reading". The driver is thanked with the number we read.
6. **The cycle screen** shows "Asked on WhatsApp <date>" for a vehicle that was asked; the manual links and the "enter on their behalf" form are unchanged.

## Costs and limits
One template message per vehicle per month plus a reminder, likely billed as Marketing like the invitation. WhatsApp may hold some back for people it caps. The driver's reply is free to send; our thank-you only arrives within 24 hours of their reply, which it always is. Hour-meter vehicles are not covered; their hours come through the link, the vehicle page or a job card.

## Owner steps
Meta must approve `fleetotg_odometer` (not yet created); set `WHATSAPP_ODOMETER_TEMPLATE` in Netlify; run tenant migration 0032 and control migration 0016 on live; switch the setting on for a company; test with one real holder.

## Tests
`tests/odometer-whatsapp.test.ts`: off and not-yet-day, who is asked and who is left out, asking once, one reminder, a failed send, the reply filed for review with no odometer moved, a second reply, a stranger's number, non-numbers, non-replies, approval, and number parsing. Gate passes (ADR-045 5b) move to migration 0033.
