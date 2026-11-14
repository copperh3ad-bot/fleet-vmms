# 60-day simulation: 2026-11-14

Days: 60 (+14 settling days). Seed 20261114. Wall time 4 min.

## What was done

| Item | Count |
|---|---|
| accidents.added | 80 |
| accidents.linked_to_jobcard | 30 |
| ai.estimates_read_and_saved | 153 |
| ai.estimates_unreadable | 11 |
| ai.trip_advice | 268 |
| cargo.delivered | 1779 |
| cargo.quote_requests | 12473 |
| cargo.quotes.received | 11204 |
| cargo.rejected | 21 |
| cargo.requested | 1800 |
| cargo.requested_by_whatsapp | 480 |
| challans.added | 144 |
| challans.disputed | 27 |
| challans.paid | 100 |
| email.estimates_received | 164 |
| jobcards.closed | 1165 |
| jobcards.raised | 1200 |
| jobcards.raised_by_ai_message | 180 |
| jobcards.raised_by_whatsapp | 240 |
| jobcards.rejected | 35 |
| jobcards.repeat_flagged | 964 |
| odometer.by_whatsapp | 480 |
| odometer.cycles | 2 |
| odometer.flagged_reviewed | 59 |
| odometer.readings_lower | 3 |
| odometer.readings_normal | 102 |
| odometer.readings_too_fast | 4 |
| odometer.whatsapp_requests_sent | 100 |
| papers.added | 168 |
| papers.renewed | 93 |
| reminders.emails | 289 |
| reminders.notices | 274 |
| trips.awarded | 1779 |
| trips.invoices | 1857 |
| trips.invoices.paid_above_award | 91 |
| trips.invoices.returned | 78 |
| trips.invoices.verified | 1779 |
| trips.paid | 1779 |
| trips.planned | 1779 |
| trips.reserved_by_whatsapp | 180 |
| vreq.decided | 42 |
| vreq.requested | 43 |
| whatsapp.messages_written | 100 |
| whatsapp.workshop_notice_sent | 2330 |
| workshop.invoices | 1165 |
| workshop.invoices.verified | 1165 |
| workshop.quotes | 3107 |
| workshop.quotes.approved | 1165 |

Per day, averages: 20.0 job cards, 51.8 workshop estimates, 29.6 cargo trips planned, 207.9 provider quotes asked for, 186.7 received.

## Money

Workshops: invoiced 45,546,834, paid 45,080,234 (database says 45,080,234).
Providers: invoiced 117,706,798, paid 112,443,346 (database says 112,443,346).

## Where everything ended

| State | Rows |
|---|---|
| cargo delivered | 1779 |
| cargo rejected | 21 |
| jobcards closed | 1165 |
| jobcards rejected | 35 |
| quotations approved | 1165 |
| quotations rejected | 1942 |
| trip_quotes awarded | 1779 |
| trip_quotes closed | 9425 |
| trip_quotes declined | 1269 |
| trips completed | 1779 |
| trips requested | 180 |

## Mail and WhatsApp written to files (nothing was sent)

Emails: 289 (Fleet OTG reminders for Simulated Logistics Co: n ). To 51 different addresses.
WhatsApp template messages: 2430 (est_ok, inv_ok, ?).

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

None.

## Correct refusals (people told no, as designed)

| What | Times |
|---|---|
| audit.try_create_jobcard | 60 |
| audit.try_accept_cargo | 60 |
| audit.try_pay | 60 |
| audit.try_vendor | 60 |
| requester tries to award | 60 |
| jobcard.approve_assign: This repeats XX-n. Say who pays, and why. | 964 |

## Speed (milliseconds per operation, through the service layer on a local database)

| Operation | Calls | p50 | p95 | max |
|---|---|---|---|---|
| odometer.whatsapp_requests | 2 | 95 | 95 | 95 |
| read.overview | 1 | 64 | 64 | 64 |
| odometer.create_links | 2 | 38 | 38 | 38 |
| ai.trip_quote_advice | 268 | 13 | 33 | 73 |
| whatsapp.jobcard_chat | 240 | 14 | 27 | 44 |
| whatsapp.cargo_chat | 480 | 18 | 23 | 45 |
| read.dashboard | 1 | 22 | 22 | 22 |
| export.job-cards | 1 | 21 | 21 | 21 |
| read.quotations_all | 1 | 18 | 18 | 18 |
| read.outsourced_report | 1 | 18 | 18 | 18 |
| whatsapp.trip_chat | 180 | 13 | 17 | 34 |
| export.outsourced-trips | 1 | 17 | 17 | 17 |
| audit.read_jobcards | 60 | 8 | 14 | 15 |
| read.jobcards_all | 1 | 14 | 14 | 14 |
| read.jobcards_requester | 1 | 14 | 14 | 14 |
| export.cargo | 1 | 13 | 13 | 13 |
| export.invoices | 1 | 12 | 12 | 12 |
| whatsapp.odometer_chat | 480 | 7 | 10 | 20 |
| odometer.approve_normal | 2 | 10 | 10 | 10 |
| export.flags | 1 | 10 | 10 | 10 |
| jobflow.read | 1165 | 3 | 9 | 11 |
| reminders.run | 74 | 3 | 8 | 15 |
| ai.save_estimate | 153 | 3 | 6 | 8 |
| email.type_estimate_by_hand | 11 | 2 | 6 | 6 |
| export.repeat-repairs | 1 | 5 | 5 | 5 |
| export.cost-per-km | 1 | 5 | 5 | 5 |
| read.dashboard_requester | 1 | 4 | 4 | 4 |
| ai.whatsapp_jobcard_draft | 180 | 2 | 3 | 9 |
| ai.whatsapp_jobcard_confirm | 180 | 2 | 3 | 7 |
| email.reply_link | 164 | 1 | 3 | 3 |
| email.inbound_estimate | 164 | 2 | 3 | 3 |
| audit.read_trips | 60 | 2 | 3 | 3 |
| jobcard.approve_assign_repeat | 964 | 2 | 3 | 4 |
| odometer.read_cycle | 2 | 3 | 3 | 3 |
| read.trips_all | 1 | 3 | 3 | 3 |
| export.vehicles | 1 | 3 | 3 | 3 |
| export.costs-by-vehicle | 1 | 3 | 3 | 3 |
| export.workshop-time | 1 | 3 | 3 | 3 |
| export.vehicle-requests | 1 | 3 | 3 | 3 |
| jobcard.create | 780 | 1 | 2 | 7 |
| paper.list | 74 | 1 | 2 | 3 |
| jobcard.approve_assign | 1165 | 1 | 2 | 10 |
| quote.link | 3031 | 1 | 2 | 6 |
| quote.submit_by_link | 2943 | 1 | 2 | 17 |
| ai.read_estimate | 164 | 1 | 2 | 7 |
| cargo.make_trip | 1779 | 1 | 2 | 5 |
| trip.ask_quotes | 1779 | 1 | 2 | 6 |
| audit.read_invoices | 60 | 1 | 2 | 3 |
| challan.add | 144 | 0 | 2 | 3 |
| quote.decide | 1165 | 2 | 2 | 7 |
| invoice.link | 1165 | 1 | 2 | 18 |
| invoice.submit_by_link | 1165 | 1 | 2 | 9 |
| trip.invoice_link | 1857 | 1 | 2 | 13 |
| trip.invoice_submit_by_link | 1857 | 1 | 2 | 8 |
| odometer.review_flagged | 59 | 0 | 2 | 2 |
| odometer.close_cycle | 2 | 2 | 2 | 2 |
| read.invoices_all | 1 | 2 | 2 | 2 |
| read.cargo_all | 1 | 2 | 2 | 2 |
| paper.add | 168 | 0 | 1 | 2 |
| cargo.create | 1320 | 1 | 1 | 7 |
| paper.renew | 93 | 0 | 1 | 2 |
| jobcard.reject | 35 | 1 | 1 | 2 |
| jobcard.invite_workshop | 2030 | 0 | 1 | 3 |
| cargo.suggest | 1779 | 1 | 1 | 5 |
| cargo.accept | 1779 | 0 | 1 | 4 |
| trip.quote_link | 11204 | 1 | 1 | 7 |
| trip.quote_submit_by_link | 11204 | 1 | 1 | 8 |
| cargo.reject | 21 | 0 | 1 | 1 |
| accident.add | 80 | 0 | 1 | 3 |
| trip.award | 1779 | 1 | 1 | 6 |
| trip.start | 1779 | 0 | 1 | 6 |
| cargo.in_transit | 1779 | 0 | 1 | 3 |
| vreq.request | 43 | 1 | 1 | 2 |
| accident.link_jobcard | 30 | 0 | 1 | 3 |
| trip.complete | 1779 | 1 | 1 | 5 |
| cargo.delivered | 1779 | 0 | 1 | 5 |
| vreq.reject | 42 | 1 | 1 | 2 |
| invoice.verify | 1165 | 1 | 1 | 29 |
| challan.set_status | 127 | 0 | 1 | 4 |
| payment.read | 1165 | 0 | 1 | 4 |
| payment.record | 1513 | 0 | 1 | 3 |
| jobcard.close | 1165 | 0 | 1 | 10 |
| trip.invoice_return | 78 | 0 | 1 | 2 |
| trip.invoice_verify | 1688 | 0 | 1 | 8 |
| trip.payment_read | 1779 | 1 | 1 | 5 |
| trip.payment_record | 1779 | 0 | 1 | 5 |
| trip.invoice_verify_billed | 91 | 0 | 1 | 2 |
| trip.payment_approve | 42 | 0 | 1 | 1 |
| odometer.submit_by_link | 109 | 1 | 1 | 9 |
| export.documents | 1 | 1 | 1 | 1 |
| export.accidents | 1 | 1 | 1 | 1 |
| export.challans | 1 | 1 | 1 | 1 |
| export.budgets | 1 | 1 | 1 | 1 |
| export.cost-per-hour | 1 | 1 | 1 | 1 |
| trip.quote_decline | 1269 | 0 | 0 | 2 |
| payment.approve | 3 | 0 | 0 | 0 |

## Screens and exports at day-60 size (milliseconds, one call each)

| Screen or export | ms |
|---|---|
| read.dashboard | 22 |
| read.overview | 64 |
| read.dashboard_requester | 4 |
| read.jobcards_all | 14 |
| read.quotations_all | 18 |
| read.invoices_all | 2 |
| read.cargo_all | 2 |
| read.trips_all | 3 |
| read.outsourced_report | 18 |
| read.jobcards_requester | 14 |
| export.vehicles | 3 |
| export.job-cards | 21 |
| export.invoices | 12 |
| export.documents | 1 |
| export.accidents | 1 |
| export.challans | 1 |
| export.budgets | 1 |
| export.costs-by-vehicle | 3 |
| export.repeat-repairs | 5 |
| export.cost-per-km | 5 |
| export.cost-per-hour | 1 |
| export.workshop-time | 3 |
| export.outsourced-trips | 17 |
| export.cargo | 13 |
| export.vehicle-requests | 3 |
| export.flags | 10 |

Export sizes: vehicles: 56 rows, 4 KB; job-cards: 1200 rows, 180 KB; invoices: 1165 rows, 119 KB; documents: 168 rows, 11 KB; accidents: 80 rows, 9 KB; challans: 144 rows, 11 KB; budgets: 0 rows, 0 KB; costs-by-vehicle: 56 rows, 3 KB; repeat-repairs: 724 rows, 42 KB; cost-per-km: 51 rows, 2 KB; cost-per-hour: 0 rows, 0 KB; workshop-time: 0 rows, 0 KB; outsourced-trips: 1779 rows, 258 KB; cargo: 1800 rows, 371 KB; vehicle-requests: 43 rows, 5 KB; flags: 127 rows, 11 KB

Day length: first 10 days 1.0 s on average, last 10 days 2.2 s on average (2.20x as the data grew).