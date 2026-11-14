# Simulation baseline (run6)

The result of the 60-day simulation described in `docs/qa/SIMULATION-60-DAYS.md`, kept so another agent can run the simulation on its own machine and compare.

- Code: `sim/sixty-days.sim.ts`, commit `2f46946` or later. Seed 20261114, 60 days plus 14 settling days, 20 job cards and 30 cargo requests a day, 50 requesters.
- `report.md`: what was done, the money, where everything ended, the database reconciliation, malfunctions, correct refusals, speed.
- `daily.csv`: one row per day.
- `all-entries.xlsx`: every record of the simulated company, one sheet per kind, plus the mail and WhatsApp the app wrote to files and the operation log of every call (73,489 rows).
  It is fake data from a throwaway database; nothing in it is a real customer, employee, phone number or email address (all addresses end in `sim.example`).

## How to compare

    scripts/live-like-db.sh fleet_sim
    SIM_DAYS=60 SIM_RUN=mine TEST_DATABASE_URL="postgres://fleet_owner@/fleet_sim?host=/tmp" npx vitest run -c vitest.sim.config.ts
    diff <(cut -d, -f1-3 docs/qa/simulation-baseline/daily.csv) <(cut -d, -f1-3 sim/out/mine/daily.csv)

The counts in `report.md` ("What was done", "Where everything ended", money totals) must match to the unit, because the seed is fixed. Ids, timestamps and milliseconds differ. Any difference in a count,
a reconciliation line that is not `ok`, or a malfunction that is not in this baseline is a finding.

## Known in this baseline

- `odometer.approve_normal` refused twice (days 31 and 60): the bulk "approve all normal readings" rolls back when one reading is just under the limit, because the preview rounds days up and the database check uses exact time.
- A job card nobody answered cannot be cancelled by the fleet manager (only by the requester): 4 cases in earlier runs.
- No maintenance (service due) reminders: no vehicle had a service history.
