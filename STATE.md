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
