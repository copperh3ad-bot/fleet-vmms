# ADR-067: V1.3 plan, gate passes and driver assignment

Status: **proposed, plan only, nothing built** (2026-11-08). Owner request: plan gate passes and driver assignment for V1.3. Builds on ADR-045 (trips, pool cars, the gate-pass design in its decisions 8 to 11, deferred by the owner on 2026-11-07), ADR-048 (logistics runs its own vehicles) and ADR-044 (licences). Decisions marked **OWNER** are open. No price is set here (CLAUDE.md rule 7; figures appear on `/pricing` only, ADR-065).

## What exists today
- **Trips (live, optional module `module_trips`):** request, approve, reject, cancel, start, complete; a vehicle and a driver are assigned **at approval** by someone with `trip.approve` or `trip.dispatch`; overlap on the same vehicle or the same driver is refused by the database (`trip_overlap_guard`); pick and drop runs on pool cars; start and end odometer readings.
- **Custody (`vehicle_custody`):** the long-term holder of a vehicle. Costs and reminders follow it.
- **Licences (ADR-044):** each driver's licence expiry is held; a trip assigns a driver with an expired licence with a **warning, not a block**.
- Not built: gate passes (ADR-045 5b/5c), a day roster, driver availability, recurring runs, a driver's own "my assignments" view.

## Part A: gate passes (ADR-045 decisions 8 to 11, restated and kept)
1. A **gate pass** records a vehicle leaving and returning. Created **automatically when a trip is approved**, or **issued by hand** (vehicle, driver, reason, expected return) for a movement with no trip.
2. States `issued`, `out`, `returned`, `cancelled`. Marking `out` or `returned` takes the odometer reading and, when the pass has a trip, **starts or completes the trip through `transitionTrip`**, so the gate and the trip cannot disagree.
3. **Number `GP-000001` and a QR code that encodes only the number.** Scanning needs a signed-in person with `gate.use`; there is **no public verification page** and no new unauthenticated endpoint (CLAUDE.md rule 5 unchanged). A printable A5 pass for the driver.
4. **Gate screen** for the new `security` role: today's approved and active trips, vehicle search by registration, Out / Returned / Issue a pass. It shows no costs, job cards or other staff.
5. **Late-return reminder** to the approver, once, with the claim-then-send pattern used by the other reminders.
6. Reports: late returns, passes per vehicle. Exports as CSV like the others.

## Part B: driver assignment (new)
Today a driver is chosen per trip by whoever approves. V1.3 adds three things, in this order of value:

1. **Availability-aware assignment.** When assigning a driver (to a trip, a pick and drop run or a gate pass), the screen lists drivers with: free or busy in that window (from the existing overlap data), licence valid or expiring (green / amber / red), and any recorded leave. Leave is a small new record (`driver_unavailability`: driver, from, to, reason) entered by a manager; an overlapping assignment is **refused by the database** the same way a trip overlap is.
2. **A day sheet** (per day, per vehicle and per driver) for logistics and fleet managers: who has which vehicle on which runs, from trips, pick and drop runs and standing assignments, with print and CSV export. It reads existing data; it does not create a second source of truth.
3. **Standing and recurring assignments.** A driver assigned to a vehicle for a period (a regular route, a week, a month) without a trip per movement, and **recurring runs** (a fixed pick and drop route on working days with its passenger list, the "not built" item in ADR-045 amendment 6). A recurring run generates its trips ahead (for example the next 14 days) through `transitionTrip`, each one subject to the same overlap guard, so a conflict is shown and never silently double-booked.

A **driver's own view** ("My assignments") shows their runs, the vehicle, times and pass number, and lets a signed-in driver confirm pick-up. Drivers without an account keep using the odometer link only (ADR-006).

**Not in B:** automatic optimisation of routes or driver-to-run matching, GPS, live location, hours-of-service or fatigue rules, driver pay, fuel. Assigning remains a person's decision; the system shows the facts and refuses conflicts.

## Data and gates (for when it is built)
- Tenant migrations (next free numbers at the time; **0037 is reserved for V1.2 if that ships first**): `gate_passes` and a `GP-` sequence, `driver_unavailability`, `driver_assignments` (standing, with a period and an overlap guard), `recurring_runs` and a generator function. Every state change through one function with an events table and an audit trigger (rule 4); idempotent migrations through `scripts/migrate-tenants.mts`; `npx tsx scripts/embed-migrations.mts` after editing `db/`.
- New permissions `gate.use`, `driver.assign`, `driver.read_all`; the `security` role (ADR-045 decision 13). Every server action checks `can()` (rule 3); tenant data only through `src/lib/db/tenant.ts`; supabase-js never for tenant tables.
- Tests: pglite harness for the overlap guards (trip vs standing assignment vs leave), recurring generation, gate/trip agreement, scoping of the day sheet; browser scenarios for the gate screen and assignment screen; audit-coverage test updated.
- The module stays behind `module_trips` (the existing switch). A company that only wants maintenance never sees any of it.

## Phases
0. Decisions below; check with a real customer that the gate and assignment screens match how they work.
1. Gate passes with the gate screen, the `security` role and the printable pass (ADR-045 5b).
2. Late-return reminder, gate reports and exports (ADR-045 5c).
3. Availability-aware assignment: unavailability record, the driver picker, the overlap guard across all assignment kinds.
4. Day sheet and the driver's "My assignments".
5. Standing assignments and recurring runs.

## Honest limits
- **Gate scanning depends on a person with a login at the gate.** If a customer wants a gate with no account, that is a single-use link design (more public surface) and needs its own ADR.
- **Data quality** depends on gate staff marking Out and Returned and on odometer entry at the gate.
- **This moves Fleet OTG from maintenance toward operations.** Competing dispatch products do far more (live tracking, route optimisation). V1.3 deliberately stays at records, conflict-free assignment and sheets, not dispatch automation.
- Privacy: trips, passes and assignments record who went where and when. The Privacy policy needs a line for gate passes, leave and assignments before release.

## OWNER decisions
1. **Is there a customer asking for gates and assignment?** Or is it for the pitch? It decides how much of Part B to build.
2. **Which plan carries it** (Basic behind the switch as trips are, Pro, or an add-on). No price set here.
3. **Gate staff:** their own login and the `security` role (assumed), or a single-use gate link.
4. **Expired licence:** keep warn-only (today), or block assignment of a driver with an expired licence.
5. **Leave:** entered by a manager only (assumed), or requested by drivers and approved (a second workflow).
6. **Order:** gate passes first (assumed, already designed), or assignment first.
7. **Recurring runs:** needed in V1.3, or left for V1.4.
