# STATE (append-only journal)

## 2026-10-21: Phase 0 started
- Plan approved (stack: Next.js + Supabase; tenancy: schema per tenant; v1 scope: core + attachment features).
- Scaffolded Next.js app, governance docs, ADR-001/002, initial SQL.

## 2026-10-21: Phase 0 complete
- Next.js app builds. Deps: pg, zod, supabase-js/ssr, recharts; dev: vitest, tsx, pglite.
- `db/public/0001_platform.sql` and `db/tenant-template/0001_core.sql` written and verified via `npx tsx scripts/check-sql.mts` (PGlite): idempotent, two isolated schemas, state-machine guard, self-approval block, immutable audit log, views query.
- Known nit: seeding role_permissions fires the audit trigger (noisy audit rows). Fix in migration 0002 by creating audit triggers after seeds.
- Removed next/font/google (build sandbox has no external network); revisit with self-hosted fonts.
- Next: Phase 1 (tenant provisioning, migration runner, lib/db/tenant.ts, can(), isolation tests).

## 2026-10-21: Feature added, preventive maintenance due tracking
- Migration 0002: service_types (oil_change, 3 months), settings (pm_warning_days=14, pm_warning_km=500), vehicle_service_baselines, job_card_lines.service_type_key, views v_service_last_done and v_pm_status, permission service.manage.
- check-sql.mts now applies all tenant migrations in order and asserts ok / due_soon / overdue / no_history / scheduled, plus a completed job resetting the clock and a km-only due_soon. All pass.
- Open decisions: km interval default (left off), warning window (14 days assumed), who is notified (manager + custodian assumed).
- Not wired yet: UI, notifications, dashboard tile (Phases 2, 3, 7, 8).

## 2026-10-21: Feature added, odometer from tracker or monthly entry
- Migration 0003: odometer_readings (validated, flagged not overwritten), vehicle_trackers, tracker_integrations, odometer_cycles/submissions with open/submit/approve/reject functions, job-card-to-reading trigger, v_odometer_status, v_pm_status gains km_data_stale, attachments accept odometer_submission.
- check-sql.mts: each migration now applied twice in order; 13 new assertions (flagging, override with note, tracker-skip in cycles, job card reading, stale flag). All pass.
- Not built: tracker sync worker (needs provider name), UI, reminders for open cycles.
- Open decisions: tracker provider; max plausible km/day (800 assumed); stale threshold (45 days assumed); whether admin may enter on a driver's behalf (allowed, recorded in submitted_by).

## 2026-10-21: Tracker integration deferred
- Decision: monthly entry only in v1; tracker is a later opt-in module. See PLAN.md decision section.
- 0003 rewritten before any deployment: removed vehicle_trackers, tracker_integrations, tracker.manage; monthly cycle now covers every active vehicle; v_odometer_status drops tracker columns. 'tracker' stays a valid reading source.
- check-sql.mts green (tracker assertions replaced). 

## 2026-10-21: Clarification
- Tracker integration is v2 (not a v1 phase). No code change.

## 2026-10-21: screens aligned with the database
- Added db/public/0002_invitations.sql and db/tenant-template/0004_forms_alignment.sql so every field on the designed screens has a column and every multi-table save has one SQL function (`onboard_vehicle`, `verify_invoice`).
- Fixed: invoice verification had no payable amount, so vehicle cost would have counted what the workshop asked for. Verifier-not-approver rule was documented but not enforced in SQL; now enforced in `verify_invoice`.
- Fixed: re-tagging the reason at approval overwrote the driver's reason; original now kept.
- check-sql: 53 passing assertions. Map in docs/FORM-DB-MAP.md.
- Open: no-sign-in driver link vs "no unauthenticated endpoints"; flag-rule views not written.

## 2026-10-22: Phase 1 done (tenancy, db door, migrations, can())
- Added src/lib/db/{types,pg-driver,tenant,migrate,provision}.ts, src/lib/auth/can.ts, scripts/migrate-tenants.mts, ADR-003.
- tests/tenancy.test.ts: 38 passing. Covers provisioning rollback, cross-tenant isolation, search_path not leaking, disabled/suspended resolution, role x permission matrix, migrations across tenants, drift, edited-migration refusal, one failing tenant not blocking others.
- Not tested against a real Postgres yet (PGlite only). Needs a DATABASE_URL to run scripts/migrate-tenants.mts.
- Not built: login/session wiring (Supabase Auth), in-schema RLS policies, invitation accept flow.
- Next: Phase 2 master data (vehicles, employees, vendors, custody, CSV import) once Supabase vs Neon is chosen for the first live database.
