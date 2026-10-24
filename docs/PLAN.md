# Fleet OTG: Vehicle & Asset Maintenance Management System (SaaS)

## Context
Union Fabrics tracks vehicle maintenance in spreadsheets and follow-ups. ShapeVentures proposed a cloud VMMS (fleet records, digital maintenance requests and approvals, workshop quotations/work orders, invoice controls, cost and budget monitoring, insurance/compliance tracking, accidents/challans, vehicle custody, RBAC, audit trail, dashboards, reports). We are building it as a multi-tenant SaaS, Union Fabrics being tenant #1. Pricing is deliberately out of scope: only plan/limit hooks are built, no prices.

Greenfield. The working directory has no project. Stack follows the MerQuant pattern: Next.js + Supabase Postgres, built with Claude Code under CLAUDE.md / STATE.md / ADR governance.

## Decisions made
- Stack: Next.js (App Router, TypeScript), Tailwind + shadcn/ui, Supabase (Auth, Postgres 16, Storage, pg_cron).
- Tenancy: **schema per tenant** (user's choice). See risk below.
- v1 scope: core workflow + attachment features (insurance/compliance, accidents/challans, custody, invoices).

## Risk to accept knowingly: schema-per-tenant on Supabase
It works but costs more than shared-DB + `tenant_id` + RLS:
- PostgREST / supabase-js cannot practically serve per-tenant schemas. All tenant data goes through a **server-side Postgres connection** (Drizzle or Kysely), not supabase-js. We lose Supabase's client-side RLS convenience.
- Every migration must run across N schemas. We need our own migration runner and a `schema_version` per tenant.
- Pooler is transaction mode, so each request runs inside a transaction with `SET LOCAL search_path = tenant_<id>, public`.
- Cross-tenant platform analytics get harder.
Mitigation: all of the above is isolated in one data-access module (`lib/db/tenant.ts`), so switching to tenant_id + RLS later is a contained rewrite. Recommend revisiting this at ADR-001 if tenants will be many small companies rather than few large ones.

## Architecture
**`public` schema (platform):** `tenants` (id, name, slug, schema_name, schema_version, status), `tenant_memberships` (user_id, tenant_id, role), `plans` + `tenant_subscriptions` (feature flags and limits like max_vehicles/max_users; no prices), `platform_admins`.

**`tenant_<id>` schema (one per org), created from a versioned template:**
- Master data: `vehicles` (registration_no, make, model, year, fuel, vin, odometer, status), `employees` (links to auth user), `vehicle_custody` (vehicle, employee, from, to, so history is preserved), `vendors` (workshops, categories, contact, status), `reason_codes` (taxonomy, see Analytics).
- Workflow: `job_cards`, `job_card_lines` (part/labour/service, qty, cost), `job_card_events` (state transitions with actor, timestamp, comment), `quotations`, `work_orders`, `invoices`, `invoice_lines`, `attachments` (photos, quotes, invoices; Storage path `tenant_<id>/...`).
- Control: `budgets` (per vehicle and fleet, per period), `insurance_policies`, `compliance_docs` (registration, fitness, token tax, route permit, expiry), `accidents`, `challans`, `audit_log` (append-only, trigger-written), `notifications`.
- Analytics: SQL views and materialized views per tenant (see below).

**Job card state machine:** `draft → submitted → approved | rejected | returned_for_edit → vendor_assigned → quotation_received → quotation_approved → in_progress → completed → invoiced → invoice_verified → closed`. Transitions enforced in one server-side function and a DB check; every transition writes `job_card_events`. Rule: requester cannot approve their own card; invoice verifier is not the approver (segregation of duties, configurable thresholds).

**RBAC:** table-driven, per tenant: `roles`, `permissions`, `role_permissions`. Default roles: Tenant Owner/Admin, Fleet Manager (approver), Finance (invoice verification), Requester (employee/driver), Auditor (read-only), Vendor (external, sees only assigned work orders). Single `can(user, action, resource)` helper used by server actions, plus in-schema RLS policies keyed on `SET LOCAL app.user_id / app.role` as defense in depth. Platform-level Super Admin is separate.

**Vendor access:** vendors log in to a limited portal (or tokenised link) to submit quotes, update progress, upload invoices.

## Analytics (the differentiator)
- **Cost per vehicle:** total, per km (odometer on each job), by category, by month; vs budget with utilisation % and breach flag.
- **Frequency:** jobs per vehicle per period, mean time between maintenance, **repeat-repair flag** (same reason/category within N days).
- **Why it keeps breaking:** each job card requires structured `reason_code` (category: scheduled service, wear and tear, driver misuse, accident damage, defect, poor previous repair, environmental) plus mandatory free-text cause and optional photo. Manager can re-tag at approval. Gives Pareto of reasons (quantitative) and text for review (qualitative). Later: LLM theme clustering on free text (not v1).
- **Per user/custodian:** cost and jobs per custodian via custody history (so cost lands on whoever held the vehicle at the time), misuse-tagged jobs, incidents per 10k km, challans.
- **Flag rules (configurable per tenant):** over budget, more than N jobs in 90 days, repeat repair, cost above X times fleet median for same model, expiring insurance/compliance docs.
- Vendor performance: turnaround time, quote vs final invoice variance, rework rate.

## Dashboard
KPI tiles (open job cards, awaiting approval, spend MTD/YTD vs budget, vehicles over budget, expiring documents), spend trend, top 10 costly vehicles, reason Pareto, vendor scorecard, approval queue, custodian leaderboard. Charts via Recharts. Role-aware: requester sees own vehicles, manager sees all.

## Build phases (each phase ends with tests and a STATE.md entry)
0. **Foundations:** repo, CLAUDE.md, STATE.md, ADR-001 (tenancy), ADR-002 (RBAC), tooling, CI, Supabase project.
1. **Tenancy + auth + RBAC:** tenant provisioning (create schema from template), migration runner, membership/role resolution, `lib/db/tenant.ts`, `can()`, isolation tests.
2. **Master data:** vehicles, employees, vendors, custody, bulk CSV import (Union Fabrics fleet and staff already exist as records).
3. **Job cards:** create, lines, attachments, submit, approve/reject/return, audit trail, notifications.
4. **Vendor flow:** assignment, quotation, work order, progress, completion, invoice upload, finance verification.
5. **Budgets and cost engine:** budgets, utilisation, breach alerts, cost-per-km.
6. **Reasons and analytics:** taxonomy admin, flag rules engine, views, per-vehicle and per-user reports.
7. **Compliance:** insurance, documents with expiry alerts (pg_cron + email), accidents, challans.
8. **Dashboard and reports:** role-aware dashboard, CSV/PDF exports.
9. **Hardening:** audit-log review, security pass (rate limits, no unauthenticated endpoints, no exposed exec_sql: lessons from MerQuant), Supabase advisors, seed demo tenant, onboarding flow, plan limits enforcement.

## Critical files (to be created)
`CLAUDE.md`, `STATE.md`, `docs/adr/`; `src/lib/db/tenant.ts` (schema-scoped connection); `src/lib/auth/can.ts`; `db/tenant-template/*.sql` (versioned tenant migrations); `scripts/migrate-tenants.ts`; `src/app/(app)/{dashboard,job-cards,vehicles,vendors,budgets,compliance,reports,admin}`; `src/app/(vendor)/`; `db/public/*.sql`.

## Verification
- **Isolation test:** two tenants, user from A attempts reads/writes on B via every route and server action. Must fail.
- **Migration test:** apply a new migration to 3+ tenant schemas, confirm `schema_version` and no drift.
- **RBAC matrix test:** every role vs every action, including self-approval block.
- **State machine tests:** all legal and illegal transitions.
- **Playwright E2E:** requester creates card → manager approves → vendor quotes → work order → invoice → finance verifies → appears in vehicle history, cost, dashboard.
- **Analytics tests** with seeded data: budget breach, repeat-repair flag, custodian attribution across a custody change.
- Supabase security advisors clean; manual check that Storage paths are tenant-scoped.

## Open items (not blocking the plan)
Currency/tax handling (PKR, sales tax fields), mobile-first/PWA for drivers, WhatsApp notifications (later), Urdu UI, approval thresholds by amount, billing integration (deferred with pricing).

## Addendum 2026-10-21: Preventive maintenance due tracking
- Rule: oil change due 3 months after the last one. Interval is a per-tenant setting on `service_types`, not hardcoded; more preventive services (tyres, brakes) are rows, not code.
- "Last oil change" = latest completed job card with a line tagged `service_type_key = oil_change`, or an onboarding baseline, whichever is later. Free-text matching is not used.
- Status per vehicle: `no_history`, `scheduled` (job already in flight), `overdue`, `due_soon` (default 14 days before), `ok`. View: `v_pm_status`.
- Optional distance rule (`interval_km`, warn `pm_warning_km`), off until a km interval is set. Only trustworthy if odometer is logged regularly.
- Surfaces: dashboard "PM due" tile and list (Phase 8); daily pg_cron notification to fleet managers and the custodian (Phase 7, shares the expiry-alert job); job card form gets a service-type picker on lines (Phase 3); onboarding CSV import carries last oil change date per vehicle (Phase 2).
- SQL: `db/tenant-template/0002_preventive_maintenance.sql`, tested in `scripts/check-sql.mts`.

## Addendum 2026-10-21: Odometer from a 3rd-party tracker (optional) or monthly entry
- One table, `odometer_readings`, is the only way `vehicles.odometer_km` changes. Sources: `tracker`, `monthly_entry`, `job_card`, `manual`, `baseline`.
- Validation on insert: lower than previous, or more than `odometer_max_km_per_day` (default 800), is **flagged** and does not move the odometer until accepted. Nothing is silently overwritten.
- Option A, tracker: provider-agnostic `tracker_integrations` + `vehicle_trackers` (device ref, `odometer_offset_km` because tracker distance rarely equals the dashboard odometer). A server-side sync worker per provider writes readings. Credentials live in server secrets, referenced by `secret_ref`, never in the database. The worker itself is not built; it needs the provider named first.
- Option B, monthly: admin opens a cycle (`open_odometer_cycle`), each vehicle gets a pending row for its custodian, the driver (or admin on their behalf) submits a reading with a dashboard photo, admin approves (`approve_odometer_submission`). Approving a flagged reading needs a written note. Vehicles with a tracker that synced in the last 7 days are skipped.
- Both can run together. Job cards that record an odometer also create a reading.
- `v_odometer_status` shows freshness (fresh / stale after 45 days / never), source, tracker link, flagged count. `v_pm_status.km_data_stale` warns when the oil-change distance rule is running on an old odometer.
- Permissions: `odometer.submit`, `odometer.review`, `tracker.manage`.

## Decision 2026-10-21: tracker integration deferred (supersedes the tracker parts of the odometer addendum above)
- v1 ships monthly odometer collection only. No tracker tables, no tracker worker, no tracker permission in the tenant schema.
- Tracker sync becomes a post-v1 module, built when a customer asks for it, and available only to organizations that opt in (plan feature flag `tracker_sync` in `public.plans.features`, plus a per-tenant switch).
- When built, it adds its own migration (tracker integrations, vehicle-to-device links with `odometer_offset_km`, sync status), a sync worker per provider, and a `tracker.manage` permission. Credentials stay in server secrets.
- Already in place so nothing needs reworking: `odometer_readings.source` accepts `'tracker'`, and validation and flagging apply to any source.
- Prerequisite when the time comes: the customer's tracker provider and how it exposes data.

## Clarification 2026-10-21: tracker integration is a v2 feature
- Scheduled for **v2**, not any v1 phase. Still opt-in per organization (plan feature flag `tracker_sync`). Everything else in the 2026-10-21 tracker decision stands.
