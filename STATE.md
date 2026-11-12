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

## 2026-10-22: Phase 9b done (invite-only onboarding, plan limits, demo data)
- Migrations: platform `0006_plan_limits_invites.sql` (max_users trigger, vendor on invitations), tenant `0012_plan_limits.sql` (`plan_limit()`, max_vehicles trigger). Applied to the live project, no drift. ADR-012, `docs/OPERATIONS.md` (the commands you run).
- Owner decision: invite only. Workspaces are created by `scripts/create-workspace.mts` (prints one owner invitation link); plans by `scripts/set-plan.mts`; demo data by `scripts/seed-demo.mts` (refuses a workspace with vehicles). `provisionTenant` can now create an empty workspace with no owner.
- Users screen (`admin.users`): invite (link shown once, copy/email/WhatsApp), resend, cancel, change role/scope, disable. Rules: not yourself, never the last administrator, workshops only by invitation. Public page `/invite/<token>` (second exception to rule 5, written into CLAUDE.md): create an account with the invited email. Home page lists invitations waiting for a signed-in person's confirmed email.
- Plan limits enforced by database triggers (vehicles, users; sold vehicles and workshop logins do not count), shown as "N of M" on Vehicles and Users.
- Tests: 26 new (admin 17, demo seed 8, routing 1), 253 total, pass on PGlite and local Postgres 17. Live (rolled back): invitation, preview, accept, link dead afterwards, plan limit refusing a vehicle and an invitation with plain messages. The scripts were run against the local test database. Public invite page on a running server: unknown token gives the generic page, bad-shaped path redirects to login.
- Not tested: creating a real account through the identity provider (needs a real test email; depends on its sign-up and email-confirmation settings), the Users screen in a browser, the home-page accept button.
- Phase 9 is complete apart from what the ADRs list as not built. The scheduler for `npm run reminders` still needs a hosting decision.

## 2026-10-22: Design alignment, part 1 (shell, daily screens, odometer, vendor, breaking, budgets)
- Done to match the 18 boards: tokens and IBM Plex, sidebar shell, login, dashboard, vehicles list and record, new job card and one-step review (approve and assign together), invoice check, workshop pages and scorecard, odometer cycle review, "Why it keeps breaking", Budgets (fleet position with pace projection, over/near/on-track per vehicle, set a budget, copy to next year, alert levels).
- New migrations: tenant `0013_design_views.sql`, `0014_vendor_assigned_at.sql`. Applied live, no drift.
- Kept: ADR-006 (no photo on the odometer link; link page shows plate and month only), post-login workspace chooser. Skipped: manager and weekly-summary alerts (no sending channel).
- Tests: 312 total, pass on PGlite and local Postgres. Typecheck, lint and production build clean.
- Not tested: any screen in a browser (no browser available to me), phone layouts.
- Still to restyle: compliance, accidents and challans, add vehicle, service rules, users, list pages (job cards, vendors, employees, invoices, notifications, reports costs), mobile job card wizard and mobile odometer.

## 2026-10-22: Design alignment, part 2 (compliance) and smoke test
- Compliance restyled to the board: four cards, type chips with counts, documents table with time-left pills, add or renew panel and reminder days beside it.
- Demo seed now opens this month's odometer cycle (two normal readings, one held as lower than on file, the rest not yet in), so the odometer screens are not empty on demo data.
- New `tests/smoke-screens.test.ts`: seeds the demo workspace and runs the data behind every screen as six roles. Every loader must answer for at least one role; no role may get anything but an answer or a refusal. 314 tests pass on PGlite and local Postgres; typecheck, lint, build clean.
- Not run: the same seed against the live project (the seed refuses a workspace that has vehicles, and I will not seed real data without you saying so). Screens still not seen in a browser.

## 2026-10-22: Who can raise job cards
- Vehicle users (requester) are always limited to the vehicle they hold: forced on invitation and on role change, shown as one fixed choice on the invite form. Enforced when a card is raised and when vehicles are listed.
- Administrators can now raise job cards for any vehicle (tenant migration 0015, one permission row). Approval stays with fleet managers; the database still refuses an approver who is the requester.
- Tests: 316 pass on PGlite and local Postgres. Not applied to the live project yet (run scripts/migrate-tenants.ts). Existing live requesters invited before this keep their old scope until changed on the Users screen.

## 2026-10-22: Standalone build for beta
- `output: "standalone"`, a Dockerfile (non-root, health check) and docs/DEPLOY.md (environment, build, run, checklist before the first tester). Built and run locally from a copy outside the repo: /api/health 200, login 200, everything else redirects to login, odometer link headers intact.
- Not tested: the Docker image (the Docker daemon was not running here), the app on a public address, real sign-up through the identity provider.

## 2026-10-22: Beta deployed on Netlify
- Project fleet-vmms-beta, production deploy by hand (`netlify deploy --build --prod`), no git remote yet. Public address https://fleet-vmms-beta.netlify.app. Environment variables set in Netlify, values not printed anywhere.
- Checked on the live address: /api/health 200; /login 200; everything else redirects to login; a well-formed but dead odometer link and invitation link give the generic page with no-store headers on the odometer link.
- Not tested: sign-in and sign-up through the identity provider (its Site URL must be set to the Netlify address first), a real workspace page with data, uploads above about 6 MB (Netlify function limit), whether DATABASE_URL is the pooled connection.
- Still to do before testers: Supabase Site URL and redirect, apply tenant migration 0015, create the beta workspace, schedule `npm run reminders`.

## 2026-10-22: Design alignment complete, deploy gaps closed (ADR-013)
- Every screen now follows the boards or, where no board exists, the shared components: accidents and challans (one screen, driver from custody, optional repair job card, files), add a vehicle (sections, ready-to-save checklist, save and add another, photo and registration scan), service rules (switches, timing, flags, what the manager sees), users and roles (people and invitations together, role table, invite panel), list pages (job cards, vendors, employees, invoices, notifications, reports, odometer months), the phone job card (four steps, photos at creation) and the phone odometer page (within ADR-006).
- New migrations: tenant 0015 (administrators raise job cards), 0016 (files on a vehicle); platform 0007 (append-only log of access changes).
- Deploy gaps: DATABASE_URL confirmed pooled (port 6543); photos shrink in the browser and the file limit is 4 MB so requests stay under Netlify's 6 MB; daily reminders run as a Netlify scheduled function; tenant migration 0015 applied to the live workspaces; vehicle users are always limited to their own vehicle.
- Tests: 326 pass on PGlite and local Postgres 17. Typecheck, lint and production build clean.
- Not tested: any screen in a browser, phone layouts, the file picker's photo shrinking, uploads to real storage, sign-up through the identity provider, the scheduled function actually firing.
- Not built (decisions with the owner): photo and last reading on the odometer link (ADR-006), manager and weekly-summary alerts, "last seen" on people.

## 2026-10-22: Paused (resume here)
- Live: https://fleet-vmms-beta.netlify.app, workspace `beta`, owner signed in. All migrations applied (tenant to 0016, platform to 0008, no drift). Last deploy matches the last commit.
- Next, in order: (1) collect what the owner sees while testing and fix it; (2) owner decides whether to load demo data into `beta` (`scripts/seed-demo.mts --slug beta`); (3) owner decides on the odometer-link photo and last reading (ADR-006) and the alerts channel; (4) turn on Supabase leaked-password protection (dashboard); (5) SaaS path: owner picks invitation-first or public signup, then git remote and CI, browser tests (Playwright), email delivery, custom domain, backups and monitoring, pricing and billing (CLAUDE.md rule 7: no prices until decided), legal pages. The gap table is in the chat history and summarised in the assistant's memory (beta-deployment).
- Housekeeping still open: move the project out of iCloud; `fleet-vmms-design.zip` and the `.textClipping` file are untracked and must not be committed.

## 2026-10-23: Phase 10a done (dedicated database per organization, ADR-014)
- Decisions (owner): self-serve SaaS, a dedicated Neon database per organization, USD 149 per month, 3-day trial, bank transfer first with card providers later. CLAUDE.md rules 5 and 7 changed, rule 9 added. Plan in docs/PLAN-SAAS.md.
- Built: `db/control` (registry columns, `user_orgs`, `link_routes`, `invite_index`; applied live, existing organizations stay `shared`), a routing driver (`src/lib/db/router.ts`, `getDriver()` returns it) that sends each organization's work to its own database, encrypted connection strings (`src/lib/crypto/secretbox.ts`, key `ORG_DB_KEY`), providers `neon` and `local` (`src/lib/orgs/db-provider.ts`), a resumable provisioning state machine (`src/lib/orgs/provision.ts`), fleet-wide migration and drift for every organization database (`src/lib/orgs/fleet.ts`, `scripts/migrate-tenants.mts`), `scripts/check-routing.mts` (read-only live check).
- Reworked on the control plane: sign-in lookup and workspace list (`can.ts`), invitations and acceptance (retry-safe if the control step fails), open odometer links, create-workspace script, reminder job (now routed).
- Tests: 360 pass on local Postgres, 356 pass and 4 skip on PGlite. New: encryption, router (pool reuse, eviction, rollback), providers (Neon mocked, local real), provisioning (resume, retry, budget, abandon, idempotence), flows across two databases, fleet migrations (one database down), and an end-to-end run on a second real Postgres database with the restricted odometer role.
- Live: control migration applied; sign-in lookups checked read-only for `beta` and `demo-fleet`; no behaviour change for them.
- Not tested: the Neon API itself (no account or key yet), creating many databases, latency from Netlify to a far database, the `-pooler` Neon host with transaction mode.
- Next: phase 10b (sign-up, trial, onboarding). Needs from the owner: NEON_API_KEY, ORG_DB_KEY generated and set on Netlify (I can generate it), bank details, terms and privacy text.

## 2026-10-23: Phases 10b and 10c built (sign-up, trial, billing by bank transfer, operator screen)
- Sign-up: landing page (price read from the plan), `/signup`, check-email with resend, `/auth/callback` (turns the confirmation code into a session, fixed destination), `/setup` with a resumable progress page, `/terms` and `/privacy` as marked drafts, shared site shell. Nothing is built until the email is confirmed; one waiting row and one trial per address; rate limits on every open form. PUBLIC_PATHS lists exactly the open pages (CLAUDE.md rule 5 updated).
- Trial and lock: `org_billing` (price copied from the plan: USD 149, 3 days), access worked out from dates (`src/lib/billing/state.ts`), one gate in `requireMembership` for every page and action; billing page, invoices and the data export stay open when locked; links, invitations and reminders stop. Existing organizations were given no-charge rows and are never locked.
- Billing by bank transfer: customer files a claim with a receipt (4 MB, photo or PDF, kept in the organization's own folder); operator confirms or rejects on `/admin/payments`; confirming issues a numbered invoice (immutable), extends the paid period, and is logged under the operator's name. Printable invoice page. Operator pages: organizations, one organization (lock, waive billing, extend trial, record a payment, delete a database with typed confirmation), payments, settings (bank details, seller details, PKR rate, support email). Daily billing notices, once each.
- Found and fixed on the way: file storage policies depended on the control database's membership table, which dedicated organizations do not fill (control migration 0004 moves them to the login index); the build rejected non-async exports in action files; embedded migrations went stale (a test now guards that).
- Tests: 403 pass on local Postgres; 399 pass and 4 skip on PGlite. New: billing state, sign-up and claiming, payments and operator, billing reminders, embedded migrations, public paths.
- Control migrations 0002 to 0004 are NOT applied to the live control database yet.
- Not tested: the Neon API itself, a real sign-up through Supabase (email confirmation and the callback), storage policies on live, every new screen in a browser, bank details and invoices with real values.
- Needs from the owner: Neon account and API key, bank details, seller details, terms and privacy text, an operator login (`make-operator.mts`), the Supabase Site URL and redirect list (add /auth/callback), Supabase captcha decision.

## 2026-10-23: SaaS code deployed (sign-up closed until a Neon key exists)
- Live control database: control migrations 0001 to 0004 applied, row security on every table in `public` (found and fixed one tracking table the Supabase advisor flagged), storage policies now use the login index. `check-routing` read-only check passes for `beta` and `demo-fleet`. Existing organizations are comped (never locked).
- Netlify: new code deployed; landing page shows USD 149 per month from the plan, terms and privacy are marked drafts, `/signup` says sign-up is not open yet, `/setup`, `/admin`, `/w/*/billing` and `/auth/callback` send signed-out visitors to sign-in. Variables set: ORG_DB_PROVIDER=neon, NEON_REGION, ORG_DB_KEY (secret; a copy is in the owner's home folder, `~/.fleet-vmms-org-db-key`, mode 600). NOT set: NEON_API_KEY.
- The owner's login is an operator (can open `/admin`).
- Still needed to open sign-up: NEON_API_KEY on Netlify; Supabase Site URL and redirect list must include `/auth/callback`; bank details, seller details, PKR rate and support email on `/admin/settings`; real terms and privacy text.
- Not tested end to end: a real sign-up (email confirmation through Supabase), the Neon API, the new screens in a browser, a first real payment.

## 2026-10-23: Back to the shared database, many organizations at once (ADR-014 amended)
- Owner decision: leave Supabase as it was and make the product work for many organizations at the same time. New sign-ups now get a schema each in the control database (`ORG_DB_MODE` unset = shared); the dedicated-database mode stays in the code, tested, off. Sign-up no longer needs Neon, so it is open.
- Isolation, because it matters most: `tests/cross-org.test.ts` seeds two organizations (shared and dedicated variants) and searches every screen's data for a trace of the other; it was shown to fail when a filter was removed. `tests/tenant-filters.test.ts` fails on any query on a multi-organization table that names no organization. On a shared database this is enforced by the application, not the database (stated in the ADR).
- Many at once: six sign-ups at the same moment with the same company name each got their own schema and web address.
- Latency: web app region moved Ohio -> Tokyo (next to Supabase); one lookup per request; token checked on the server. The Singapore Supabase project was created and then paused (not deleted); `.env.sg` and the cutover script are removed.
- Netlify: ORG_DB_PROVIDER and NEON_REGION removed. ORG_DB_KEY kept (only used in dedicated mode).

## 2026-10-24: company maintenance policy
- Each company can upload its own vehicle maintenance policy (PDF or photo, up to 4 MB) at /w/<slug>/policy. Dated versions; newest is current, older kept. Tenant migration 0017 (table maintenance_policies, attachment kind, permissions policy.manage for admin and fleet manager, policy.read for all but workshops). Stored in the company own folder; tests/maintenance-policy.test.ts includes a two-company leak check.
- Fixed a time-zone flake in tests/compliance.test.ts (compared the database date with a UTC date).

## 2026-10-24: policy rules each company tunes
- Four settings on the Maintenance policy page, all off at 0 (tenant migration 0018, permission policy.manage): replacement age (new flag replacement_due on vehicles), accidents covered per driver plus months between (cover shown on accident list and detail, src/lib/compliance/cover.ts), driver share percent of repairs (excludes routine service, wear items, accident damage).
- Not built yet: inspections twice a year with ratings, one-time fit-out cap, entitlement by designation, replacement after promotion. Need new tables or designations; see chat.

## 2026-10-24: reading an uploaded policy (ADR-015)
- Manager presses Read this policy on the Maintenance policy page. PDF with text is read as is; a scanned PDF or photo is read with Tesseract on our server (no outside service). Plain patterns find replacement age, accidents covered, months between, driver share, oil change interval, plus notes it cannot apply yet. Manager ticks findings and applies; the server applies its stored findings through saveSettings and saveServiceRule. Tenant migration 0019 (policy_readings).
- Verified on a real 4-page scan: all four policy settings and the oil interval found correctly; tyre interval missed (table too messy). Packaged reader proven by running it from a copy of the built output outside the repo. Not verified on the host itself.
- Not done: registration book, insurance, compliance document, challan, quotation and invoice parsing (next step, pre-fill forms for review).

## 2026-10-24: pricing page and joining a company (ADR-016)
- /pricing (public). Company code on the Users page; /join and /join/workshop (public) make a request; approval = ordinary invitation. Control migration 0005 (tenants.join_code, join_index), platform migration 0009 (join_requests). Isolation test in tests/join.test.ts, shown to fail when the company filter is removed.
- Public copy corrected: no longer says each company has a private database.
- Not done: notification to the administrator when a request arrives; email to the person on approval (no mail service beyond Supabase confirmation mail).

- 2026-10-24: a new join request now notifies everyone who can manage users (in-app) and shows a count on the Users link. No email yet.

## 2026-10-24: tax for customers in Pakistan (ADR-017)
- Tax added on top of USD 149; invoice in USD with rupee amounts; no rate built in. Control migration 0006 (tax_rules, org_tax, invoice tax columns and snapshot, invoice_certificates). Customer enters tax details on Billing; operator manages authorities and certificates on /admin/tax and withholding overrides on the organization page.
- NOT in use until the operator sets: seller sales tax registration, PKR per USD, at least one authority, and the customer fills its details. Rates must be confirmed with a tax adviser (see ADR-017 list). No credit notes yet.

## 2026-10-24: scenarios, ledger, certificates, dated rates (ADR-018)
- Country at sign-up; tax scenarios (operator Tax page): outside Pakistan = no tax, Pakistan = authority rate in rupees, owner can add more. Rupee conversion at the rate for the payment date (operator Rates page; forex.pk fetch OFF until written consent is recorded in Settings; manual always works). Ledger on /admin/accounting (balanced journal per invoice, reversals, trial balance, tax by month, CSV). Withholding certificates WHC-YYYY-NNNNNN issued by the customer (invoice page) or the operator. Control migrations 0007 and 0008. Scheduled function netlify/functions/fx-rates.mts.
- Bank details for payments set in live Settings (Bank AL Habib, account title UROOJ AZHAR). CNIC and address from the bank certificate were deliberately not entered.
- Still empty and needed before the first Pakistani invoice: seller registration, PKR fallback or a rate, an authority and its rate, withholding defaults. All to be confirmed with a tax adviser.

- 2026-10-24 correction: the bank details were cleared again at the owner's request; payment bank details are empty in live Settings. Seller name and NTN (from the FBR registration certificate) are set; sales tax registration, seller address and rates are not.

## 2026-10-24: full system check and browser beta test
- Report: docs/BETA-TEST-2026-10-24.md. Browser test in e2e/ (npm run e2e). Read-only live health check: scripts/audit-system.mts.
- Fixed: sign-up hydration error, lost dropdown choices after a failed save, workshop could open Billing, three pages scrolled sideways on phones, unlabelled file field, low-contrast grey text, session cookie readable by scripts, sign-in page without sign-up or join links, rupees shown to customers abroad, empty labels on invoices, API-role table privileges (control migration 0009, NOT yet applied to the live database).
- Open decisions are listed in the report (Administrator cannot approve job cards, placeholder terms and privacy text, empty live settings).

## 2026-10-24: Fleet OTG name and logo everywhere, wage-based public pricing, forgot password
- Brand: logo in every header, sign-in, favicon; hardening (security headers, error pages, runbook docs/OPERATIONS.md). Domain www.fleetotg.com pointed at Netlify; HTTPS certificate and Supabase redirect URLs were still being set up by the owner.
- Public pages (landing, pricing, sign-up box, terms) say the price is the monthly wage of an unskilled labourer; no figure shown. The plans table still holds USD 149 and Billing inside a workspace still shows it. Tiered prices by subscription length are not designed yet.
- Forgot password (ADR-019): /forgot-password (public, rate limited, same answer for every address), /auth/callback?next=reset, /reset-password (needs the emailed-link session; ends other sessions). The runbook had wrongly said this existed before.
- Not yet live: commits since e895ec2 and migration 0009 are not deployed or applied.

## 2026-10-24: sign-in fix, About us, Contact us, animated home page
- Sign-in now moves on from the browser (server redirect used the wrong host on www). About us page (ADR-020). Contact us page (ADR-021): public form stores one row in public.contact_messages (control migration 0010, NOT yet applied live), operator inbox at /admin/messages. Home page: animated sample dashboard (CSS only, stops for reduced motion), scroll-reveal cards. Vehicles CSV has the holder employee ID.
- Needs the owner: run scripts/migrate-tenants.mts (0009 and 0010) and deploy. The contact form errors until 0010 is applied.

## 2026-10-24: offline job card form (ADR-022); deploy of the sign-in fix, About, Contact, animated home page
- Deployed to production (www.fleetotg.com): sign-in fix, forgot password, About, Contact (form errors until control migration 0010 is applied: the permission system blocked the live migration, owner must run scripts/migrate-tenants.mts), animated home page, employee ID in vehicles CSV.
- Offline job card form: blank .xlsx download with drop-downs, filled form upload creates a DRAFT job card through createJobCard (same checks). Not deployed yet.

## 2026-10-24: crawler files, link previews, phone icon (ADR-023)
- robots.txt, sitemap.xml and security.txt are public; every page has a canonical link and its own link-preview tags with a 1200x630 share picture; apple-icon added. From audit items 3 to 5. Not deployed yet.

## 2026-10-24: emails sent by the app (ADR-024)
- POST /api/auth/send-email: Supabase Send Email hook, signed (Standard Webhooks), sends through any SMTP service (SMTP_URL, EMAIL_FROM, AUTH_HOOK_SECRET in Netlify). Covers sign-up confirmation, resend, join-with-code, password reset. Setup steps in docs/OPERATIONS.md, "Email". NOT live until the owner sets the mail service, the three settings and the Supabase hook (rollout order matters).

## 2026-10-24: invitations tied to an employee code; sign-in names for people with no email (ADR-025)
- Every invitation (except a workshop) names a role and an employee code; accepting links the login to that employee record. People with no email get a sign-in name, set their own password from the link, and sign in with the name. An administrator makes a one-time reset link for them. Needs SUPABASE_SERVICE_ROLE_KEY in Netlify and control migration 0011 + public migration 0010 (NOT applied live). Not deployed.

## 2026-10-25: recovery code closes the administrator-takeover hole (ADR-025)
- A reset link for someone with no email now also needs a recovery code only the person knows (hash only, control migration 0012, NOT yet applied live); five wrong tries an hour per person. "Replace login" for someone who forgot both. Not deployed.

## 2026-10-25: invitation links go to a phone number only (ADR-026)
- Phone number required on every invitation (international form), link box offers only WhatsApp and text message to that number (no copy, no email, link not shown), reset links go to the phone on the employee record. Invite form keeps its inputs after an error; single-column layout fixed. Not deployed.

## 2026-10-25: premium surface and 3D wheel on the home page (ADR-027)
- Shared pieces restyled (panels, number cards, buttons, sidebar, table rows) so every signed-in screen changes together; a 3D wheel with a route network sits behind the home page headline, loaded only on wide screens with motion allowed (about 86 KB, separate download). Browser test 144 passed (accessibility and phone-width checks included), unit tests 618 passed (one old timezone-dependent test fails only between 00:00 and 05:00 Pakistan time), no new vulnerabilities. E2E_SHOTS=1 now keeps a picture of each signed-in screen in e2e/shots.

## 2026-10-25: dashboard polish and a get-started walk-through (ADR-028)
- Dashboard: welcome band, icons on number cards, gradient charts, and wording that made no sense with no data fixed (currency on spend, no empty buttons or bars).
- New companies see a nine-step "Get started" list on the dashboard; each step is marked done from the company's own data and shows what it will light up. Per-role steps; hidden per person with a cookie; no migration. Tests: 3 new unit tests, a new browser step (put away, remembered, brought back); browser test 93 passed, unit 621 passed (the one failure is the old timezone-dependent ledger test, only between 00:00 and 05:00 Pakistan time).

## 2026-10-25: own-vehicle portal, optional costs, administrator approval (ADR-029)
- A person limited to their own vehicle sees only the dashboard (with what their vehicle has cost) and the job cards of their vehicle; all other pages refuse. Job card costs are optional for the person raising the card. The administrator may approve a card they raised (tenant migration 0020, NOT yet applied live: run scripts/migrate-tenants.mts).
- Also this day: home page built ahead of time, public-site menus and footer, signed-in visitors see Open workspace, new logo and tagline, wording pass, sign-up says when an email already has an account, mail password kept out of logs.

## 2026-10-25: workshop estimate link, quotations list, viewport and link checks
- ADR-030: single-use /q/<token> link to the workshop phone; estimate saved against the job card. Needs platform 0011, control 0013, tenant 0022 run on live.
- Quotations page; browser test now checks 5 widths and crawls every link; cost reconciliation test added.
- Open: reports and some pages still hard-code PKR instead of the workspace currency.

## 2026-10-28: sign-up email, mailboxes and search/answer-engine optimisation (ADR-031)
- Sign-up and reset emails now go out through Resend from noreply@fleetotg.com. The Supabase Send Email hook is answered by a small Netlify function (netlify/functions/send-email.mts) because the whole page server needs about 4 seconds to wake and Supabase waits 5 (ADR-024).
- Operator settings gain Billing email and Sales email beside Support email; app emails carry a Reply-To (EMAIL_REPLY_TO).
- ADR-031: JSON-LD (Organization, WebSite, SoftwareApplication, FAQPage, breadcrumbs), one FAQ source for page and markup, a static /features page, /llms.txt, AI search crawlers named in robots.txt, /q/ added to private prefixes. No price, rating or customer claim is put in markup.
- Open for the owner: add the site to Google Search Console and Bing Webmaster (submit /sitemap.xml); the share picture still has the old colours; real customer quotes or numbers would help most once they exist.

## 2026-10-28: Terms and Privacy drafts (ADR-032)
- Full balanced drafts for customers and owner; who "we" are, the address and the governing law come from Settings (placeholders show until entered). Draft notice stays until a lawyer reviews.

## 2026-10-28: workshops never sign up (ADR-033)
- Invoice link beside the estimate link; both can be sent by phone (WhatsApp, text) or emailed to the workshop. Sending an invoice records the work as done.
- Email replies: unique reply address per emailed request, Resend inbound webhook (/api/inbound/email), files saved on the job card, flagged "received by email, needs entering"; staff type the figures in with the same form (history names them).
- Needs, before deploy: platform 0012, control 0014, tenant 0023 and 0024 run on live. Owner set-up in docs/OPERATIONS.md ("Workshop email replies"). Done: workshop sign-up page and links removed, vendor role no longer invitable. Open: delete the now-unreachable vendor portal code and its tests.

## 2026-10-28: AI reads workshop documents (ADR-034), a separate stream from the non-AI tag
- Drafts only, a person approves. Staff press a button on the entry page; Claude Haiku 5.5 (cheapest that reads PDFs and photos, AI_MODEL to change) reads the emailed file with prompt caching on, returns a checked draft that fills the form; the history says read by AI and checked by <name>.
- Off until an organization's administrator switches it on (Vendors page, recorded who/when); no key, no feature; AI_DOCUMENT_READING=off stops it everywhere. Every use logged in ai_actions with tokens, cache use and whether the draft was saved unchanged or corrected.
- Needs before use: platform 0013, tenant 0024 and 0025 on live; ANTHROPIC_API_KEY in Netlify. Not started: auto-approval, chasing, triage, briefings.

## 2026-10-28: Basic and Pro plans (ADR-035), workshop scoring design (ADR-036)
- Basic = existing plan renamed (same price). Pro = Basic + AI, priced in fleet-size bands entered by the owner in Admin, Plans (no amounts in code; a test enforces it); each band sets the AI readings per day. Reading with AI is gated by plan on the server; a Pro trial gets 10 readings.
- Rollout: Phase 1 Basic only; Phase 2 Pro offered as an upgrade to organizations entering more than 20 job cards a day (30-day average; setting). Pricing page says Pro is coming until the owner sets bands.
- Not built: moving plans by payment in Billing (step 2), vendor scorecard and AI workshop recommendation (ADR-036, needs owner decisions listed there).

## 2026-10-28: live chat, trial countdown (ADR-037)
- Trial banner is a live countdown to the end of the free trial, counted from the server's measure (not the device clock); calm, warning in the last day, urgent in the last hour; refreshes the page when it reaches zero.
- Zoho SalesIQ chat button on the public pages and in the workspace, set up by pasting the widget code into Admin, Settings. Public address /api/chat-config. Privacy policy updated (SalesIQ tracks visitors by default; the owner may turn that off in SalesIQ).


## 2026-10-28: fallback point and resume document
- Tag fleet-otg-resume-2026-10-28; read docs/RESUME.md first next session (what is live vs built, migrations to run, owner inputs, open Pakistan-only instruction with its two questions, build order).
- Added in this stretch: vehicle sheet before sign-up and Excel import, free trial limited to 10 vehicles (setting), ADR-038. Chat, trial limit and vehicle sheet still need tests.

## 2026-10-28: Pakistan only, and bank details only in an emailed bill (ADR-039)
- Sign-up is fixed to Pakistan (flag PAKISTAN_ONLY in src/app/signup/form.tsx, reversible); foreign-customer flows hidden, not removed. No bank, tax or account-holder wording on public pages or the Billing page.
- Billing has a "Request bill" button: the administrator is emailed a generated bill (number, payment reference, amount with tax or the net for a withholding customer, bank account and note from Admin, Settings); a copy without the bank account goes to the Billing mailbox. 3 requests an hour per organization; button hidden until bank details are set. No migration.
- Production build fixed: SupportChat (ADR-037) is wrapped in Suspense in the root layout; it had blocked prerendering of /w/[slug]/job-cards since commit 1ea1f93.
- Tests: bill, chat, trial limit and vehicle sheet added (773 unit tests pass, 0 fail). Browser suite: 221 passed, 3 failed in the public scenario (country picker), fixed; that scenario rerun 74 passed, 0 failed. Scenarios s1, s2 and s5 now follow the Pakistan-only form and read the bill from the test outbox.
- Owner ran the migrations on live (platform 0012-0013, control 0014-0015, tenant 0023-0025). Not yet deployed. Open: browser console 404 on /signup seen once, source not found; the customer's tax-details form is still on the Billing page.

## 2026-10-29: people, WhatsApp (ADR-041, ADR-042)
- Employees are only added with an invitation: one form on the Users page, every box required (name, number, department, phone, role, and an email or a sign-in name), employee record and invitation in one transaction (`addEmployeeWithInvite`). The Employees page edits only. Adding now needs `admin.users` and `employee.manage`.
- The invitation link is also emailed; "Send a new link" keeps its row on screen (the row is keyed by who is invited). Vehicles: "Import data" is the primary button. Production build fixed earlier (SupportChat in Suspense); the logo link no longer prefetches `/`.
- One-time code before an invitation makes an account: 6 digits sent on WhatsApp to the number the administrator typed, hash only, 10 minutes, 5 tries, 5 sends, 60 s apart; off until WhatsApp sending is set up. Needs platform migration 0014.
- WhatsApp through Meta's WhatsApp Business Platform (owner's own account, no Twilio): `src/lib/whatsapp.ts`. Workshops: "Ask on WhatsApp" sends an approved template with a button to the one-time link; a reply to that message (PDF, photo or short text) is filed on the job card like an emailed reply, matched by the message it answers (hash kept in `quotation_links.reply_code_hash`). New public address `/api/inbound/whatsapp` (signature-checked, in CLAUDE.md rule 5). Drivers' odometer replies not built.
- 805 unit tests pass; browser suite last full run 225 passed (before the code and WhatsApp work). Not deployed: platform 0014 must run first. The AI maintenance-policy parser was requested and planned but not started (see docs/RESUME.md).

## 2026-10-30: AI reads the maintenance policy (ADR-043)
- "Read with AI" button on the Maintenance policy page, beside the plain reader. The model returns a checked draft of the rules it found (value plus the quoted sentence); stored as the policy's reading (`source = 'ai'`), reviewed and applied by a person through the existing apply step. Same gates as ADR-034 (Pro, administrator's AI switch, trial allowance, limits, `ai_actions` log). Tenant migration 0026 (`ai_actions` can anchor to a policy; `policy_readings.source`, `ai_action_id`).
- Files: `src/lib/ai/policy.ts` (gates, storing), `src/lib/ai/policy-draft.ts` (schema, prompt, checks), `readPolicyFile` in `src/lib/ai/claude.ts`, `tests/ai-policy.test.ts`. 819 unit tests pass; type-check clean for `src`. Not run against the real API. Privacy policy wording needs a line for the company's own policy. Not deployed: platform 0014 run by owner, WhatsApp Netlify variables pending; tenant 0026 must run on live before deploy.

## 2026-11-04: deployed to production
- Owner ran platform 0014 and tenant 0026 (confirmed with `migrate-tenants.mts --check`: shared no drift, 0 dedicated organizations), then deployed to https://www.fleetotg.com (Netlify deploy 6aeae1bb9f8b5a18ab741e98): add-and-invite employee (ADR-041), emailed invitation link, WhatsApp code step, WhatsApp requests and replies for workshops (ADR-042), AI policy reader (ADR-043). Build compiled and type-checked; `/api/inbound/whatsapp` is in the route list.
- WhatsApp: the Fleet OTG number (phone number ID 1471993539322498) is linked and registered on Meta. Still open: Netlify variables, approved templates, webhook subscription, app set to Live, business verification. The code step stays off until the access token and phone number ID are set. Not run against real Meta, not run against the real Anthropic API.

## 2026-11-04: wide screens, public design pass, WhatsApp template block, resume point
- Deployed ADR-041/042/043 (see the entry above), then wide-screen containers (`fcdbc80`): public shell, landing, admin, workspace top bars and vendor pages grow at 1536px and up; reading-width pages unchanged.
- Landing and login design pass (`9267e69`, not deployed): clickable repair walkthrough with example data, assurance strip, line icons, FAQ accordion, closing band, login brand points. Other public pages still to do.
- WhatsApp: number linked and registered, Netlify variables set by the owner. `fleetotg_code` (authentication) cannot be created: Meta refuses with code 10, subcode 2388185 in the Manager and the Graph API. Business not verified; owner to file a Meta support case and start Business Verification. `fleetotg_request` is approved but categorised MARKETING. Invitation code step stays unusable until `fleetotg_code` is approved.
- Resume point: tag `fleet-otg-resume-2026-11-04`, `docs/RESUME.md` ("Update 2026-11-04").

## 2026-11-05: legal name, design pass on Features and Pricing, competitor gap ADRs
- Deployed the operator legal name in the footer and About us (`cae77fb`, `97fae59`) for Meta Business Verification; Meta also wants the phone number tied to the business (document or business email), still open with the owner.
- Features and Pricing redesigned with shared `PageHero` and `CtaBand` (`04a35e6`, not deployed). About, Contact, Sign-up and Join still to do.
- Compared a competitor brochure (VMS & Fleet Management) with Fleet OTG for the fleet part only. ADR-044 (driver licences, cost per km, workshop downtime; tenant migration 0027) and ADR-045 (trip requests and gate passes as an optional module; migration 0028) written, both proposed, nothing built. ADR-045 waits on four owner decisions listed in it.

## 2026-11-06: invitation code by email (ADR-046), licences and downtime built (ADR-044)
- ADR-044 built and committed (`21563b8`): driver licences with expiry reminders, cost per kilometre, time in the workshop; tenant migration 0027. Production database project was paused by Supabase on 2026-11-05 and restored by the owner; migration 0027 still to be run on live.
- ADR-046: `INVITE_CODE_CHANNEL` (unset or whatsapp = as before, email, off). Email codes go to the invited address, never with the link; people invited by sign-in name still use WhatsApp, because email cannot reach them. Unit tests added; browser suite not extended. SMS left for the owner to decide.
- ADR-047: invitation code by SMS (`src/lib/sms.ts`, Twilio and Plivo by REST). `INVITE_CODE_CHANNEL` is now an order of preference: auto/whatsapp = WhatsApp then SMS, sms = SMS then WhatsApp, email = email then SMS then WhatsApp, off. Unit-tested with a fake fetch; never run against a real provider; Pakistan delivery and sender-name registration unchecked (see the ADR). Owner to choose and open a provider account.

## 2026-11-06: ADR-045 phase 5a built (trips, approval, pool-car pick and drop)
Migration 0028 (not yet applied to live), src/lib/trips, /w/[slug]/trips pages, tests/trips.test.ts (20). Module off by default (settings.module_trips). Overlap rule is a locked trigger, not btree_gist. Logistics role + trip.dispatch for pick and drop; vehicles.is_pool. Gate passes (5b), reports (5c), Privacy line, e2e scenarios not done. Undeployed.

## 2026-11-06: ADR-048 phase 48a built (operating departments, logistics maintenance)
Migration 0029 (not applied to live), dept_ok on read paths, write guards, pool-car rule, dept_approval_limit setting, tests/dept-scope.test.ts. 896 unit tests pass, build OK. Migrations 0028 and 0029 both pending on live. Engine hours (48b), department column on vehicle lists, browser scenarios, and ADR-045 5b/5c not done. Undeployed.

## 2026-11-07: ADR-048 phase 48b built (engine hours)
Migration 0030 (applied nowhere yet: not on live), src/lib/hours, hours on the vehicle page, job card form and wizard, service rules and Settings, cost per hour on Reports and as an export, tests/engine-hours.test.ts (15). Also removed a duplicate `module_trips` entry from the settings list. 910 unit tests pass (the known ledger date flake apart), build OK. Not deployed; run migration 0030 on live with the deploy.

## 2026-11-07: ADR-048 phase 48c built (department on vehicle lists)
Vehicle list shows the vehicle's own department with a Department filter (and "No department"); vehicles export has a Department column and filter; CSV and Excel import take an optional `department` column. `tests/dept-lists.test.ts` (7), browser scenario 8 (`e2e/s8-departments.mjs`). Cost by department and a department field on Add vehicle are not built. 48b migration 0030 and its code are live (deployed 2026-11-07); 48c is code only, no migration.

## 2026-11-07: ADR-049 the app sends invitations from its own WhatsApp number
`sendWhatsAppInvite` and `WHATSAPP_INVITE_TEMPLATE`; the administrator is never handed the link when it is set. Template `fleetotg_invite` submitted to Meta (pending; id 3658937344263786). Not deployed, and the Netlify variable is not set: owner to confirm approval and a payment method on the account first. Tests in `tests/whatsapp-invite.test.ts` (5).

## 2026-11-07: ADR-048 engine hours through the driver link (migration 0031)
`0031_hours_link.sql` (not applied to live), the link page asks for the hour meter for vehicles that track hours (odometer optional for them), approval writes the hour reading, bulk approval skips submissions with hours. `tests/hours-link.test.ts` (9). Gate passes move to migration 0032. 938 unit tests pass; browser suite not yet run on this. Not deployed.

## 2026-11-07: ADR-050 the monthly odometer request on WhatsApp (built, not deployed)
Tenant migration 0032 and control migration 0016 (neither on live), `src/lib/odometer/whatsapp.ts`, scheduled function `odometer-whatsapp.mts`, the reply handled in the WhatsApp webhook, settings `odometer_whatsapp` and `odometer_send_day`, `tests/odometer-whatsapp.test.ts` (12). Hour-meter vehicles excluded. Template `fleetotg_odometer` NOT yet created in Meta and `WHATSAPP_ODOMETER_TEMPLATE` not set. Gate passes move to migration 0033.

## 2026-11-07: ADR-051 payment emails (built, not deployed) and template fleetotg_odometer submitted
Control migration 0017 (`payment_claims.submitter_email`, not on live), `src/lib/billing/payment-mails.ts`, wired into the Billing "I have paid" action and the operator's confirm and reject; `tests/payment-mails.test.ts` (9). Billing mailbox is `billing_email` (finance@fleetotg.com on live). WhatsApp template `fleetotg_odometer` submitted as Utility (id 1202664728769977), pending Meta review; `WHATSAPP_ODOMETER_TEMPLATE` not yet set.

## 2026-11-07: ADR-052 rupee pricing support and Add vehicle drop-downs (built, not deployed)
`taxFor` handles a plan priced in PKR (rate 1, no conversion), the invoice page no longer says "at Rs X to the dollar" for a rupee plan, `tests/pkr-plan.test.ts` (4). The live plan price is still USD 149: the owner sets the rupee amount and currency in Admin, Plans. Add vehicle: Make, Model (by make) and Year are drop-downs with Other, `src/lib/master/vehicle-catalog.ts`, `tests/vehicle-catalog.test.ts` (4). Browser suite 232 passed.

## 2026-11-07: ADR-053 NTN required for invoices, one tax authority, no withholding (built, not deployed)
Confirming or recording a payment is refused without the customer's NTN (Pakistan). The Billing page asks for company name, NTN and address only; withholding is always off; a customer with no chosen authority falls under the single active one. `tests/ntn-required.test.ts` (6). Owner still has to enter the SRB rule and rate, the SRB registration number and the rupee plan price in Admin.

## 2026-11-07: ADR-054 driving licence compulsory at invite (built, not deployed)
`addEmployeeWithInvite` requires licence number and a valid expiry (class optional) and saves it in the same transaction; the invite form has the three boxes. Not asked: workshops, approved join requests, existing people.

## 2026-11-07: ADR-056 workshop WhatsApp templates (built, not deployed)
Six Utility templates submitted to Meta (estimate request, invoice request, estimate approved/declined, invoice accepted/queried); `src/lib/vendorflow/whatsapp-notify.ts`, wired into the quotation and invoice decisions and the request button; `WHATSAPP_REQUEST_TEMPLATE=fleetotg_request` set on Netlify production (takes effect at the next deploy). `tests/workshop-whatsapp.test.ts` (5). The six per-event settings are not yet set: wait for approval.

## 2026-11-07: ADR-055 joining with a code is confirmed by WhatsApp and needs a valid licence (built, not deployed)
Platform migration 0015, control migration 0018, tenant migration 0033 (none on live). Public confirm page `/join/confirm/<token>` (added to the public paths and CLAUDE.md rule 5), `fleetotg_confirm` template NOT yet created in Meta, `WHATSAPP_JOIN_CONFIRM_TEMPLATE` not set: until both, nobody can join with a code. Learner permits are a per-company setting (`allow_learner_licence`, off) for joins and invites. Unit and browser tests updated.

## 2026-11-07: ADR-055 correction: the join confirmation is a code, not a link (built, not deployed)
Meta rejected the link templates (`fleetotg_confirm` as Utility, `fleetotg_join_confirm` as Marketing: "incorrect category"). The confirmation is now a 6-digit code sent with the already-approved `fleetotg_code` template and typed on the "request sent" page; a cookie reference ties the page to its request. The confirm-link page, its public path and the CLAUDE.md rule 5 addition were removed. Platform migration 0015 (edited before it ever reached live), control 0018, tenant 0033 still to be run on live. No new Meta template and no new Netlify setting are needed.

## 2026-11-07: session end, resume point
Live is commit 12d1019 with every migration applied (platform 0015, control 0016 to 0018, tenant 0030 to 0033). 1,004 unit tests and the browser suite (229) pass. See docs/RESUME.md, section "Update 2026-11-07", for what is live, the WhatsApp/Meta state, the pending list and the standing rules. Tag fleet-otg-resume-2026-11-07.

## 2026-11-07: ADR-057 yearly offer, ADR-058 SMS removed, ADR-059 HR vehicle requests (built, not deployed)
PKR 43,000 a month (entered by the owner in Admin, Plans) with 12 months for the price of 11 (`billedMonths`). SMS code removed; SMS_* Netlify values unset. HR vehicle requests: new `hr` role, tenant migration 0034 (not on live), pages under /w/<slug>/vehicle-requests, deciders are the administrator and fleet manager, one open request per employee. Two Destinsolutions test organizations and their logins deleted from live. Checks: 1,008 unit tests pass, build OK, 0 lint errors.

## 2026-11-08: V1.1 job cards by WhatsApp and daily maintenance reminders deployed; resume point updated
Live is commit a5648e2 (tag fleet-otg-resume-2026-11-08) with platform 0016, tenant 0035 and 0036 applied. ADR-061 (job cards by WhatsApp, Pro only; never tried with real WhatsApp, needs ANTHROPIC_API_KEY and a Pro company with the switch on) and ADR-062 (maintenance-due reminders, one reminder email a day once a mail service is set up). 1,041 unit tests, browser suite 229 passed and 0 failed, 0 lint errors. V1.0 is tag v1.0.0 (294e3f9); V1.1 is tag v1.1.0 (a5648e2). See docs/RESUME.md, section "Update 2026-11-08".

## 2026-11-08: Compare plans page deployed
Live is commit 91e54a1: the public /compare page (ADR-063, no price in the page, plan names and figures read from the plans table) plus the investor flyer in marketing/investor-flyer (ADR-064, docs only). No migrations. 230 browser checks passed.

## 2026-11-08: prices entered on live; flyers use Meta Pakistan rates
The owner approved and the live plans table now holds Basic at PKR 43,000 a month (was USD 149) and Pro as one band with no vehicle limit at PKR 65,000 a month with 200 AI readings a day (Pro had no bands before). Written through setPlanPrice and setProBands, the same code as Admin, Plans; the figures are not in the repository (rule 7). Organizations already paying keep the price they joined at (only Fleet OTG, comped). Copy fixed: Pro is no longer "coming in the second phase" and a single band reads "One price for every fleet size" (pricing page, Compare page, FAQ, band label); needs a deploy to show. Flyers: investor flyer recomputed with Meta Pakistan rates and the cost of each extra 200 vehicles (ADR-064 revised), customer flyer shows Pro as live. Expected cost per extra 200 vehicles: Basic about USD 10 to 18, Pro about 10 to 40 a month.

## 2026-11-08: public site refreshed (not yet deployed)
Landing, Features, Pricing, About and Contact now carry the current feature set and six shared key selling points (src/lib/selling-points.ts): reminders by email, vehicle requests and departments, trips, and the two Pro features (AI reading, job cards by WhatsApp). Inner pages share a hero with a grid and highlight chips; About and Contact use it too. Copy no longer says Basic has "every feature" (it has every core feature) and Pro reads "One price for every fleet size". FAQ, llms.txt and the Pro price box updated. No prices written in code. Tests 1,046 pass, tsc and eslint clean; needs a deploy.

## 2026-11-08: price figures on /pricing only (ADR-065)
/pricing shows the actual price of each plan from the plans table (Basic and the Pro band). Every other page and flyer says Basic is a month of an unskilled labourer's wage and Pro costs less than a fleet manager's monthly salary. Customer flyer footer reworded; checked locally that the figures appear on /pricing only. Not yet deployed.

## 2026-11-08: V1.2 carbon footprint planned (ADR-066, nothing built)
Proposed only: per-vehicle CO2 from EPA tested figures (labelled fallbacks where a vehicle is not in the EPA data), kilometres from the monthly odometer readings, yearly report and reduction against a baseline year; carbon credits only as an evidence pack after an adviser confirms what a verifier needs, with no promise of credits. Open owner questions are listed in the ADR. Next free tenant migration stays 0037.

## 2026-11-08: site refresh deployed
Live is commit 13022e5: refreshed public pages, price figures on /pricing only (ADR-065), wording fixes, flyers. Live plans table holds Basic PKR 43,000 and Pro PKR 65,000 (one band). No migrations. Browser suite not run for this deploy (copy and layout changes; unit tests 1,046 pass).

## 2026-11-08: V1.3 gate passes and driver assignment planned (ADR-067, nothing built)
Proposed only: gate passes as designed in ADR-045 (security role, QR with number only, no public page, late-return reminder), plus driver assignment (availability-aware picker with leave and licence status, day sheet, My assignments, standing and recurring runs). Seven owner decisions listed. Migration numbers: 0037 is reserved for V1.2 if it ships first.

## 2026-11-08: V1.3 deferred
The owner deferred V1.3 (gate passes and driver assignment, ADR-067): it needs more design time. Nothing to build until the owner reopens it; the seven decisions in the ADR stay open. Gate passes (ADR-045 5b/5c) remain deferred with it. V1.2 (carbon footprint, ADR-066) is also plan only.

## 2026-11-08: plan switching by payment proposed (ADR-068, not built)
Step 2 of ADR-035. The claim names the plan and quotes the price; confirming switches the plan in the same transaction as the invoice and ledger; upgrade credits unused Basic time as Pro days; downgrade at period end switches AI and WhatsApp job cards off. Needs control migration 0019 (live only with the owner's yes). Owner decided: free 3-day Pro trial for Basic users, Pro from the next renewal after payment, downgrade at period end, any Basic customer may buy Pro, a trial company may pay for Pro directly. Three small assumptions listed in the ADR; build on the owner's go.

## 2026-11-08: plan switching by payment built, not yet live (ADR-068)
Control migration 0019 (claim quote and plan, invoice plan, pending switch, Pro trial dates, plan_changes with audit); new quote.ts and plan-switch.ts; the claim names the plan and quotes the price; confirming settles at the quote and switches Basic to Pro when the paid period ends (at once for a trial or lapsed company); downgrade at period end switches the AI and WhatsApp job cards off; a free 3-day Pro trial for Basic companies, once; tenantPlan works the plan in force out from the dates (no write) and the daily job persists switches and closes trials; Billing page "Basic and Pro" panel and plan choice on the claim; Admin Payments shows the plan. Pricing, Compare and FAQ say Pro is for busy fleets (the 20-job-card gate no longer applies). 14 new tests; 1,060 unit tests pass. Live migration 0019 and the deploy wait for the owner's yes. Next free control number: 0020.

## 2026-11-08: plan switching deployed (ADR-068)
Live is commit 87a710b with control migration 0019 applied (owner said yes). Browser suite: 230 passed, 0 failed, 9 findings (one new contrast finding on the landing Compare link, fixed). /pricing shows the figures and the new Pro wording. Not yet tried end to end on live with a real company: use Billing on a Basic company to take the Pro trial, and a test claim to see the Pro switch.

## 2026-11-08: public site illustrations deployed
Live is commit c373081: 19 inline SVG scenes (src/components/art.tsx) on the landing, Features, Pricing, Compare, About and Contact pages; sign-up and login unchanged. No migrations. Browser suite 230 passed, 0 failed, 8 known findings. Price figures still appear on /pricing only.

## 2026-11-08 Billing period choice and model-call caching
- Billing form: choose 1 month or 12 months (one free); amount fills in from plan and period. Pricing page and Billing show the 12-month price. Not yet deployed.
- AI calls: job card photos get a cache breakpoint; usage reading shared (`usageOf`); tests/ai-caching.test.ts. Fixed prompts (~700-900 tokens) are below the Haiku cache minimum, so the file breakpoint is what saves money.

## 2026-11-08 Pro trial for locked never-paid companies
- startProTrialAction now runs while the workspace is locked; the Pro trial reopens a never-paid company whose free trial ended, for the trial days. Suspended, comped and previously-paid lapsed companies are not reopened. Not yet deployed.

## 2026-11-08 Final RLS and RBAC checks, then hardening
- Live audit (read-only): public schema all tables RLS on; anon/authenticated hold no table grants, no tenant-schema USAGE, no public policies; storage bucket private; no public views; 190 service functions take a Membership and every write path reaches authorized/authorizedAny; role matrix is least-privilege (vendor: quotation/invoice submit and workorder update only; auditor read-only).
- Found and fixed in code (not yet live): tenant functions had the default execute-for-everyone grant and tenant views ran with owner rights -> tenant migration 0037 (also sets defaults for future objects). Headers: HSTS includeSubDomains, COOP same-origin, upgrade-insecure-requests, no-store on /w and /admin. tests/hardening.test.ts pins them.
- Open decision: storage policy scopes by organization but not by role, so a workshop or driver token could read any file in its own company folder through the storage API. Fix needs files served only by the server (ADR-025 change).

## 2026-11-08 Files through the server only (ADR-069)
- Storage reads, writes, deletes and signed links now run on the server with the service key (admin.ts), guarded per caller by blob-store.ts; WhatsApp webhook saves media through the inbound saver (it had no storage rights before). Control migration 0020 drops the bucket policies for signed-in people. Order: deploy, check files open and save, then apply control 0020 and tenant 0037. Not yet live.

## 2026-11-08 Activity log, form reset fix, wording (ADR-070)
- activity_log (control 0021): actions, auth, security refusals, page views, webhooks, job steps, errors; append-only, 400-day purge, operator screen Admin > Activity + CSV. Not yet live: apply control 0021 first, then deploy.
- Add-vehicle and billing claim forms no longer lose drop-down picks after a message (keepForm). Browser scenario 9 pins it.
- Users page and sign-up wording corrected (workshops are not invited; licence for staff only; fleet size vs trial allowance).

## 2026-11-08 Unlisted vehicle names with operator review (ADR-071)
- Owners type an unlisted make/model; vehicle saves at once; name recorded for review (control 0022); own list shows it immediately; Admin > Vehicle names approve/merge/reject. Years back to 1950. Browser scenario 9 covers it.
- Pending live: control migrations 0020 (storage server-only), 0021 (activity log), 0022 (vehicle names) and tenant 0037. Deploy first, then apply.

## 2026-11-08 Live: deploy 05206b2, control 0021 and 0022 applied
- Control migrations 0021 (activity log) and 0022 (vehicle names) applied on live; both tables have row security on, no rights for the API roles; the log refuses update and delete. Live logging confirmed (page views arriving with the right path).
- Still pending on live, held on purpose: control 0020 (storage rules removed; apply only after the owner has added, opened and deleted a job card photo on the live site) and tenant 0037 (function grants and view rights; safe to apply, no dependency).

## 2026-11-08 Live: tenant 0037 applied
- Tenant 0037 applied to beta; destinsolutions (created after the deploy) already had it. Every function in both schemas is closed to PUBLIC and every view runs with the caller rights. The link roles keep exactly their named functions (inbound_mail 5, odometer_link 2, quotation_link 4), the same set a freshly built schema gets.
- Still pending on live: control 0020 only (apply after the owner has added, opened and deleted a job card photo on the live site).

## 2026-11-08 Live: control 0020 applied; vehicle save defect fixed (not yet deployed)
- Control 0020 applied: the storage bucket has no policy for browser roles; as authenticated and anon a token sees 0 of the files and cannot add one. All file access is the server (ADR-069).
- Defect found by the new activity log on the live site: saving a vehicle with an insurance expiry but no policy number gave a server error (insurance_policies.policy_no is not null). Fixed in the vehicle schema (blank policy number becomes "Not recorded yet"); any other missing required value now gives a plain message instead of a server error. Unit and browser tests cover it.

## 2026-11-08 Live defect: every file upload fails (service key invalid)
- Cause (Supabase storage log): "signature verification failed" for every upload since files moved to the server key (ADR-069). The SUPABASE_SERVICE_ROLE_KEY in Netlify is not valid for this project. Uploads worked before only because they used the person token.
- Added: reason in storage errors, logged to the activity log; Admin > Settings > Check file storage. Fix needs a valid key set by the owner, then redeploy and press the check. Control 0020 is already applied, so the old token route is closed too: until the key is fixed, uploads stay down.

## 2026-11-08 Admin decides own work only when alone (ADR-072); clean checked test builds
- Tenant 0038 (admin_may_decide_own) built, deployed with the app; apply on live after the owner says so. Until applied the database keeps the old rule and the screens fall back to it.
- Render-time logging no longer uses after() (logSoon); ACTIVITY_LOG=off kill switch. e2e builds from scratch and checks for missing script files (e2e/check-build.mjs). Full browser suite 237 passed, 0 failed.

## 2026-11-08 Live: tenant 0038 applied (ADR-072)
- Applied to beta and destinsolutions. Each has one active member who can approve (the administrator), so the administrator may still decide their own work; the moment a second approver is added the exception ends. Function closed to PUBLIC (0037 kept).
- Still held: nothing pending on live. Open on the owner: valid service key in Netlify then press Admin > Settings > Check file storage; Zoho mail values; Utility appeal.

## 2026-11-08 Storage fixed; keepForm on every form that holds a choice
- Owner set a valid legacy service_role key; Admin > Settings > Check file storage passed and the Supabase storage log confirms save/read/delete.
- keepForm (no reset after an error) now also on the job card form and phone wizard, accident form, document form, job card decision panel, invoice decision and the workshop estimate and invoice forms. With the old code the job card form cleared both vehicle and reason after an error; browser scenario 9 pins it for three forms.

## 2026-11-08 Live: deploy a3d472a (forms keep their picks after an error)
- Deployed from a clean build after the full browser suite passed (240 passed, 0 failed). Live pages and all 145 static files load. Nothing pending on live. The decision panels and workshop forms use keepForm but have no browser scenario yet.

## 2026-11-08 Make/Model drop-downs hold a typed pick (not yet deployed)
- Typing into Make left it on Choose: it was controlled by React and the form re-rendered on every input. Make and Model are now uncontrolled (browser keeps the pick, React only reads it for the model list). Scenario 9 types into every drop-down at laptop and phone size.

## 2026-11-08 Second QA report: workshop links, invitation email, join screen, search, phone dashboard (ADR-073)
- Workshop quote/invoice/email-estimate 500 = commit-time event check ran as the restricted link role (permission denied for table job_card_events). Fix: tenant 0039 (check runs as owner). Tests now run as a non-superuser (scripts/test-live-like.sh, e2e/run.sh). 0039 NOT yet applied on live: apply after deploy, on the owner yes.
- Invitation email had an empty link (blanked admin copy reused): fixed (inviteLinks). Join screen explains the WhatsApp code step. Vehicles Show sends the text; dashboard Service due table scrolls on a phone.

## 2026-11-08 Live: tenant 0039 applied (ADR-073)
- Applied to beta and destinsolutions. job_card_event_required is now security definer (owner postgres, search_path pinned, not executable by PUBLIC); both deferred triggers present; link roles keep exactly their functions (quotation_link 4, inbound_mail 5, odometer_link 2) and still cannot read job_card_events. Deployed commit 29a0446. Not yet seen: a real workshop quote through a live link (the tester retries with the unused links on JC-000002 and JC-000003).

## 2026-11-08 Manual test runbook kept in the repo
- docs/MANUAL-TEST.md is the tester runbook corrected for live 29a0446 (known issues table in section 16 is current). Still needs a real phone or WhatsApp number for role accounts, rule B and the driver odometer link.

## 2026-11-08 Decision panel fix, rule B scope (ADR-074), +92 phone format
- Decision panel on a job card was sent as `<form action>`, so a server message cleared the chosen Reject/Approve option. Now `keepForm`. New browser scenario 10 (`e2e/s10-decision-forms.mjs`) failed before and passes after (commit 216fb21).
- Tenant migration 0040 (ADR-074): `admin_may_decide_own(permission, vehicle, amount)`. Another approver counts only if they could decide that card (department and limit). Tests in `tests/dept-scope.test.ts`. NOT applied on live: apply 0040 before the next deploy, on the owner's yes. The `self_approved` flag was judged unnecessary (see ADR).
- Default phone format is `+92` then the number: placeholder, hints, messages and display; `0300…` still accepted. 1,125 unit tests pass. Browser suite re-run in full: 253 passed, 0 failed (includes new scenarios 10 and 11).
- Live regression report 2026-11-09 answered: Logistics seeing 0 vehicles is the department rule (ADR-048), not a defect. Built: empty-page notes for department logins, "<department> vehicles only" on the Users page and its invite/edit forms, two new steps in browser scenario 8 (254 + 138 browser steps pass, 1,126 unit tests pass). The 403-versus-200 on denied pages is not changed (streaming; see ADR-074); denied page is noindex. Open question for the owner: Administration as its own department (ADR-074).
- Owner decision 2026-11-09 (ADR-075): Logistics handles the complete fleet but stays a department role. Tenant migration 0041 adds `role_departments.sees_all_vehicles` (true for logistics); `dept_ok` and the write guards use `acting_dept_scoped()`; limits, pool cars and dispatch still apply; rule B counts Logistics for every vehicle. A role with the flag off stays limited to its department (pattern for a future Administration role). Tests: new `tests/dept-whole-fleet.test.ts`; four older files run in scoped mode. 1,133 unit and 256 browser steps pass. **Apply tenant 0040 and 0041 on live before the next deploy, on the owner's yes.** Still undecided: Administration role/approver, and whether the tenant administrator approves job cards at all.
- **Deployed 2026-11-09** (commit 8be58bb... plus earlier): tenant 0040 and 0041 applied on beta and destinsolutions (no drift), clean build, https://www.fleetotg.com health/home/login 200.
- Beta switch for the WhatsApp codes (ADR-076): platform setting `otp_checks` on Admin > Settings; `off` asks for no code on invitations or when joining (the request goes straight to the administrator), and skips the three-an-hour limit per phone number so testers may share numbers. Tests: `tests/otp-switch.test.ts`, `tests/invite-otp.test.ts`, browser scenario 4 (two new steps). **Built, not deployed, switch not turned off on live.** Scenario 11 now also verifies the invoice and closes the card.
- Rule B tightened (ADR-077, tenant migration 0042): the administrator decides their own job card, quotation or invoice check only while they are the only active employee (workshops, disabled members and uninvited people do not count); otherwise a Fleet manager or Logistics person decides. Supersedes ADR-072's test and ADR-074's per-card scope test (tests/admin-sole-employee.test.ts replaces those). FAQ and About wording updated. **Tenant 0042 NOT applied on live; ADR-076's switch and this change are built, not deployed.** The `ledger` as-of test no longer depends on the machine's time zone. 1,145 unit and 262 browser steps pass.
- New browser scenario 11 (`e2e/s11-workshop-flow.mjs`): emailed estimate link, estimate sent with no account, link is single-use, manager approves and a work order is issued, emailed invoice link, invoice stored. It stops at the invoice being on the job card: the administrator's invoice check and closing are not driven yet. Still not seen on live: a real workshop quote through a live link.

## 2026-11-09: custody handover on the same day (tenant 0043)
Regression R7 observation: Change custody on a vehicle created the same day left the old holder in place (the rule refused a start date on or before the current holder's start). `change_custody` now lets a handover dated the day the holder started replace them (the zero-day row is removed; the audit log keeps it); earlier dates are still refused. Unit test in tests/master.test.ts, browser step in scenario 8. Tenant 0043 NOT yet applied on live; the fix needs it. Live otherwise at 5467971 with 0040-0042 applied.

## 2026-11-09: V1.4 phase A live; keep-warm ping
Tenant 0043 and 0044 and control 0023 applied on live (no drift); deployed. Phase A of ADR-078 (vendor types, outsourced trips, quotes from several logistics providers, award, Pro feature) is live; phases B (WhatsApp quote and invoice links) and C (rate cards, reports) are not built. A scheduled function (netlify/functions/keep-warm.mts) pings /api/health and /login every four minutes against cold starts. The otp_checks beta switch is still on until the owner sets it to off.

## 2026-11-09: V1.4 logistics providers live (ADR-078)
Applied on live: tenant 0043 to 0047, control 0023 to 0025, public 0017 and 0018 (no drift). Deployed at ad09e43. Live now: vendor types, trips sent to several logistics providers, quotes entered by staff or sent by the provider through a single-use /q/ link, award, provider invoice link, Finance's check, tenant rate cards, the outsourced trips report and CSV, optional WhatsApp send from Fleet OTG (needs the two templates). Pro feature. Not built: AI quote comparison, provider sign-in (both wait on owner decisions, docs/OWNER-CHECKLIST.md). otp_checks is off on live (beta).

## 2026-11-09: WhatsApp menu phase A built (ADR-079), not deployed
The WhatsApp menu engine, identity, the Pro gate, the administrator's switch (Vendors page) and the flows Reserve a Trip and Submit Odometer Readings are built and tested (1,211 unit tests). Platform 0019, control 0026 and tenant 0048 are NOT applied on live. Phase B (job card questionnaire) and C (cargo requests, manager WhatsApp template) are next.

## 2026-11-09: WhatsApp menu phases B and C built (ADR-079), not deployed
Job card questionnaire with photos, cargo requests (own list, web form, WhatsApp flow, link to a trip, notices) and the four-item menu are built and tested. Platform 0019, control 0026, tenant 0048 and 0049 are NOT applied on live. Waiting on the owner: apply and deploy, the manager notice template, phone numbers on records (docs/OWNER-CHECKLIST.md).

## 2026-11-09: menu, cargo, AI quote advice, caps, one-number rule, website copy (ADR-079 to ADR-082)
Live (deployed from e67a4e2, tenant 0050 applied, no drift): the WhatsApp menu and cargo requests (platform 0019, control 0026, tenant 0048 and 0049 applied earlier); the job card questionnaire narrowed to ten kinds of work, only Others explained in up to 100 words (ADR-079 amendment); the AI compares the quotes on a trip, advice only, Pro (ADR-080); daily WhatsApp caps per number, 100 for the Logistics department and 10 for everyone else, owner settings wa_daily_messages and wa_daily_messages_other (ADR-081); a phone number belongs to one organization at a time (ADR-082). Testing switches on: WhatsApp menu on for Fleet OTG and Destinsolutions (both Pro), otp_checks off. Close them when testing ends. Public copy (Features, Compare plans, landing, pricing, FAQ, llms.txt) updated for these but not yet deployed (e61f641); no price stated anywhere. The earlier claim that Pro is one price for every fleet size was removed because the owner is setting fleet-size bands. Cost estimate for the new Pro features is in ADR-064. Open: two numbers (...5600, ...6000) on live sit in both test companies; Pro band prices; Netlify template secrets.

## 2026-11-10: forms live in draft, Pro is total fleet management (ADR-084, ADR-085)
Live (deployed at c79703b): WhatsApp forms in draft mode (flow ids set in Netlify), form wording shown as coming soon, salary claim removed. Built and tested, NOT deployed: trips and cargo moved to Pro behind the plan flag `fleet_ops` (control 0027 not yet applied live; both live companies are on Pro so nothing changes for them), site copy, Compare plans (eight Pro rows), FAQ, llms.txt and both flyers repositioned (Basic maintenance management, Pro total fleet management). 1,301 unit tests pass.

## 2026-11-10: Zoho SMTP and auth email hook live; positioning is fleet maintenance and operations
Live at 03b52d2 (flyers re-rendered after, e60258b). Mail: SMTP_URL, EMAIL_FROM and AUTH_HOOK_SECRET set as Netlify production secrets (host smtp.zoho.com:465; smtppro.zoho.com refused with 554 Access Restricted, regional hosts gave 535); the Supabase Send Email hook is enabled and a test sign-up email arrived from the noreply mailbox. The forgot-password email is not yet tested by the owner. Mailbox credentials are kept in the git-ignored .env.mail, never in the repository. Positioning: "fleet management" and "total fleet management" removed from titles, descriptions, llms.txt, FAQ, plan copy and both flyers; Basic is maintenance, Pro is fleet operations, because there is no tracking or verified fuel feature and gate passes and carbon are deferred. Fifteen files changed, type-check clean, 72 related tests pass (tests/seo.test.ts now expects "fleet maintenance and operations software"). Build note: one deploy hung over three hours when Turbopack timed out fetching the IBM Plex fonts from fonts.gstatic.com; run builds with a timeout, retry npm run build, then deploy (a lasting fix would be next/font/local, not done). Open for the owner: test forgot-password, publish the three WhatsApp flows after testing, Pro band prices and AI allowances, and the older list in the 2026-11-10 resume note.

## 2026-11-11: QA-driven build, payments, payment approval, roles (ADR-086, ADR-087, ADR-088), NOT deployed
Two full-flow QA runs (an agent run on a throwaway local database: 392 steps, no Critical finding; and a live-site run, R9) produced the findings and gaps. The owner answered a build questionnaire (docs/QUESTIONNAIRE-BUILD-DECISIONS.md, answers in docs/OWNER-DECISIONS-2026-11-11.md). Built and committed locally, all tests green (1,331 pass, 4 skipped; tsc clean), none deployed and none pushed beyond the first GitHub upload. Live is still 03b52d2 (site wording) plus the flyers.
- **Payments (ADR-086, tenant migration 0052):** permission invoice.pay (Finance, Admin); table invoice_payments (append-only, void with reason); part payments, never above the amount due, only for a checked invoice; workshop invoices become paid when settled, provider trip invoices show paid from the payments. Payment panel on the invoice and trip pages.
- **Payment approval and invoice read access (ADR-087, migration 0053):** owner B1 to B3 and A4. Finance may check and pay the same invoice. An invoice above 50,000 (limit counts the invoice total, so splitting does not bypass it) or more than 10% over the approved quote needs a Fleet Manager or Admin to approve first (permission invoice.approve_payment); settings payment_approval_limit and invoice_over_quote_pct. New invoice.read (Finance, Admin, Auditor, Fleet Manager) opens the invoice screens read-only.
- **Roles (ADR-088, migration 0054):** A1 company setting admin_decides_others (default strict): the administrator may not decide others' job cards, quotations or invoice checks while another approver is active; never blocks a company with none. A2 vreq.assign (Logistics, Fleet Manager, Admin) gives a pool vehicle; vreq.decide keeps purchases and rejections. A3 Logistics decides a trip with no vehicle yet in whole-fleet mode (no new permission). A4 cargo.read_all for the auditor. A5 vreq.see_pool (HR). A6 own-vehicle members open the Vehicles pages.
- **Settings screens:** Company switches panel on the Service rules page: Trips on or off, admin_decides_others, dept_approval_limit, payment_approval_limit, invoice_over_quote_pct (QA F-03).
- **Docs:** docs/RBAC-MATRIX.md (generated from the migrations, kept current), docs/OWNER-DECISIONS-2026-11-11.md, docs/QUESTIONNAIRE-BUILD-DECISIONS.md, docs/qa/ (QA prompt and report, uncommitted).
- **Before deploying:** run tenant migrations 0052, 0053 and 0054 on live first (`npx tsx --env-file=.env.local scripts/migrate-tenants.mts`, then `--check`); deploying the code first breaks the invoice pages. On deploy every existing company gets the 50,000 and 10% payment defaults and becomes strict for the administrator (switch admin_decides_others on to keep the old behaviour).
- **Still to build from the owner's answers:** D (warn when assigning a pool vehicle with expired papers or an open repair, with a written reason; seats, capacity, class and location on vehicles), C (2 to 3 workshops per card with the scorecard beside each quote, last 12 months, warn at 10% over the estimate), E (HR purchase booking: Finance confirms budget, Fleet Manager or Admin approves, dealer quotes, automatic handover), F (cargo vehicle suggestion; location is where the last trip ended; chosen providers asked when none is free), G (repeat work: 30-day window, 7-day warranty; the rule per reason is still to be confirmed by the owner; read Vehicle Policy._0001.pdf; reopen a rejected card), H (three more settings screens), I (cargo export, company activity log, workshop names in history; Pro price bands are coming).

## 2026-11-11 (later): D, C and E built; tenant 0052 to 0057 DEPLOYED, E (0058) not
- **Deployed 2026-11-11** at ea463dc: tenant migrations 0052 to 0057 applied on both live schemas (no drift), build and deploy to https://www.fleetotg.com, health, login, pricing and features 200. The first build failed because a stray `LOG 2` file corrupted the Turbopack cache (`.next/cache/turbopack`); deleting that folder fixed it.
- **D (commit 880069b, migration 0055):** vehicles carry seats and load capacity (class and base location existed); giving a pool vehicle with expired papers or an open repair warns and needs a written reason (kept in the decision note).
- **C2 to C4 (9249576, ADR-089, migration 0056):** workshop scorecard (last 12 months) beside each quotation; Fleet Manager rates and flags (`vendor.rate`, `vendor_ratings`); a quotation over the estimate by `quote_over_estimate_pct` (default 10) or over the vehicle budget needs a written reason to approve.
- **C1 (ea463dc, ADR-090, migration 0057):** up to three workshops asked per job card (`job_card_invitees`), each with its own single-use link; approving one declines the others and makes it the card's workshop; declining one keeps the card open while another estimate waits.
- **E (738c5f2, ADR-091, migration 0058), NOT deployed:** Finance confirms a budget (`vreq.confirm_budget`), then a Fleet Manager or Administrator approves; dealer quotations; adding the vehicle from an approved purchase closes the request and hands it over in one transaction. Requests may no longer go from requested straight to purchase_approved. 1,365 tests pass, tsc clean.
- **E deployed later the same day** (tenant 0058 applied, no drift; health, login, pricing 200). **F built, not deployed** (b491589, ADR-092, tenant 0059): cargo weight; the cargo page suggests free vehicles by capacity, time window and location (where the last trip ended); Logistics makes the trip with the chosen one as preferred vehicle, or asks providers when none fits. 1,377 tests pass.
- **F5 depots and the WhatsApp cargo weight (44a9e9c, ADR-093, tenant 0060), DEPLOYED with F:** depots and places list (`depot.manage`), suggestions on the vehicle base location, cargo and trip forms, a Get started step; the WhatsApp cargo form and chat take a weight (or work it out from kg, lbs, tonnes). Tenant 0059 and 0060 applied on both live schemas (no drift); live at 44a9e9c; health, login and pricing 200. The owner published all three WhatsApp flows in Meta and `WHATSAPP_FORMS_DRAFT` was unset on Netlify production, so forms are now sent as published (not draft). Published Flows cannot be edited: a change needs a new Flow version and a new Flow ID in the WHATSAPP_FORM_* variables. Owner to test one form from a non-tester phone. 1,386 tests pass, tsc clean.
- **Still to build:** G (repeat work; the who-pays rule is still open), H (three settings screens), I (cargo CSV, activity log, workshop names in history). (Old note, done: to deploy E: apply tenant 0058 first (`npx tsx --env-file=.env.local scripts/migrate-tenants.mts`, then `--check`), then deploy.

## 2026-11-11 (evening): H built, Pro year granted on live
- **H (settings screens), not deployed:** the Company switches panel on the Service rules page now also holds Accept learner driving licences (`allow_learner_licence`), Ask for odometer readings on WhatsApp (`odometer_whatsapp`) and WhatsApp request day (`odometer_send_day`, shows 1 when unset, as the scheduler uses). Keys and database checks already existed (tenant 0053/0056); no migration. Test added in tests/settings-company-switches.test.ts. 1,387 tests pass, tsc clean.
- **Live billing change (data only, no code):** at the owner's request the organizations `beta` (Fleet OTG, the owner's) and `destinsolutions` were set to Pro, status active, not comped, not suspended, `current_period_end` 2027-11-11, band price PKR 65,000 and 200 AI reads a day kept. No invoice, tax or ledger entry was written because no money was received. Comped was avoided on purpose: a comped organization never expires, so the end date would mean nothing.
- **Still to build:** G (who-pays rule still open).

## 2026-11-11 (night): I built, QA run R10 findings fixed, NOT deployed
- **I1 exports:** `cargo` (Logistics, Fleet Manager, Admin, Auditor) and `vehicle-requests` (anyone with `vreq.read_all`) CSV kinds, with Export buttons on both pages. The R10 "400 on /export/vehicle-requests" was "Unknown export": the kind did not exist.
- **I2 activity log (tenant 0061, permission `activity.read` for Administrator and Auditor):** `/w/[slug]/activity`, read-only, the company's own audit_log (who added, changed or removed what, and each download), filter by record and period, newest 200. Shows which fields changed, never old or new values.
- **I3:** job card history names a workshop that acted through a link "Workshop name (link)". With several workshops asked the card's workshop is only known after one is approved, so an earlier link event reads "A workshop (link)" rather than guess. No migration.
- **QA R10 (41 checks, 38 pass):** the administrator's Approve button, quotation approve and invoice check form are no longer shown when the company rule blocks them; the rule is shown in words (`adminBlockedFromOthers`, ADR-088 note). ADR-077 now says its "sole employee" rule is for the administrator's own work only. 1,392 tests pass, tsc clean.
- **DEPLOYED 2026-11-11** at 0f511dd: tenant 0061 applied on both live schemas (no drift), build and deploy to https://www.fleetotg.com, home, login and pricing 200 (`/health` redirects to login, 307, so it is not a public path). Left to build: G.
- **G2 owner answer (2026-11-11, after deploy):** "for repeat repair, the reasoning justifies which party pays", confirmed as "reason on each repeat card". Built below.

## 2026-11-11 (night, later): G part 1, who pays for repeat work (ADR-094), NOT deployed
- **Built (tenant migration 0062):** a repeat card (same vehicle, not routine service, earlier card within `flag_repeat_days` with the same reason or the same service type; or the card's own reason is "previous repair not effective") cannot be approved on the review screen without choosing who pays (company, workshop under guarantee, or driver) and a written reason. Kept on the card with the card it repeats; shown on the job card and above the decision on the invoice page. Shown, not enforced on amounts. `findRepeat` replaces the inline repeat query.
- **Not built yet:** window default 30 (setting still 60 in existing companies), same-workshop and 7-day warranty rules, policy rules read-only on screens (G3, read Vehicle Policy._0001.pdf first), requester reopens a rejected card (G5).
- **Deploy:** apply tenant 0062 first, `--check`, then deploy.

## 2026-11-11 (night, latest): G finished (ADR-095), tenant 0062 DEPLOYED, 0063 not yet
- **0062 deployed** (both live schemas, no drift; home, login, pricing 200).
- **G built, tenant 0063 (not deployed):** repeat window 30 days (companies still on the old 60 move to 30; a number a company chose is kept); a workshop that already worked on the vehicle within the window makes the card a repeat once picked on the review form; 7-day warranty note on the invoice page (`WARRANTY_DAYS`); company policy rules read-only on the job card and invoice pages with the amount that applies (`getPolicyForJob`); the requester may reopen a rejected card with a reason. Tests pin the old 60 where they rely on it. 1,397 tests pass, tsc clean.
- **Deploy:** apply tenant 0063 first, `--check`, then deploy. G is complete; nothing from the owner's list remains except the owner's own items (Pro price bands, test a WhatsApp form from a non-tester phone).

## 2026-11-12: 0063 and G part 2 DEPLOYED
- **Live:** commit 38ad9c8 at https://www.fleetotg.com. Tenant 0063 applied on both live schemas, `--check` no drift. Home, login, pricing 200. (The first attempt was blocked by the permission classifier; the owner then said "run commands" and the migrate, `--check` and deploy ran as separate commands.)
- **Left, owner:** Pro price bands on the Admin Plans page; test one WhatsApp form from a non-tester phone.
- **Left, build side:** browser QA of the new pages (activity log, repeat-payer fields, same-workshop trigger, warranty banner, policy panel, reopen). None has been used in a browser yet.
- **By design:** warranty is a 7-day constant, not a setting; "excluding consumables" is approximated by the existing category exclusions; repeat payer is shown not enforced, and required only on the review-screen approval path.

## 2026-11-12 (later): trial lengths, QA prompt
- **Basic trial 10 days:** a data change, `plans.trial_days` for `standard` set to 10 on live (owner-entered value, so no migration). It applies to new sign-ups only; every public page reads it from the plans table. The old value was 3.
- **Pro trial 7 days:** `PRO_TRIAL_DAYS` in `src/lib/billing/quote.ts` is now 7, with the fixed copy updated (landing, features, compare, pricing, billing button and message, FAQ, plans art, ADR-068). NOT deployed yet: until it is, the app still starts Pro trials at 3 days while the live Basic figure already reads 10.
- **QA prompt for agents:** `docs/qa/QA-ALLROLES-REPORTS-PROMPT.md`: role by permission sweep, use cases by module with unhappy paths, report and export structure and reconciliation, cross-cutting checks. The plans row for `pro` still holds `trial_days` 3 but nothing reads it (the Pro trial length is the constant).
