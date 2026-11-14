# Simulation baseline (run7)

The result of the 60-day simulation described in `docs/qa/SIMULATION-60-DAYS.md`, kept so another agent can run the simulation on its own machine and compare.

- Code: `sim/sixty-days.sim.ts` with the odometer bulk-approve fix (`566e746`) or later. Seed 20261114, 60 days plus 14 settling days, 20 job cards and 30 cargo requests a day, 50 requesters.
- `report.md`: what was done, the money, where everything ended, the database reconciliation, malfunctions, correct refusals, speed.
- `daily.csv`: one row per day.
- `all-entries.xlsx`: every record of the simulated company, one sheet per kind, plus the mail and WhatsApp the app wrote to files and the operation log of every call.
  It is fake data from a throwaway database; nothing in it is a real customer, employee, phone number or email address (all addresses end in `sim.example`).

Result: 16 of 16 reconciliation checks `ok`, no malfunctions. Workshops paid 45,080,234 and providers paid 112,443,346; the database agrees to the rupee.

## How to compare

    scripts/live-like-db.sh fleet_sim
    SIM_DAYS=60 SIM_RUN=mine TEST_DATABASE_URL="postgres://fleet_owner@/fleet_sim?host=/tmp" npx vitest run -c vitest.sim.config.ts
    diff <(cut -d, -f1-3 docs/qa/simulation-baseline/daily.csv) <(cut -d, -f1-3 sim/out/mine/daily.csv)

The counts in `report.md` ("What was done", "Where everything ended", money totals) must match to the unit when the code is the same, because the seed is fixed. Ids, timestamps and milliseconds differ.
Any difference in a count, a reconciliation line that is not `ok`, or a malfunction is a finding. A code change that alters how many random draws happen (as the odometer fix did) moves every later count; then replace this baseline.

## Known in this baseline

- A job card nobody answered cannot be cancelled by the fleet manager (only by the requester): 4 cases in earlier runs.
- No maintenance (service due) reminders: no vehicle had a service history.

Fixed since run6: the odometer "approve all normal readings" no longer rolls back the whole batch when the database holds one reading (`odometer.approve_normal` refused twice in run6).
