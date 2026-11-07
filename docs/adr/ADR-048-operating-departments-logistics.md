# ADR-048: Operating departments: the logistics department runs and maintains its own vehicles

Status: accepted, 2026-11-06. Owner request, in several messages while ADR-045 phase 5a was built. **Phase 48a is built** (department scope, logistics maintenance, dispatch, pool-car rule, spending limit; migration `0029_departments.sql`; `tests/dept-scope.test.ts`), **not deployed**. **Phase 48b is built** (engine hours, hour-based service rules, cost per hour; migration `0030_engine_hours.sql`; `tests/engine-hours.test.ts`), **not deployed**. 48c is not built. Extends ADR-045 (trips, pool cars) and the job card flow. Owner answers already given: logistics raises **and approves its own job cards**; a vehicle's department is **a field on the vehicle**; loaders and forklifts get **an hour meter**.

## Why
In the owner's company the logistics department operates the vehicles used in day-to-day operations (trucks, loaders, forklifts, the pool cars for staff pick and drop), and looks after their maintenance, their trips and who drives what. Today every approval, every workshop choice and every list is company-wide and belongs to the fleet manager. Logistics needs to do its own work, on its own vehicles, without seeing or touching the rest of the fleet or the company's money.

## Decision

### 1. Which vehicles belong to a department
1. `vehicles.department` (text, optional): the operating department, for example `Logistics`. Empty means the general fleet, run by the fleet manager as today. It is edited on the vehicle form and in the CSV import, and shown on the vehicle page and in lists.
2. `role_departments(role_key primary key, department)`: a role tied to a department. The new role **`logistics`** is tied to `Logistics`. A person whose role has a row here is a **department user**: everything below applies to them. Administrators and fleet managers have no row, so nothing changes for them.
3. Department names are compared as written after trimming and ignoring case, and the Settings screen offers the names already in use, so `Logistics` and `logistics` are one department.

4. **A department is a label first, a scope second.** Owner, 2026-11-06: forklifts and loaders also belong to **Operations**, apart from the ones logistics operates, so the vehicle type cannot say who owns a vehicle; the field does. **Operations' vehicles are maintained by the fleet manager**: they carry `department = Operations`, are managed company-wide like any general-fleet vehicle, and **no role is tied to Operations** (no `role_departments` row, no new role). Operations staff who need a repair use the existing Requester role on the vehicle they hold. Only `logistics` is a department-scoped role. If Operations later wants to run its own maintenance, it is one more role and one more `role_departments` row, with no code change.
5. **Cost by department** is the one report this label enables without new data: the cost reports get a department filter and a department column, for the fleet manager, finance and the administrator (never for a department user, who has no cost reports). Engine hours (section 5) apply to any vehicle that tracks them, in any department.

### 2. What a department user can and cannot see
The rule is one SQL function, `dept_ok(vehicle_id)`: true for everyone who has no department, and for a department user only when the vehicle's department is theirs. It is used in the `where` of **every read path that lists or opens something tied to a vehicle**, and in a **database guard on writes**, so a screen or a link that forgets it still cannot reach another department's vehicle:
- Vehicles: list, page, board, files, records, exports.
- Job cards: list, page, attachments, exports, notifications' links.
- Quotations, work orders and workshop e-mails of those job cards.
- Trips: list and page (see 4).
- Dashboard cards and the menu badges, so counts do not leak either.
- Writes: `job_cards`, `vehicle_custody` and `trips` refuse a row whose vehicle is not `dept_ok` for the acting role (a before-trigger reading `app.role`, the same way the approval guard already does).

`tests/dept-scope.test.ts` runs a logistics login and a general-fleet vehicle through every function above and expects "not found" or "not allowed" each time. A new read path that lists vehicle-tied rows must call `dept_ok`; the test lists the paths so a forgotten one fails.

### 3. What logistics can do
Permissions of the `logistics` role: `vehicle.read`, `jobcard.create`, `jobcard.read_all`, `jobcard.approve`, `jobcard.assign_vendor`, `quotation.approve`, `trip.request`, `trip.dispatch`, and custody changes on its own vehicles (through `trip.dispatch`, not `vehicle.write`). It does **not** get `trip.read_all`: it sees pick and drop runs, trips on its own vehicles, and its own trips, nothing else. All of them apply **only to department vehicles**. It does **not** get `invoice.verify` (finance still verifies invoices and pays), `budget.manage`, `report.view`, `admin.*`, `employee.manage` or the cost reports. Segregation of duties is unchanged: nobody approves their own job card or trip, so in a one-person department the administrator approves.

### 4. Trips and assignment (owner: logistics does these too)
`trip.dispatch` (ADR-045) now means: approve, reject and assign a vehicle and driver for
- every **staff pick and drop** run (pool cars), and
- every **trip on a vehicle of the dispatcher's department**: a request naming a logistics vehicle as the preferred vehicle goes to logistics; a request naming none goes to the fleet manager as before.
A dispatcher can assign only vehicles of their department (or a pool car), and any active employee as driver. **Assignment of drivers to vehicles** (custody) for department vehicles is theirs too. The notification for such a request goes to the dispatchers, not to the fleet manager.

### 5. Engine hours for loaders and forklifts
A loader or forklift has no useful odometer. The migration adds:
- `vehicles.engine_hours` and the table `engine_hour_readings` (vehicle, hours, read time, source, who), validated like odometer readings (a lower number or an impossible jump per day is flagged for review).
- `vehicles.tracks_hours` (boolean, default false; the form offers it, and it is on by default for the classes `forklift`, `truck` and `other` when the person chooses). A vehicle that tracks hours shows hours beside, or instead of, kilometres.
- `service_types.interval_hours` and `vehicle_service_baselines.last_hours`: a service rule may say "every 250 hours". The due view and the "service due" screens use hours the way they use kilometres, with the same warning margin as a setting (`pm_warning_hours`).
- A job card for such a vehicle may carry an hour reading, and it is written to `engine_hour_readings` like the odometer is today. A trip does not need hours.
- **Cost per hour** next to cost per km on the Reports page and in the export, for vehicles that track hours.
Changing the due view is the delicate part (it is read by the dashboard, the service screens and the exports); it gets its own tests.

### 6. Setting it up
In Settings an administrator sees the departments in use and the roles tied to them. Inviting someone as `logistics` needs nothing else. A company with no logistics department simply never uses the role, and no screen changes for them.

## Data
Tenant migration `0029_departments.sql` (48a, built: `vehicles.department`, `role_departments`, `acting_department()`, `dept_ok()`, the write guards, the pool-car guards, the limit setting and guards, the logistics grants). Engine hours (48b) become `0030_engine_hours.sql` and gate passes (ADR-045 5b) `0031`. The original list for the two, idempotent: `vehicles.department`, `vehicles.tracks_hours`, `vehicles.engine_hours`, `role_departments`, `dept_ok()`, the write guards, `engine_hour_readings` with its validation trigger and audit trigger, the two interval columns, the revised due view, the `logistics` permission grants (the role itself is created by 0028), and `settings.pm_warning_hours`. `scripts/embed-migrations.mts` after editing `db/`.

## Phases
- **48a:** department field, `role_departments`, `dept_ok` on every read path and the write guards, the `logistics` grants, dispatch scope, `tests/dept-scope.test.ts`. This alone gives logistics its own maintenance and trips.
- **48b:** engine hours, hour-based service rules, cost per hour, and their tests.
- **48c:** browser-suite scenarios (a logistics login sees only its vehicles), Features page copy, a Privacy line only if a new kind of personal data appears (it does not).

## Rules this keeps
Tenant data only through `src/lib/db/tenant.ts`; `can()` first in every action; job card and trip state changes through their one function; the approver is never the requester; no secrets, no price, no new plan. Department scope is **in addition to** permissions, never instead of them.

## Not done
- A department hierarchy, or one person in several departments. A person belongs to one role, so one department.
- Per-department budgets and reports (the cost reports stay with finance and managers).
- Hour meters read from a tracker.
- Moving a vehicle between departments with its history; the field is simply changed, and the audit trail shows who and when.

## Pool cars (owner, 2026-11-06)
**Pool cars are Logistics vehicles, and only those.** A vehicle assigned to a person outside the logistics department is not a pool car. Built into 48a, replacing the plain `is_pool` switch of ADR-045 5a:
- A vehicle can be marked a pool car only when its `department` is Logistics (the department of the `logistics` role) and it is not held by an employee of another department. The switch is refused otherwise, with the reason.
- Giving a pool car to an employee whose department is not Logistics (custody, ADR-044 and the vehicle page), or moving it to another department, is refused while it is in the pool; take it out of the pool first. A pool car held by a logistics employee stays a pool car.
- Both rules are in the database (a trigger on `vehicles` and on `vehicle_custody`), not only on the screens. Pick and drop runs keep their rule: only a pool car can be assigned.

## Spending limit on logistics approvals (owner: yes, 2026-11-06)
- One setting, **`dept_approval_limit`**, in the company's currency, entered by the owner in Settings (never built into the code or the repository). It applies to department users only.
- **Above the limit a department user cannot approve**: not a job card whose estimate is over it, not a quotation whose total is over it. They can still raise, read and chase it; a **fleet manager or administrator** approves it, and the job card page says so ("over the logistics limit, waiting for a fleet manager"). Fleet managers are told, as they are for any submitted job card. At or under the limit, logistics approves as in section 3.
- Enforced where approval happens, in the database (the job card approval guard and the quotation approval function read `app.role`, the role's department and the setting), so a direct request cannot get past the page.
- **Until a figure is entered, no limit applies** (logistics approves anything on its own vehicles) and Settings shows "No limit set" beside the field with a short warning. Entering 0 means logistics approves nothing itself. The setting changes are in the audit trail like the others.
- **To confirm with the owner:** the figure, and whether the quotation total or the job card estimate decides when the two differ (assumed: each is checked at its own step against its own amount).

## Open points for the owner
1. **The limit figure.** Enter it in Settings once built, or tell me and I will set it.

## Amendment: phase 48b as built (2026-11-07)
- Migration `0030_engine_hours.sql`: `vehicles.tracks_hours`, `engine_hours`, `engine_hours_updated_at`; `engine_hour_readings` (source manual, job_card or baseline) with a validation trigger, a refresh trigger, the department write guard and an audit trigger; `job_cards.engine_hours` with a trigger that writes a reading; `service_types.interval_hours`; `vehicle_service_baselines.last_hours`; setting `pm_warning_hours` (default 25); `v_service_last_done` and `v_pm_status` carry hours (new columns at the end).
- A bad reading is **refused at entry** with a message (lower than on file, or more than 24 hours for every day since the last), not held for review as the odometer is. The database flags the same two cases and does not let them move the vehicle, as a second guard. There is no review screen for hours.
- Hour tracking is switched on per vehicle (the Manage panel on the vehicle page), by `vehicle.write` or `trip.dispatch`, and `dept_ok` keeps a logistics user to its own vehicles. A job card carries an hour meter field only for a vehicle that tracks hours; for any other vehicle a stray value is ignored.
- A service rule may be in hours alone, or any mix of months, km and hours. A vehicle that stops tracking hours drops the hours rule. The warning margin is `pm_warning_hours`.
- Cost per engine hour is a Reports panel (shown only when a vehicle tracks hours) and the export `cost-per-hour`, measured the way cost per km is: last accepted reading in the period minus the last one before it, two readings needed.
- Not built: hour readings through the driver's single-use link, and a department column on the vehicle lists (48c).

## Amendment: phase 48c as built (2026-11-07)
- The vehicle list shows the **vehicle's own** department under the plate (it used to show the holder's employee department, which is a different thing) and has a **Department** filter with "No department" for the general fleet. The filter shows only when the person can see more than one group, so a logistics login (one department, nothing else) is not offered a choice. The vehicles export has a Department column and takes the same filter. A department user stays inside `dept_ok` however the filter is set.
- The vehicle **import** (CSV and the Excel sheet) has an optional `department` column, last in the list. A name already in use keeps its spelling (`logistics` becomes `Logistics`), including inside one file, and the department is set in the same transaction as the vehicle. Over 60 letters is a row error, and a failed row still means nothing is imported.
- Browser scenario 8 (`e2e/s8-departments.mjs`): the administrator puts vehicles in Logistics from the vehicle page; the list and filter follow; a logistics person joins with the company code and gets the role; their list holds only Logistics vehicles with no filter, no Add or Import; another department's vehicle, the cost reports and the import are closed to them; their export holds only their own vehicles. Unit tests: `tests/dept-lists.test.ts`.
- Not built: cost reports by department (a filter and a column on the cost reports), a department field on the Add vehicle form for logistics users, and Features page copy.
