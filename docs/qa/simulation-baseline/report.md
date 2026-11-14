# 60-day simulation: 2026-11-14

Days: 60 (+14 settling days). Seed 20261114. Wall time 4 min.

## What was done

| Item | Count |
|---|---|
| accidents.added | 80 |
| accidents.linked_to_jobcard | 30 |
| ai.estimates_read_and_saved | 156 |
| ai.estimates_unreadable | 14 |
| ai.trip_advice | 264 |
| cargo.delivered | 1779 |
| cargo.quote_requests | 12445 |
| cargo.quotes.received | 11228 |
| cargo.rejected | 21 |
| cargo.requested | 1800 |
| cargo.requested_by_whatsapp | 480 |
| challans.added | 136 |
| challans.disputed | 32 |
| challans.paid | 98 |
| email.estimates_received | 170 |
| jobcards.closed | 1168 |
| jobcards.raised | 1200 |
| jobcards.raised_by_ai_message | 180 |
| jobcards.raised_by_whatsapp | 240 |
| jobcards.rejected | 32 |
| jobcards.repeat_flagged | 971 |
| odometer.approved_one_by_one | 70 |
| odometer.by_whatsapp | 480 |
| odometer.cycles | 2 |
| odometer.flagged_reviewed | 38 |
| odometer.readings_lower | 4 |
| odometer.readings_normal | 102 |
| odometer.readings_too_fast | 2 |
| odometer.whatsapp_requests_sent | 100 |
| papers.added | 168 |
| papers.renewed | 92 |
| reminders.emails | 289 |
| reminders.notices | 274 |
| trips.awarded | 1779 |
| trips.invoices | 1852 |
| trips.invoices.paid_above_award | 91 |
| trips.invoices.returned | 73 |
| trips.invoices.verified | 1779 |
| trips.paid | 1779 |
| trips.planned | 1779 |
| trips.reserved_by_whatsapp | 180 |
| vreq.decided | 40 |
| vreq.requested | 41 |
| whatsapp.messages_written | 100 |
| whatsapp.workshop_notice_sent | 2336 |
| workshop.invoices | 1168 |
| workshop.invoices.verified | 1168 |
| workshop.quotes | 3127 |
| workshop.quotes.approved | 1168 |

Per day, averages: 20.0 job cards, 52.1 workshop estimates, 29.6 cargo trips planned, 207.4 provider quotes asked for, 187.1 received.

## Money

Workshops: invoiced 45,687,038, paid 45,217,249 (database says 45,217,249).
Providers: invoiced 116,246,418, paid 111,509,592 (database says 111,509,592).

## Where everything ended

| State | Rows |
|---|---|
| cargo delivered | 1779 |
| cargo rejected | 21 |
| jobcards closed | 1168 |
| jobcards rejected | 32 |
| quotations approved | 1168 |
| quotations rejected | 1959 |
| trip_quotes awarded | 1779 |
| trip_quotes closed | 9449 |
| trip_quotes declined | 1217 |
| trips completed | 1779 |
| trips requested | 180 |

## Mail and WhatsApp written to files (nothing was sent)

Emails: 289 (Fleet OTG reminders for Simulated Logistics Co: n ). To 51 different addresses.
WhatsApp template messages: 2436 (est_ok, inv_ok, ?).

## Reconciliation of the database

| Check | Result |
|---|---|
| a paid workshop invoice is paid in full | ok |
| no workshop invoice is paid beyond what is due | ok |
| nobody checked and paid the same workshop invoice | ok |
| nobody awarded a trip they asked for | ok |
| every awarded trip has one awarded quote at the award amount | ok |
| the award amount equals the awarded quote | ok |
| a paid trip invoice is paid in full | ok |
| a delivered load belongs to a completed trip | ok |
| every closed job card has an invoice that was verified | ok |
| every job card event chain starts at draft | ok |
| no reminder was sent before its time (days before expiry) | ok |
| a paper that has expired (and not been renewed) was reminded about on its day | ok |
| every vehicle that was serviced has a service reminder claim or none was due | ok |
| weight and volume saved exactly as requested | ok |
| money paid to workshops: the database equals what the simulation paid | ok |
| money paid to providers: the database equals what the simulation paid | ok |

## Malfunctions (anything the rules did not expect)

| What | Times | First seen on day | Ref |
|---|---|---|---|
| odometer.approve_normal (UserError): This reading looks wrong (implausible jump). Write a note of at least 5 characters to accept it. | 2 | 31 | 2026-10 |

## Correct refusals (people told no, as designed)

| What | Times |
|---|---|
| audit.try_create_jobcard | 60 |
| audit.try_accept_cargo | 60 |
| audit.try_pay | 60 |
| audit.try_vendor | 60 |
| requester tries to award | 60 |
| jobcard.approve_assign: This repeats XX-n. Say who pays, and why. | 971 |

## Speed (milliseconds per operation, through the service layer on a local database)

| Operation | Calls | p50 | p95 | max |
|---|---|---|---|---|
| read.overview | 1 | 66 | 66 | 66 |
| ai.trip_quote_advice | 264 | 14 | 57 | 80 |
| odometer.whatsapp_requests | 2 | 36 | 36 | 36 |
| whatsapp.jobcard_chat | 240 | 12 | 22 | 25 |
| read.dashboard | 1 | 20 | 20 | 20 |
| whatsapp.cargo_chat | 480 | 16 | 19 | 161 |
| export.job-cards | 1 | 19 | 19 | 19 |
| odometer.approve_normal | 2 | 18 | 18 | 18 |
| whatsapp.trip_chat | 180 | 12 | 15 | 16 |
| read.quotations_all | 1 | 15 | 15 | 15 |
| export.outsourced-trips | 1 | 15 | 15 | 15 |
| export.cargo | 1 | 14 | 14 | 14 |
| audit.read_jobcards | 60 | 7 | 13 | 14 |
| odometer.create_links | 2 | 13 | 13 | 13 |
| read.jobcards_all | 1 | 13 | 13 | 13 |
| read.jobcards_requester | 1 | 13 | 13 | 13 |
| read.outsourced_report | 1 | 11 | 11 | 11 |
| export.invoices | 1 | 9 | 9 | 9 |
| whatsapp.odometer_chat | 480 | 6 | 7 | 12 |
| reminders.run | 74 | 3 | 7 | 16 |
| read.cargo_all | 1 | 7 | 7 | 7 |
| export.flags | 1 | 7 | 7 | 7 |
| ai.save_estimate | 156 | 3 | 5 | 12 |
| jobflow.read | 1168 | 3 | 5 | 6 |
| export.repeat-repairs | 1 | 5 | 5 | 5 |
| read.trips_all | 1 | 4 | 4 | 4 |
| export.cost-per-km | 1 | 4 | 4 | 4 |
| ai.whatsapp_jobcard_confirm | 180 | 2 | 3 | 5 |
| read.dashboard_requester | 1 | 3 | 3 | 3 |
| export.vehicles | 1 | 3 | 3 | 3 |
| export.costs-by-vehicle | 1 | 3 | 3 | 3 |
| export.workshop-time | 1 | 3 | 3 | 3 |
| jobcard.create | 780 | 1 | 2 | 5 |
| ai.whatsapp_jobcard_draft | 180 | 1 | 2 | 4 |
| jobcard.approve_assign | 1168 | 1 | 2 | 5 |
| email.reply_link | 170 | 1 | 2 | 4 |
| email.inbound_estimate | 170 | 1 | 2 | 3 |
| ai.read_estimate | 170 | 1 | 2 | 6 |
| cargo.make_trip | 1779 | 1 | 2 | 9 |
| trip.ask_quotes | 1779 | 1 | 2 | 9 |
| audit.read_invoices | 60 | 1 | 2 | 2 |
| audit.read_trips | 60 | 1 | 2 | 2 |
| quote.decide | 1168 | 1 | 2 | 11 |
| jobcard.approve_assign_repeat | 971 | 2 | 2 | 5 |
| invoice.submit_by_link | 1168 | 1 | 2 | 25 |
| email.type_estimate_by_hand | 14 | 2 | 2 | 2 |
| odometer.read_cycle | 2 | 2 | 2 | 2 |
| read.invoices_all | 1 | 2 | 2 | 2 |
| cargo.create | 1320 | 1 | 1 | 4 |
| paper.list | 74 | 1 | 1 | 2 |
| jobcard.reject | 32 | 0 | 1 | 1 |
| jobcard.invite_workshop | 2053 | 0 | 1 | 5 |
| quote.link | 3051 | 1 | 1 | 5 |
| quote.submit_by_link | 2957 | 1 | 1 | 5 |
| cargo.suggest | 1779 | 1 | 1 | 2 |
| cargo.accept | 1779 | 0 | 1 | 4 |
| trip.quote_link | 11228 | 0 | 1 | 17 |
| trip.quote_submit_by_link | 11228 | 1 | 1 | 7 |
| accident.add | 80 | 0 | 1 | 3 |
| challan.add | 136 | 0 | 1 | 2 |
| trip.award | 1779 | 1 | 1 | 19 |
| trip.start | 1779 | 0 | 1 | 3 |
| cargo.in_transit | 1779 | 0 | 1 | 3 |
| vreq.request | 41 | 1 | 1 | 1 |
| accident.link_jobcard | 30 | 0 | 1 | 1 |
| invoice.link | 1168 | 1 | 1 | 5 |
| trip.complete | 1779 | 0 | 1 | 4 |
| cargo.delivered | 1779 | 0 | 1 | 4 |
| vreq.reject | 40 | 1 | 1 | 1 |
| invoice.verify | 1168 | 1 | 1 | 5 |
| trip.invoice_link | 1852 | 0 | 1 | 15 |
| trip.invoice_submit_by_link | 1852 | 1 | 1 | 3 |
| challan.set_status | 130 | 0 | 1 | 1 |
| payment.read | 1168 | 0 | 1 | 10 |
| payment.record | 1526 | 0 | 1 | 5 |
| jobcard.close | 1168 | 0 | 1 | 6 |
| trip.invoice_return | 73 | 0 | 1 | 1 |
| trip.invoice_verify | 1688 | 0 | 1 | 2 |
| trip.payment_read | 1779 | 0 | 1 | 2 |
| trip.invoice_verify_billed | 91 | 0 | 1 | 1 |
| trip.payment_approve | 30 | 0 | 1 | 1 |
| odometer.submit_by_link | 108 | 0 | 1 | 4 |
| export.documents | 1 | 1 | 1 | 1 |
| export.accidents | 1 | 1 | 1 | 1 |
| export.challans | 1 | 1 | 1 | 1 |
| export.budgets | 1 | 1 | 1 | 1 |
| export.cost-per-hour | 1 | 1 | 1 | 1 |
| export.vehicle-requests | 1 | 1 | 1 | 1 |
| paper.add | 168 | 0 | 0 | 6 |
| paper.renew | 92 | 0 | 0 | 2 |
| trip.quote_decline | 1217 | 0 | 0 | 2 |
| cargo.reject | 21 | 0 | 0 | 1 |
| trip.payment_record | 1779 | 0 | 0 | 2 |
| payment.approve | 5 | 0 | 0 | 0 |
| odometer.approve_one_by_one | 70 | 0 | 0 | 0 |
| odometer.review_flagged | 38 | 0 | 0 | 1 |
| odometer.close_cycle | 2 | 0 | 0 | 0 |

## Screens and exports at day-60 size (milliseconds, one call each)

| Screen or export | ms |
|---|---|
| read.dashboard | 20 |
| read.overview | 66 |
| read.dashboard_requester | 3 |
| read.jobcards_all | 13 |
| read.quotations_all | 15 |
| read.invoices_all | 2 |
| read.cargo_all | 7 |
| read.trips_all | 4 |
| read.outsourced_report | 11 |
| read.jobcards_requester | 13 |
| export.vehicles | 3 |
| export.job-cards | 19 |
| export.invoices | 9 |
| export.documents | 1 |
| export.accidents | 1 |
| export.challans | 1 |
| export.budgets | 1 |
| export.costs-by-vehicle | 3 |
| export.repeat-repairs | 5 |
| export.cost-per-km | 4 |
| export.cost-per-hour | 1 |
| export.workshop-time | 3 |
| export.outsourced-trips | 15 |
| export.cargo | 14 |
| export.vehicle-requests | 1 |
| export.flags | 7 |

Export sizes: vehicles: 56 rows, 4 KB; job-cards: 1200 rows, 181 KB; invoices: 1168 rows, 119 KB; documents: 168 rows, 11 KB; accidents: 80 rows, 10 KB; challans: 136 rows, 10 KB; budgets: 0 rows, 0 KB; costs-by-vehicle: 56 rows, 3 KB; repeat-repairs: 714 rows, 42 KB; cost-per-km: 51 rows, 2 KB; cost-per-hour: 0 rows, 0 KB; workshop-time: 0 rows, 0 KB; outsourced-trips: 1779 rows, 258 KB; cargo: 1800 rows, 370 KB; vehicle-requests: 41 rows, 5 KB; flags: 128 rows, 12 KB

Day length: first 10 days 1.0 s on average, last 10 days 1.9 s on average (1.90x as the data grew).