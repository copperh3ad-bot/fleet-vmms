# 60-day usage simulation

`sim/sixty-days.sim.ts` drives the real service layer (every permission, rule and database function the app uses) against a real Postgres for 60 simulated days,
plus 14 settling days. It is not part of `npm test`.

Run it (local machine only; it rebuilds the database named in the URL):

    scripts/live-like-db.sh fleet_sim
    SIM_DAYS=60 SIM_RUN=run1 TEST_DATABASE_URL="postgres://fleet_owner@/fleet_sim?host=/tmp" npx vitest run -c vitest.sim.config.ts

Output goes to `sim/out/<SIM_RUN>/` (not committed): `report.md`, `daily.csv` (one row per day), `ledger.jsonl` (every operation: day, actor, reference, milliseconds, result),
`email.jsonl` and `whatsapp.jsonl` (every message the app would have sent; nothing is sent), `chat-debug.log` when `SIM_DEBUG_CHAT=<chat name>` is set.
`SIM_SEED`, `SIM_JOBS` and `SIM_CARGO` change the randomness and the daily volumes.

## Cast
Main agents: administrator, fleet manager, logistics, HR, finance, auditor (one each). Fifty requesters, each holding one vehicle and limited to it. Eight workshops and
ten logistics providers have no login and answer only through single-use links or by email, as in real use. The AI is a fake model (no network, no cost); mail and
WhatsApp are written to files.

## A day
- 20 job cards: 9 from the app, 4 through the WhatsApp menu, 3 as a free-text WhatsApp message that the AI drafts and the requester confirms with YES. A manager approves
  and asks three workshops (about 50 estimates a day). Most estimates arrive by link; about 15% of the first workshop's arrive as an email that the AI reads as a draft and
  a person saves (some are unreadable and are typed by hand). The cheapest estimate is approved, the workshop is told by WhatsApp, invoices by link, finance checks,
  the administrator pays (large ones approved by the fleet manager first), the card is closed.
- 30 cargo requests with weight and volume (22 from the app, 8 through the WhatsApp menu), accepted by logistics, made into trips, sent to six to eight providers each (about
  200 quotes a day). For some trips the AI compares the quotes. The fleet manager awards (never the person who made the trip). Run, invoiced by link (some invoices above
  the award, which finance pays with a note or returns), checked, paid.
- 8 odometer readings and 3 trip reservations a day through the WhatsApp menu. HR raises a vehicle request most days.
- 0 to 2 accidents (some linked to a job card, some with an insurance claim), 0 to 4 challans (paid or disputed later), papers renewed when they are within a week of expiry.
- The daily reminders job runs every day: notices and emails for papers and for service due.
- The auditor reads and tries four changes a day, every one of which must be refused.
- Twice (days 30 and 60): the monthly odometer job sends WhatsApp requests, links are issued, holders answer (some wrongly), the fleet manager approves and reviews, the cycle closes.

## The clock
Before each day every date in the company's data moves back one day (done as the database superuser with triggers off, so the audit log is not disturbed; the month
label of odometer cycles is left alone). Yesterday's work is then a day old when today's starts, so the app's own "within N days" rules, repeat-repair flags, paper
expiries and reminder thresholds see a real calendar.

## What it does not cover
No browser, no network and no page rendering (see `e2e/` for those); no real WhatsApp, Claude or email delivery (files and a fake model stand in); no plan or billing limits
(the plan is fixed at Pro); one company, so no cross-company load. Replies to the monthly odometer WhatsApp request and "invoice queried" notices are not simulated; the
maintenance (service due) reminders did not fire because no vehicle had a service history.
