# ADR-001: Tenancy model

**Status:** Accepted (revisit trigger below)  **Date:** 2026-10-21

## Decision
Schema per tenant (`tenant_<id>`) in one Postgres database. Platform data lives in `public`.

## Consequences
- Tenant data goes through a server-side Postgres connection, not PostgREST/supabase-js.
- Each request runs in a transaction with `SET LOCAL search_path = tenant_<id>, public`.
- We own a migration runner that applies versioned SQL to every tenant schema and records `schema_version`.
- Cross-tenant platform analytics need explicit union queries.

## Revisit trigger
If tenant count passes roughly 200, or migration time across schemas becomes painful, move to shared tables with `tenant_id` + RLS. All tenant access is isolated in `src/lib/db/tenant.ts` to keep that rewrite contained.
