# 60-day usage simulation

`sim/sixty-days.sim.ts` drives the real service layer (every permission, rule and database function the app uses) against a real Postgres for 60 simulated days,
plus 14 settling days. It is not part of `npm test`.

Run it (local machine only; it rebuilds the database named in the URL):

    scripts/live-like-db.sh fleet_sim
    SIM_DAYS=60 SIM_RUN=run1 TEST_DATABASE_URL="postgres://fleet_owner@/fleet_sim?host=/tmp" npx vitest run -c vitest.sim.config.ts

Output goes to `sim/out/<SIM_RUN>/` (not committed): `report.md`, `daily.csv` (one row per day), `ledger.jsonl` (every operation: day, actor, reference, milliseconds, result).
`SIM_SEED`, `SIM_JOBS` and `SIM_CARGO` change the randomness and the daily volumes.

## Cast
Main agents: administrator, fleet manager, logistics, HR, finance, auditor (one each). Fifty requesters, each holding one vehicle and limited to it. Eight workshops and
ten logistics providers have no login and answer only through single-use links, as in real use.

## A day
20 job cards raised, approved and sent to three workshops (about 50 estimates a day), the cheapest approved, invoiced by link, checked by finance, paid by the
administrator (large ones approved by the fleet manager first), closed. 30 cargo requests with weight and volume, accepted by logistics, made into trips, sent to six to
eight providers each (about 200 quotes a day), awarded by the fleet manager (never by the person who made the trip), run, invoiced by link, checked, paid. HR raises a
vehicle request most days and the fleet manager decides it. The auditor reads and tries four changes a day, every one of which must be refused.

## The clock
Before each day every date in the company's data moves back one day (done as the database superuser with triggers off, so the audit log is not disturbed). Yesterday's
work is then a day old when today's starts, so the app's own "within N days" rules, repeat-repair flags and due dates see a real calendar.

## What it does not cover
No browser, no network and no page rendering (see `e2e/` for those); no WhatsApp, AI or email delivery; no plan or billing limits (the plan is fixed at Pro); no odometer
readings, reminders, accidents, challans or paper expiries; one company, so no cross-company load.
