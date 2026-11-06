# ADR-045: Trip requests and gate passes (an optional module)

Status: proposed, 2026-11-05. Owner request, from a comparison with a competitor's fleet brochure (VMS & Fleet Management, pages 5 and 6). **Decisions 1 to 4 in "Owner decisions" are to be confirmed before the migration is written.** Builds on custody (`vehicle_custody`), odometer readings (`0003_odometer.sql`), the permission model (`roles`, `permissions`, `can()`), and the rule that state changes go through one function and always write an event (CLAUDE.md rule 4).

## Amendments, 2026-11-06 (phase 5a built)
Owner said "start with ADR-045", so the assumed answers to decisions 1 to 4 stand: included in Basic behind the switch, gate staff have their own login (the `security` role), only people with a login request. Changes made while building:
- **The overlap rule is a trigger, not an exclusion constraint** (`trip_overlap_guard`). It takes a transaction lock per vehicle and per driver, then checks for an overlapping approved or started trip, so a race between two approvals still cannot book the same vehicle twice, and no database extension (`btree_gist`) is needed. Back-to-back trips (one ends when the next starts) are allowed.
- **Migration 0028 holds trips only.** Gate passes, with their `gate_passes` table and sequence, move to migration 0029 (phase 5b). 0028 already adds the `gate.use` permission and the `security` role.
- **The module switch is the setting `module_trips` (0 or 1)**, shown in Settings under general with `admin.settings`.
- **Pick and drop by pool cars (owner request, 2026-11-06).** The logistics department runs a few pool cars that pick up and drop staff.
  1. `vehicles.is_pool` marks a pool car; the Trips page lists the fleet with a switch per car, for logistics and for people who manage vehicles. A car with an approved or started pick and drop run cannot be taken out of the pool.
  2. `trips.kind` is `trip` (default) or `pick_drop`; `trips.stops` holds further pick-up or drop-off points, in order, as text. A pick and drop run still has a first pick-up (`from_place`), a last drop-off (`to_place`), start and end times and a passenger count.
  3. **A pick and drop run can only be given a pool car**, checked in `trip_transition` and when a preferred vehicle is named. An ordinary trip may use a pool car.
  4. New role **`logistics`** and permission **`trip.dispatch`**: dispatch means approve and assign a vehicle and driver for pick and drop runs only (also given to `fleet_manager` and `tenant_admin`). Logistics may also ask for trips (`trip.request`) but cannot approve ordinary trips; it sees every pick and drop run and, of ordinary trips, only its own. Approvers are notified of pick and drop requests together with the dispatchers.
  5. **Widened by ADR-048:** logistics also dispatches trips on its own vehicles (trucks, loaders), not only pick and drop runs, and sees only its department's vehicles. Until ADR-048 is built, `trip.dispatch` covers pick and drop runs only.
  6. **Not built, and the next step if logistics wants it:** a fixed route that repeats every working day with a passenger list (recurring runs), a day sheet of runs per car, and passengers named per run. Today each run is one request.
- Notifications are open to people holding `trip.request`, `trip.approve` or `trip.dispatch`, so a logistics login (which has no job card permission) gets its notices.

## Why
Fleet OTG manages the cost and approval trail of repairs. A company that also lends its pool vehicles out for trips has no record of who asked for a vehicle, who agreed, who drove, when it left and came back, or how far it went. That record also makes two things meaningful that are not today: **utilisation** (how many days a vehicle was actually used) and **driver trip counts**. It is a separate module, so a company that only wants maintenance never sees it.

## Decision

### Shape
1. **An optional module, off by default**, switched on per organization by the administrator in Settings (`settings.module_trips`). When off, there is no menu entry, the pages answer "not available" and no action runs. It is **not** a plan feature (see decision 2).
2. **Trip request.** A person with `trip.request` asks for a vehicle: purpose, from, to, start and end date and time, number of passengers (optional), and optionally a preferred vehicle. Trips get a number from a sequence, `TR-000001`, the same way job cards get `JC-`.
3. **Approval.** A person with `trip.approve` approves or rejects, **never their own request** (the rule for job cards). On approving they **assign a vehicle and a driver**; a rejection or cancellation needs a reason. The assigned driver is an employee, not necessarily the requester.
4. **Conflicts are refused by the database, not just the page.** An exclusion constraint on `(vehicle_id, tstzrange(start_at, end_at))` and another on `(driver_id, ...)`, over trips in `approved` or `started`, so two trips cannot overlap on one vehicle or one driver even through a race. A vehicle that is `in_workshop`, `inactive` or `disposed` cannot be assigned. A driver whose licence has expired (ADR-044) is **warned, not blocked**.
5. **States:** `requested`, `approved`, `rejected`, `cancelled`, `started`, `completed`. One function, `transitionTrip`, makes every change and writes a `trip_events` row (who, from, to, when, note). Nothing else updates `trips.status`.
6. **Start and finish.** Starting a trip records the odometer out; completing it records the odometer back. Both are written to `odometer_readings` (new source `'trip'`; the migration widens the check on `source`) and go through the existing flagging rules (a reading below the last one, or an implausible jump, is flagged for review). Distance is end minus start, shown on the trip. A start reading is required to start, an end reading to complete.
7. **Custody is unchanged.** `vehicle_custody` still says who holds a vehicle long-term, and the cost-by-driver report still follows custody. A trip's driver is separate. A trip does not move custody.

### Gate passes
8. **A gate pass is the record of a vehicle leaving and returning.** For an approved trip it is created automatically when the trip is approved. For an unscheduled movement (no trip) a person with `gate.use` issues one: vehicle, driver, reason, expected return.
9. **Pass states:** `issued`, `out`, `returned`, `cancelled`. Marking a pass `out` or `returned` is what starts or completes its trip, when it has one, through `transitionTrip`, so the gate and the trip can never disagree. Marking out/returned takes the odometer reading, as above.
10. **Pass number and QR code.** Each pass has a number (`GP-000001`) and a QR code that encodes only that number. **Scanning needs a signed-in person with `gate.use`: the code opens the gate screen on that pass.** There is no public verification page and no unauthenticated endpoint (CLAUDE.md rule 5 is unchanged). A printable pass page (A5, number, vehicle, driver, purpose, times, code) is for the driver to carry.
11. **Gate screen.** A plain page for the security role: today's approved and active trips, a vehicle search by registration number, and the buttons Out / Returned / Issue a pass. It shows nothing about costs, job cards or other staff.

### Roles and permissions
12. New permissions: `trip.request`, `trip.approve`, `trip.read_all` (otherwise a person sees their own requests and trips they drive), `gate.use`.
13. Default grants: `requester` gets `trip.request`; `fleet_manager` gets `trip.approve`, `trip.read_all`, `trip.request`; `tenant_admin` gets all four; `auditor` gets `trip.read_all`. **A new role, `security` ("Gate security"),** gets `gate.use`, `vehicle.read` and nothing else. Every server action calls `can()` first (rule 3).
14. **Vehicle scope** (`own` / `all`) applies as it does elsewhere: a person scoped to their own vehicles sees only trips on them.

### Notifications
15. Approvers are notified of a new request; the requester and driver of an approval, rejection or cancellation; the approver of a trip not returned by its expected end (once, using the same claim-then-send pattern as the document reminders so it never repeats). In-app and email as other notifications are. **WhatsApp is not part of this ADR.**

### Reports (phase 3)
16. **Trips per vehicle and per driver** for a period: trip count, distance, days used. **Utilisation** = days with any `started` or `completed` trip over days in the period, for vehicles not `disposed`. Fleet total and average. A **late returns** list. Exports as CSV like the others. No "compliance score" or other invented rating: only counts and distances we hold.

## Data
Tenant migration `0028_trips_and_gate_passes.sql` (after ADR-044's 0027), idempotent: `trips`, `trip_events`, `gate_passes`, two sequences, the exclusion constraints (the `btree_gist` extension is needed; the migration creates it and the control plane's Postgres 16 supports it), the widened odometer `source` check, the four permissions, the `security` role and the default grants. A setting `module_trips`. `scripts/embed-migrations.mts` after editing `db/`.

## Phases
- **5a:** tables, `transitionTrip`, request, approve/reject/cancel, the "My trips" and "Trip approvals" pages, notifications, the Settings switch, tests.
- **5b:** gate passes, QR, printable pass, gate screen, the `security` role, tests.
- **5c:** reports and exports, late-return reminder, browser-suite scenarios, Features page and About copy (no new prices).

## Rules this keeps
- Tenant data only through `src/lib/db/tenant.ts`; no supabase-js for tenant tables; `can()` in every action; one state function with events; no unauthenticated endpoint; no secrets; no price.
- Nothing here changes the Basic price or adds a charge. If the module is to be a Pro feature or an add-on, that is the owner's decision (rule 7).

## Owner decisions (confirm before 5a)
1. **Do you want it?** It widens Fleet OTG from maintenance into vehicle operations. Is there a customer asking for trips or gates, or is it for the sales pitch?
2. **Which plan?** Included in Basic with the switch (assumed above), Pro only, or a priced add-on. No price may be added without you.
3. **Security staff:** should gate staff have their own login and the `security` role (assumed), or should the gate work from a single-use link like the driver odometer link (ADR-006)? A link means no account but more public surface.
4. **Who may request:** only people with a login (assumed), or also drivers without accounts through a link? The second needs an ADR-006-style single-use request link.

## Not done
- GPS tracking, live location, fuel, and routes. Visitor management (the competitor's other half). Booking calendars or a vehicle pool view beyond the conflict check. Recurring trips. Cost charging of a trip to a department. WhatsApp requests and approvals. Kiosks.
- Blocking a trip for an expired driving licence.

## Privacy
Trips record who went where and when. The Privacy policy needs a line for trip purpose, route, times and distance, and for the gate pass record; the module is off unless an administrator turns it on.
