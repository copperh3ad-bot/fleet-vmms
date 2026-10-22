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

## 2026-10-22: Phase 1 verified on real Postgres 16
- Supabase free limit reached (2 projects: MerQuant ERP, textile-manager-pro; neither touched). User chose Neon free for now; no connection string yet.
- Ran the 38 tenancy tests against a local real Postgres 16 (TEST_DATABASE_URL=postgres://...). All pass, including search_path not leaking across transactions and failed provisioning rolling back DDL.
- Run: `TEST_DATABASE_URL=... npx vitest run`. migrate-tenants.mts --check correctly reported drift left by the test's fake 0005/0006 migrations.

## 2026-10-22: first live database
- Supabase project created by the user (new account). Platform tables (public) and one demo tenant ("Demo Fleet Co", slug demo-fleet) applied, migrations 0001-0004 recorded with checksums so scripts/migrate-tenants.mts sees no drift. Not Union Fabrics: real data goes in a separate tenant later.
- Verified on the hosted DB with a rolled-back smoke test: onboard_vehicle sets odometer, PM status shows ok, duplicate plate blocked, audit rows written.
- Security advisor: 7 INFO (platform tables have RLS and no policies: intended, only the server connection reads them). 20 WARN "function search_path mutable": intended, the tenant functions must resolve names in whichever tenant schema the request set. Tenant schemas are not in the API's exposed schemas.
- Applied via the Supabase connector, not the runner (no DB password in the sandbox). Next: user puts DATABASE_URL in .env.local; then wire Supabase Auth (login) and create the owner membership.

## 2026-10-22: login wired (not yet exercised with a real user)
- Added Supabase email+password sign-in (src/lib/supabase/*, src/proxy.ts, /login, /, /w/[slug]), requireUser/requireMembership, listWorkspaces, getDriver. Only /login and /api/health are open; everything else redirects to /login (checked against a running build).
- Next 16 here uses proxy.ts (not middleware.ts) and Cache Components: pages that read cookies/params sit inside Suspense.
- Same generic error for every failed sign-in. No sign-up page: users are created by an admin (Supabase dashboard for the first owner, invitations later).
- 39 tenancy tests pass; next build passes (scripts/ excluded from tsc; check-sql.mts runs via tsx).
- Blocked on: first owner account + DATABASE_URL in .env.local. After that: link owner to demo-fleet (employee + tenant_admin membership).

## 2026-10-22: Phase 1b done (first owner, real sign-in)
- Owner linked to `demo-fleet` as employee + `tenant_admin` via a single inserts-only statement (Supabase connector). No schema change.
- `migrate-tenants.mts --check` against the live DB: no drift. Signed in locally: workspace page shows role tenant_admin, 10 permissions, 0 vehicles.
- Routing rules extracted to `src/lib/auth/routing.ts` (guard + post-login destination); `tests/routing.test.ts` adds 5 tests. 44 tests total.
- Fixed Next 16 dev error "unstable value Date.now() while prerendering" on `/w/[slug]`: `requireUser` now calls `connection()` first so token check and DB work run per request.
- Note: `tenant_admin` has 10 of 20 permissions. It has no `jobcard.*`, `quotation.*`, `invoice.*`, `odometer.submit`, `workorder.update`. Intended by separation of duties; to test workflow screens the owner also needs a `fleet_manager` membership or a second user.
- Not tested: sign-in failure path in a browser; the `connection()` fix was not re-verified in the browser.

## 2026-10-22: Phase 2 done (master data)
- Migration `0005_master_data.sql` (applied to the live demo tenant via the runner, no drift): permissions `employee.manage`/`vendor.manage`, unique employee number and vendor name, `change_custody()`, `end_custody()`. ADR-004.
- `src/lib/master/{schemas,csv,service}.ts`: every function calls `authorized()` first. Screens under `/w/[slug]/`: vehicles (list, search, status filter), add a vehicle (via `onboard_vehicle`), vehicle record (details, PM status, custody history, change/return custody, status), CSV import (preview with row errors, all-or-nothing import), employees, vendors. Nav hides links the role cannot use.
- Tests: 40 new in `tests/master.test.ts` (permission matrix 6 roles x all actions, duplicate plates in any spelling, custody history and `custodian_on`, own-scope visibility, tenant isolation, CSV parser and import). 84 total, all pass on PGlite and on a local real Postgres 17 (`TEST_DATABASE_URL=... npx vitest run --no-file-parallelism`; files must run one at a time on a shared DB).
- Live smoke test of the real code against the Supabase demo tenant in one rolled-back transaction: add vehicle, custody change, duplicate plate, import preview, list. Nothing persisted.
- Not tested: the screens in a browser (no automated UI tests; Playwright is planned for the end-to-end flow), CSV upload through a real browser file picker, mobile layout.
- Screens built from `docs/FORM-DB-MAP.md` field lists. The Claude Design canvas was not readable from this session, so layout and labels are my reading, not a match to the boards.
- Known: the existing pages use a light palette and do not yet handle dark mode.
