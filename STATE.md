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
