# Fleet OTG: working rules

Multi-tenant SaaS for vehicle and asset maintenance management. Plan: see `docs/PLAN.md`.

## Stack
Next.js (App Router, TS), Tailwind, Supabase (Auth, Postgres 16, Storage), server-side `pg` for tenant data.

## Non-negotiables
1. **Tenant data is only reached through `src/lib/db/tenant.ts`.** No other module opens a DB connection or sets `search_path`.
2. **Never use supabase-js for tenant tables.** It is for Auth and Storage only. Supabase's service key is read in one file only, `src/lib/supabase/admin.ts` (ADR-025); `tests/auth-admin-key.test.ts` enforces it.
3. **Every server action checks `can()`** (`src/lib/auth/can.ts`) before touching data.
4. **Job card state changes go through one function** (`transitionJobCard`) and always write `job_card_events`.
5. **No unauthenticated endpoints** except login/health, the single-use driver odometer link under the limits in ADR-006, the single-use invitation page under ADR-012, and the public landing, sign-up, terms, privacy and email-confirmation pages named in `PUBLIC_PATHS` under ADR-014, plus the pricing page (the only page that shows the price figures, ADR-065) and the join-with-a-code pages under ADR-016, the ask-for-a-password-reset page under ADR-019, the About us page under ADR-020, the Contact us form under ADR-021, the crawler files (robots.txt, sitemap.xml, security.txt) under ADR-023, and the signed email hook Supabase calls under ADR-024, and the single-use workshop estimate and invoice links under ADR-030 and ADR-033 (and, on the same /q/ page, the logistics provider trip quote link under ADR-078), and the static Features page and the llms.txt summary under ADR-031, and the Compare plans page under ADR-063, and the public chat-widget address under ADR-037, and the blank vehicle sheet under ADR-038, and the signed WhatsApp webhook Meta calls under ADR-042. No generic SQL-exec RPCs, ever.
6. **No secrets or infrastructure IDs in the repo.**
7. **Pricing is decided (ADR-014, amended by ADR-035): two plans. Basic is PKR 43,000 per month per organization (ADR-057; 12 months paid at once get one month free, so 11 are charged), 3-day trial, tax added on top for customers in Pakistan (ADR-017); no tax for customers elsewhere, and every rate, scenario and exchange rate is entered by the owner, never built in (ADR-018).** The price lives in the `plans` table, never in code or the repository. Pro (the AI plan, Phase 2, offered as an upgrade to organizations that enter many job cards a day) is priced in fleet-size bands in `plan_bands`, entered by the owner on the Admin Plans page, never in code. No other prices, discounts or per-seat charges without the owner.
8. Tenant migrations live in `db/tenant-template/NNNN_name.sql`, are idempotent, and run across all tenant schemas via `scripts/migrate-tenants.ts`.
9. **Each organization's data lives apart from every other's** (ADR-014): its own schema in the shared database by default, or its own database in dedicated mode. The control plane holds the registry, the login-to-organization index, token routes, sign-ups and billing. Every query on a table that holds several organizations' rows must name the organization (`tests/tenant-filters.test.ts` enforces it). Connection strings are encrypted, never logged, never in the repository, never on a screen.

## Process
- Append to `STATE.md` at the end of each phase (append-only).
- Architectural decisions get an ADR in `docs/adr/`.
- Each phase ends with passing tests before the next starts.
