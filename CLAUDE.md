# Fleet OTG: working rules

Multi-tenant SaaS for vehicle and asset maintenance management. Plan: see `docs/PLAN.md`.

## Stack
Next.js (App Router, TS), Tailwind, Supabase (Auth, Postgres 16, Storage), server-side `pg` for tenant data.

## Non-negotiables
1. **Tenant data is only reached through `src/lib/db/tenant.ts`.** No other module opens a DB connection or sets `search_path`.
2. **Never use supabase-js for tenant tables.** It is for Auth and Storage only.
3. **Every server action checks `can()`** (`src/lib/auth/can.ts`) before touching data.
4. **Job card state changes go through one function** (`transitionJobCard`) and always write `job_card_events`.
5. **No unauthenticated endpoints** except login/health, the single-use driver odometer link under the limits in ADR-006, the single-use invitation page under ADR-012, and the public landing, sign-up, terms, privacy and email-confirmation pages named in `PUBLIC_PATHS` under ADR-014, plus the pricing page and the join-with-a-code pages under ADR-016. No generic SQL-exec RPCs, ever.
6. **No secrets or infrastructure IDs in the repo.**
7. **Pricing is decided (ADR-014): USD 149 per month per organization, 3-day trial, tax added on top for customers in Pakistan (ADR-017); no tax for customers elsewhere, and every rate, scenario and exchange rate is entered by the owner, never built in (ADR-018).** The price lives in the `plans` table, never in code or the repository. No other prices, discounts or per-seat charges without the owner.
8. Tenant migrations live in `db/tenant-template/NNNN_name.sql`, are idempotent, and run across all tenant schemas via `scripts/migrate-tenants.ts`.
9. **Each organization's data lives apart from every other's** (ADR-014): its own schema in the shared database by default, or its own database in dedicated mode. The control plane holds the registry, the login-to-organization index, token routes, sign-ups and billing. Every query on a table that holds several organizations' rows must name the organization (`tests/tenant-filters.test.ts` enforces it). Connection strings are encrypted, never logged, never in the repository, never on a screen.

## Process
- Append to `STATE.md` at the end of each phase (append-only).
- Architectural decisions get an ADR in `docs/adr/`.
- Each phase ends with passing tests before the next starts.
