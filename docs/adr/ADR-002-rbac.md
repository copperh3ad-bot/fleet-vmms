# ADR-002: RBAC

**Status:** Accepted  **Date:** 2026-10-21

## Decision
Table-driven roles and permissions per tenant (`roles`, `permissions`, `role_permissions`), enforced in two layers:
1. Application: a single `can(user, action, resource)` helper called by every server action.
2. Database: in-schema RLS policies keyed on `app.user_id` and `app.role`, set with `SET LOCAL` per request.

## Default roles
Tenant Admin, Fleet Manager (approver), Finance, Requester, Auditor (read-only), Vendor (external, assigned work orders only). Platform Super Admin is separate and lives in `public.platform_admins`.

## Segregation of duties
A requester cannot approve their own job card. The person who verifies an invoice cannot be the approver of the same job card (configurable per tenant).
