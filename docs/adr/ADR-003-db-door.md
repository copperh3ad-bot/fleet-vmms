# ADR-003: One database door, provider-neutral

Status: accepted, Phase 1.

- `src/lib/db/tenant.ts` is the only place a tenant `search_path` is set. Every request is one transaction: `set local search_path`, then `set_config('app.user_id'/'app.role')`, so nothing leaks to the next user of a pooled connection.
- The app depends on two small interfaces (`Driver`, `Queryable`). Production uses `pg`; tests use PGlite. Moving between Supabase and Neon, or later to shared-tables-with-RLS, changes this folder only.
- Schema names come from `public.tenants`, never from user input, and are re-checked against `^tenant_[a-z0-9_]{1,50}$` before use.
- Migrations: each tenant schema holds `schema_migrations(name, checksum)`. An applied migration that is later edited is refused; add a new file. Each tenant migrates in its own transaction so one bad tenant cannot half-apply or block the rest. `--check` reports drift.
- Provisioning is one transaction: tenant row, schema, all migrations, owner. A failure leaves nothing behind.
- Permissions are read from the tenant's `role_permissions` on each check. No caching yet; add it only if measurements say so.
