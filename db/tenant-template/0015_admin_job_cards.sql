-- Tenant migration 0015: administrators can raise job cards for any vehicle. Idempotent.
-- Approval stays with fleet managers (jobcard.approve), and the database still refuses an approver who is the requester.
insert into role_permissions(role_key, permission_key) values ('tenant_admin', 'jobcard.create') on conflict do nothing;
