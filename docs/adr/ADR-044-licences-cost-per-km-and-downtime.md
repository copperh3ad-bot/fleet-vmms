# ADR-044: Driver licences, cost per kilometre, and workshop downtime

Status: accepted and built, 2026-11-05 (not deployed). Owner request, from a comparison with a competitor's fleet brochure (VMS & Fleet Management). Builds on the vehicle-paper expiry reminders (`claim_document_reminders`), the odometer readings (`0003_odometer.sql`) and the job card flow (`transitionJobCard`).

## Why
Three things a fleet company asks that Fleet OTG cannot answer today, all inside the maintenance scope and all built from data we already keep (or one small table):
1. Which drivers' licences are about to expire?
2. What does each vehicle cost per kilometre?
3. How long was each vehicle off the road in the workshop?

## Decision

### 1. Driver licences and their expiry
1. A tenant table `driver_licences` (one row per employee, replaced in place): `employee_id` (unique), `licence_no`, `licence_class` (plain text), `issued_on` (optional), `expires_on` (required), `emergency_contact_name`, `emergency_contact_phone` (both optional).
2. **Same reminder machinery as vehicle papers.** A new function `claim_licence_reminders(p_today)` uses the same `doc_reminder_days` setting and records what it sent in `document_reminders` (its `entity_type` list gains `'driver_licence'`; the migration checks the constraint and widens it if there is one). `runDocumentReminders` calls both. The reminder goes to people with `compliance.manage` and to the driver if they have a login. Only active employees count.
3. **Who sees it.** Reading and editing a licence needs `employee.manage` or `compliance.manage` (no new permission). The licence number is personal data: it is shown in full only on the Employees page, masked to its last four characters on the Compliance list, left out of notifications and exports, and kept in `audit_log` only as its last four characters (the emergency phone is not kept there at all). A driver does not yet have a page of their own to see it.
4. **Where.** A "Driving licence" block on the employee page; an "Expiring licences" list on the Compliance page beside the vehicle papers, with the same colours and thresholds.
5. A licence that has expired does **not** block anything (no blocking of custody or job cards in this ADR). It is shown and reminded. Blocking would be a separate decision with the owner.

### 2. Cost per kilometre
1. A report panel and CSV export "Cost per kilometre", per vehicle, for the period chosen on the Reports page (same month selector).
2. **Cost** is the same figure the Reports page already counts per vehicle (closed job cards in the period), so the two never disagree.
3. **Kilometres** are the last accepted odometer reading in the period minus the last accepted reading before it (or the first in the period if there is none before). Readings with status `flagged` or `dismissed` are ignored. Fewer than two usable readings shows "Not enough readings", never a made-up number. A vehicle whose odometer goes backwards in the period shows the same text.
4. Result: cost per km, kilometres driven, cost, and a fleet total and average. Vehicles are sorted worst first.
5. **Not in this ADR:** fuel economy and fuel cost. Fleet OTG does not record fuel purchases, so it will not show fuel figures.

### 3. Workshop downtime
1. A table `vehicle_status_history`: `vehicle_id`, `status`, `from_at`, `to_at` (null while current), `changed_by` (the user who made the change, from the same setting the audit trail uses). A **database trigger** on `vehicles.status` closes the open row and opens a new one, so every path that changes status is recorded (`transitionJobCard` and any other), not only the ones we remember. The migration backfills one open row per vehicle, starting at the vehicle's `created_at`, with its current status.
2. Report panel and export "Time in the workshop", per vehicle for the period: days in the workshop, number of visits, longest visit, and availability (period days minus workshop days, over period days, for the days the vehicle was not `disposed`). The fleet figure is the average across vehicles.
3. Days are UTC calendar days, and any part of a day in the workshop counts as a workshop day; the page says so. A vehicle that was in the workshop and went back the same day counts one day.
4. Because the backfill starts at `created_at`, time before this migration is treated as the vehicle's status at that moment, so earlier visits are not in the figures. The page says "Before this was recorded, vehicles are treated as available." Vehicles that were never in the workshop are left off the table; the fleet availability figure still counts them.

## Data
One tenant migration, `0027_licences_downtime_and_cost.sql`, idempotent, run across tenants with `scripts/migrate-tenants.mts` (CLAUDE.md rule 8): `driver_licences`, `vehicle_status_history` with its trigger and backfill, the widened reminder list and `claim_licence_reminders`. Cost per km needs no table; it is a function over existing rows. Run `scripts/embed-migrations.mts` after editing `db/`.

## Rules this keeps
- Every server action calls `can()` first. No new endpoint, no public page, no supabase-js for tenant tables, no new price.
- Tenant data only through `src/lib/db/tenant.ts`.
- All three are in Basic. The owner has not asked for any of them to be Pro.

## Tests
- Licence: validation and permissions; expiry thresholds and no repeat sends (same shape as the vehicle-paper tests); renewal starts the reminders again; inactive employees are skipped; masking; the audit trail never holds the number.
- Cost per km: one reading, two readings, a flagged reading ignored, odometer going backwards, no readings, a period with no spend.
- Downtime: the trigger records status changes and ignores other updates; backfill, and running the migration twice; days, visits, longest visit and availability; a visit still open today; a visit cut at the start of the period; disposed days left out.
- All in `tests/licences-downtime.test.ts`, with the export list test updated. **The browser suite was not extended or run for this.**

## Not done
- Licence class as a controlled list, licence photo upload (the attachment kinds do not include it; adding it is a one-line change to the attachment rule if wanted).
- Blocking custody or job cards for an expired licence.
- Fuel economy. Utilisation (needs trips; see ADR-045).
- Scheduled emailed reports (the owner skipped it for now).
- A page where a driver sees their own licence.
- A licence export.
- Encrypting the licence number at rest beyond the database's own encryption. The competitor encrypts personal data fields; if the owner wants that, it is its own ADR.

## Privacy
The Privacy policy lists what is stored about employees; it needs a line for the driving licence number, class, expiry and emergency contact. Lawyer review is already pending.
