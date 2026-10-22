# Fleet VMMS: working rules

Multi-tenant SaaS for vehicle and asset maintenance management. Plan: see `docs/PLAN.md`.

## Stack
Next.js (App Router, TS), Tailwind, Supabase (Auth, Postgres 16, Storage), server-side `pg` for tenant data.

## Non-negotiables
1. **Tenant data is only reached through `src/lib/db/tenant.ts`.** No other module opens a DB connection or sets `search_path`.
2. **Never use supabase-js for tenant tables.** It is for Auth and Storage only.
3. **Every server action checks `can()`** (`src/lib/auth/can.ts`) before touching data.
4. **Job card state changes go through one function** (`transitionJobCard`) and always write `job_card_events`.
5. **No unauthenticated endpoints** except login/health, and the single-use driver odometer link under the limits in ADR-006. No generic SQL-exec RPCs, ever.
6. **No secrets or infrastructure IDs in the repo.**
7. **Pricing is undecided.** Only plan limits and feature flags exist. Do not add prices.
8. Tenant migrations live in `db/tenant-template/NNNN_name.sql`, are idempotent, and run across all tenant schemas via `scripts/migrate-tenants.ts`.

## Process
- Append to `STATE.md` at the end of each phase (append-only).
- Architectural decisions get an ADR in `docs/adr/`.
- Each phase ends with passing tests before the next starts.
