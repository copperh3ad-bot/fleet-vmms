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

## 2026-10-22: Phase 3 done (job cards)
- Migration `0006_job_cards.sql` (tenant) and platform `0003_storage.sql`, both applied to the live demo project through the runner; drift check says no drift. ADR-005.
- Database rules: approval needs an approver who is the signed-in user, not the requester, with `jobcard.approve`; approver and (after submission) requester cannot change; cards start as drafts; every status change needs an event row (checked at commit); `job_card_events` is append-only and ordered by `seq`. Attachment path must start with the tenant folder.
- SQL functions `create_job_card`, `edit_job_card`, `transition_job_card`. App: `src/lib/jobcards/{schemas,service,attachments}.ts`; `transitionJobCard` is the only status entry point. Notifications are written in the same transaction.
- Screens: job card list, new (desktop and phone, repeating cost lines), edit, record with decision panel (approve with re-tag, send back, reject, assign vendor), history, photos/PDF upload, notifications page and nav count.
- Storage: private bucket `attachments`; policies limit users to their tenants' folders; file type checked by signature, 10 MB, 12 files per card.
- Tests: 43 new (jobcards 32, attachments 11), 127 total, pass on PGlite and local Postgres 17. `check:sql` updated for the new rules. tsc, eslint, build clean. Rolled-back live smoke: create, self-approval blocked, second user approves, 3 events, 0 cards left (the job number sequence advanced, so the first real card is JC-000002).
- Security advisor after the change: nothing new (same INFO and function search_path WARNs as before, intended). Open WARN: Auth leaked-password protection is off; it is a dashboard setting.
- Not tested: real Storage upload and download (only a fake store; policies were checked to exist, not exercised), all screens in a browser, phone camera upload, HEIC preview (shows as a file tile).
- To try it as one person: the owner needs a `fleet_manager` membership and an employee record linked to their login; raise a card "on behalf of" an employee, then approve it.
- Not built: budget display on the review screen (Phase 5), vendor quotation steps (Phase 4).

## 2026-10-22: decisions after Phase 3
- Owner's membership in `demo-fleet` changed from `tenant_admin` to `fleet_manager` (by the owner, in the Supabase SQL editor) so the workflow screens can be tried alone. One role per workspace, so `admin.users`/`admin.settings` are not held for now.
- ADR-006: drivers send odometer readings through a single-use signed link (owner approved). Exception to rule 5, with limits written down. Not built yet.

## 2026-10-22: Phase 4 done (vendor flow)
- Migration `0007_vendor_flow.sql` (applied to the live demo tenant through the runner, no drift): `submit_quotation`, `approve_quotation` (issues the work order), `reject_quotation`, `vendor_start_work`, `vendor_complete_work`, `submit_invoice`; vendor views `v_vendor_job_requests`, `v_vendor_quotation_lines`, `v_vendor_invoices`, `v_vendor_work_orders` extended; `transition_job_card` redefined so a rejected quotation returns to the same vendor. ADR-007.
- App: `src/lib/vendorflow/service.ts`, `src/lib/notify.ts`. Screens: vendor portal (`/vendor`: waiting for quotation, work orders; quotation form; work order with start, done, invoice form pre-filled from the quotation), quotation approve/reject and work order/invoice summary on the job card page, close button, finance invoice list and invoice check (approved vs invoiced, lines not in the quotation flagged, three decisions).
- Tests: 13 new (`tests/vendorflow.test.ts`), 140 total, pass on PGlite and local Postgres 17. Covers the full flow with every notification, vendor isolation (views, functions, column names), step order, one open invoice, returned invoice replaced, quotation reject and re-quote, segregation, a permission check for each step, and tenant isolation. Two real bugs found by the tests and fixed before applying: rejecting a quotation lost the vendor, and the "invoice already open" message was shadowed by the status check.
- Live smoke (rolled back): assign, quote, approve, work, invoice with an extra line, finance check (3400 vs 3000, 1 unapproved line), verify, close, 11 events, another vendor sees nothing. Nothing left behind.
- Not tested: all screens in a browser; the vendor login end to end (needs a vendor Auth user, created by hand for now).
- Known: a page opened by a role without the permission shows an error page instead of a friendly "not allowed" (Phase 9). No quotation or invoice attachments yet. Cannot switch to a different vendor once a quotation exists.

## 2026-10-22: odometer link done (ADR-006)
- Platform migration `0004_odometer_links.sql` and tenant `0008_odometer_links.sql` applied to the live project through the runner, no drift.
- Public route `/o/<token>` (the one exception to rule 5): shows plate and month, accepts one number, saves it as "submitted" for an admin to approve; it never touches `odometer_readings` itself. Single use, 48 hours, revocable, same message for every kind of dead link, hashed at rest, rate limited, headers `no-store`/`no-referrer`/`noindex`.
- Admin screens: Odometer (start a month, make links for every vehicle still waiting, copy or WhatsApp, enter a phoned-in reading, approve with note when flagged, reject, close month). New permission use: `odometer.review` (fleet manager, tenant admin).
- Tests: 17 new (`tests/odometer-link.test.ts` 16, routing 1), 157 total, pass on PGlite and local Postgres 17. Checked on a real `next start`: unknown token gives the generic page with the three headers; bad-shaped paths and workspace paths redirect to /login. Rolled-back live run: links made, page shows plate, typo refused, send ok, second use refused, odometer unchanged until approval.
- Deviation, written in ADR-006: no separate Postgres role (see "As built"); in-memory rate limit. Both for Phase 9.
- Not tested: the admin screens and the driver page in a browser or phone, WhatsApp hand-off, clipboard copy. The pooled production environment's `x-forwarded-for` handling is unverified.
- My `pkill` to stop the test server also stopped the dev server on port 3000; I restarted it.

## 2026-10-22: Phase 7 done (compliance)
- Migration `0009_compliance.sql` (applied to the live demo tenant through the runner, no drift): `claim_document_reminders()`, and `attachment_guard` now checks the target exists for every entity type. ADR-008.
- App: `src/lib/compliance/{schemas,service,reminders}.ts`; the attachment code in `src/lib/jobcards/attachments.ts` now has a shared core (`saveAttachment`, `listAttachments`, `deleteAttachment`) used by job cards and compliance. Screens: Compliance (status cards, filters, list, "no document on file" list, add or renew, record page with history and scans), Accidents (list, record, detail with photos, link to raise a repair job card), Challans (list, add, mark paid/disputed/reopen).
- Reminders: `npm run reminders` (`scripts/send-reminders.mts`), every active workspace, one notice per step (60, 30, 14, expired), tightest only when entered late, never twice, safe to run concurrently. Not a web endpoint.
- Tests: 20 new (`tests/compliance.test.ts`), 177 total, pass on PGlite and local Postgres 17. Reminder cases: each step once as the date moves, late entry gives one notice, far-away gives none, renewal starts fresh and the replaced document gets no "expired", recipients, custom thresholds, inactive vehicles, three simultaneous runs, a failing or suspended workspace. Rolled-back live run: 1 reminder, 0 on the second run, nothing left behind.
- Not tested: the screens in a browser, file upload against real Storage, a real scheduler.
- Needs your decision when hosting is chosen: where the daily reminder job runs.
- Housekeeping: a stray `src/.next` and `src/tsconfig.json` (made by a mis-placed `next typegen`) were deleted; they were never committed.

## 2026-10-22: Phases 5-6 done (budgets, analytics, settings, why it keeps breaking)
- Migration `0010_analytics.sql` (applied to the live demo tenant through the runner, no drift): `setting_num()`, `v_repeat_repairs` with the repeat window and `is_repeat`, `flag_jobs_90d`, `flag_repeat_days`, `flag_cost_multiple`, `v_vehicle_flags` (adds budget near/over and document expired/due). ADR-009.
- App: `src/lib/analytics/service.ts` (flags, cost overview, why it keeps breaking), `src/lib/control/{service,settings}.ts` (budgets, settings per key with its own permission, service rules). Screens: Reports (flags, totals, spending by month, reason, vehicle, workshop, driver; 3/6/12/24 months), Why it keeps breaking (repeat repairs, workshops whose work came back, reasons, busiest vehicles, requester vs manager reason), Budgets (add, change with reason, usage bars), Settings (service rules add/edit, due-soon warnings, alerts and flags, reminders and odometer).
- Tests: 19 new (`tests/analytics.test.ts`), 196 total, pass on PGlite and local Postgres 17. Covers repeat window and exclusions, each flag against its setting, peer comparison needing 3 vehicles, budget usage and flags, overlaps, reason-on-change, cost by month with empty months, payable amount over estimate, retag counts, every report permission, per-key settings permissions (mixed form refused whole), service rule limits by vehicle class.
- Live: views queried read-only on the Supabase demo tenant (empty data, no errors).
- Not tested: the screens in a browser; the reports with realistic volumes; the Settings screen as a tenant admin (the owner is now `fleet_manager`, who cannot change reminder days or odometer limits by design).
- Note: stray ` 2` duplicate files keep appearing under `.next` (and once under `src`); the project folder is inside iCloud-synced Documents, which is the likely cause. I delete them; moving the project outside iCloud would stop it.

## 2026-10-22: Phase 8 done (dashboard and CSV exports)
- No migration. ADR-010.
- Dashboard (`src/lib/dashboard/service.ts`, workspace home): blocks by permission: job cards waiting for your approval (not ones you raised), quotations to decide, approved with no workshop, invoices to check, checked and ready to close, odometer readings to review and vehicles still to send one, your drafts and sent-back cards, documents expired or expiring; fleet at a glance for `report.view` (vehicles, service overdue, flags, spend this month vs fleet budget, job cards in progress by stage); "Your vehicle(s)" with service and document status for whoever holds one. Workshops are redirected to their list.
- CSV exports (`src/lib/exports/*`, route `/w/[slug]/export/[kind]`): vehicles, job cards, invoices, documents, accidents, challans, budgets, costs by vehicle, repeat repairs, flags. Per-export permission, "own" scope and screen filters respected, formula injection neutralised, byte order mark, 50,000 row cap, audit log entry per export. Export buttons on the list pages and reports.
- Tests: 19 new (`tests/dashboard-exports.test.ts`), 215 total, pass on PGlite and local Postgres 17, including the 50,001-row cap, injection through a workshop name, scope, audit, and each dashboard block per role. Live rolled-back run on the demo tenant: dashboard and all ten exports (invoices refused for a fleet manager, as designed). Signed-out export request redirects to /login.
- Not tested: the dashboard and downloads in a browser; opening the files in Excel or Sheets; very large real data sets.
- `tsconfig.json` now excludes duplicate files named like "routes.d 2.ts" (iCloud duplicate files in `.next`), a workaround not a fix.

## 2026-10-22: security check (npm, secrets, Supabase advisors)
- `npm audit`: 5 high, all one chain: `eslint-config-next` -> `@next/eslint-plugin-next` -> `fast-glob` -> `micromatch` -> `braces` 3.0.3 (denial of service through deeply nested glob patterns). All dev tooling; `npm audit --omit=dev` reports 0 vulnerabilities, so none of it ships. No fixed version of `braces` exists (every version is listed as affected) and the suggested `npm audit fix --force` would downgrade `eslint-config-next` to 14.x under Next 16, so it is not applied. Accepted risk: only reachable if someone feeds the linter hostile glob patterns on a developer machine. Re-check when `braces` or `fast-glob` publish a fix.
- Other dependencies: nothing outdated that matters for security (`pglite` 0.5.11, `react` 19.3.1 are patch releases, test and UI only; take them with the next dependency update).
- Secrets: no project ref, connection string, key, tenant schema name or user id in any tracked file or anywhere in git history; `.env.local` is ignored; `.env.example` has empty values only.
- Supabase advisors: no new kind of finding. INFO "RLS enabled, no policy" now 8 tables (added `public.odometer_links`): intended, only the server connection reads them. WARN "function search_path mutable" 44 functions, all in tenant schemas: intended, tenant functions must resolve names in the schema the request chose, and none is `security definer`. WARN "leaked password protection disabled" is still open: a dashboard setting (Authentication, Passwords) that may need a paid plan; owner to check.

## 2026-10-22: Phase 9a done (hardening part 1)
- Migrations: platform `0005_rate_limits.sql`, tenant `0011_hardening.sql`, applied to the live project through the runner, no drift. ADR-011 (also updates ADR-006).
- Shared rate limits (database-backed, hashed keys, atomic, fallback if the database is down) on sign-in and the odometer link; function not callable through Supabase's public API.
- Odometer link now runs as database role `odometer_link` (no table access, two `SECURITY DEFINER` functions). Remaining limit written down: not a wall against arbitrary SQL in that path, because the app's login can switch role back.
- Audit review: 4 unaudited tables found and fixed (`attachments`, `reason_codes`, `roles`, `permissions`); a test now fails for any future table that is neither audited nor excused with a reason.
- Friendly "not allowed" page for pages opened without permission (Next `forbidden` mechanism).
- Tests: 227 total (9 limiter, 4 role, 1 audit coverage added or reworked), pass on PGlite and local Postgres 17. Live (rolled back): link page, send, second use refused, four forbidden queries denied; limiter allowed exactly 3 of 5 simultaneous tries.
- Fixed on the way: rate limit validated the window after dividing by it (error message was "division by zero").
- Not tested: the "not allowed" page in a browser (mechanism relies on Next's digest convention), sign-in limit through the real login form.
- Still open in Phase 9: plan-limit enforcement, demo seed data, onboarding.
