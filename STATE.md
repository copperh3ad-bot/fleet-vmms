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
