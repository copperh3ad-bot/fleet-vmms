# ADR-048: Operating departments: the logistics department runs and maintains its own vehicles

Status: proposed, 2026-11-06. Owner request, in three messages while ADR-045 phase 5a was built. **Not built.** Extends ADR-045 (trips, pool cars) and the job card flow. Owner answers already given: logistics raises **and approves its own job cards**; a vehicle's department is **a field on the vehicle**; loaders and forklifts get **an hour meter**.

## Why
In the owner's company the logistics department operates the vehicles used in day-to-day operations (trucks, loaders, forklifts, the pool cars for staff pick and drop), and looks after their maintenance, their trips and who drives what. Today every approval, every workshop choice and every list is company-wide and belongs to the fleet manager. Logistics needs to do its own work, on its own vehicles, without seeing or touching the rest of the fleet or the company's money.

## Decision

### 1. Which vehicles belong to a department
1. `vehicles.department` (text, optional): the operating department, for example `Logistics`. Empty means the general fleet, run by the fleet manager as today. It is edited on the vehicle form and in the CSV import, and shown on the vehicle page and in lists.
2. `role_departments(role_key primary key, department)`: a role tied to a department. The new role **`logistics`** is tied to `Logistics`. A person whose role has a row here is a **department user**: everything below applies to them. Administrators and fleet managers have no row, so nothing changes for them.
3. Department names are compared as written after trimming and ignoring case, and the Settings screen offers the names already in use, so `Logistics` and `logistics` are one department.

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
Permissions of the `logistics` role: `vehicle.read`, `jobcard.create`, `jobcard.read_all`, `jobcard.approve`, `jobcard.assign_vendor`, `quotation.approve`, `trip.request`, `trip.dispatch`, `trip.read_all`, and (for its own vehicles) custody changes. All of them apply **only to department vehicles**. It does **not** get `invoice.verify` (finance still verifies invoices and pays), `budget.manage`, `report.view`, `admin.*`, `employee.manage` or the cost reports. Segregation of duties is unchanged: nobody approves their own job card or trip, so in a one-person department the administrator approves.

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
Tenant migration `0029_departments_hours.sql` (gate passes, ADR-045 5b, then become `0030`), idempotent: `vehicles.department`, `vehicles.tracks_hours`, `vehicles.engine_hours`, `role_departments`, `dept_ok()`, the write guards, `engine_hour_readings` with its validation trigger and audit trigger, the two interval columns, the revised due view, the `logistics` permission grants (the role itself is created by 0028), and `settings.pm_warning_hours`. `scripts/embed-migrations.mts` after editing `db/`.

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

## Open points for the owner
1. **Logistics and money.** As decided, logistics approves its own job cards with no spending limit. If the company wants a limit (above which a fleet manager must approve), say so; it would be one setting, not a new design.
2. **Pool cars and department.** Pool cars are assumed to be Logistics vehicles. If one belongs to another department but is shared, say so.
