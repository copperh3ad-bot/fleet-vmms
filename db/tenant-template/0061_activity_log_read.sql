-- Tenant migration 0061: a company reads its own activity log (owner decision I2 of 2026-11-11). Idempotent.
-- The log is the company's own audit_log (who added, changed or removed what, and every export). It is read-only: the table already refuses change and delete.
-- The screen shows the table, the action, who, when and the NAMES of the fields that changed, never the old or new values.
insert into permissions(key, description) values ('activity.read', 'Read the company activity log (read-only)') on conflict (key) do nothing;
insert into role_permissions(role_key, permission_key)
select r, p from (values ('tenant_admin','activity.read'),('auditor','activity.read')) as x(r, p) on conflict do nothing;
