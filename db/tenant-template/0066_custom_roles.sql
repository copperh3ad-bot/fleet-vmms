-- Tenant migration 0066 (ADR-097): the organization's administrator can edit what each role may do and make roles of their own. Idempotent.
-- The roles and role_permissions tables already belong to each organization and are already audited; this adds the mark between a built-in role and one the
-- administrator made, a unique name, and two guards the database keeps whatever the application does.

alter table roles add column if not exists is_builtin boolean not null default false;
alter table roles add column if not exists created_at timestamptz not null default now();

-- Every role that exists today came with the product. A role the administrator makes has a key starting custom_.
update roles set is_builtin = true where not is_builtin and key not like 'custom\_%';

create unique index if not exists roles_name_lower_key on roles (lower(name));

-- A built-in role is never deleted, and the administrator role never loses the permission to manage people (so an organization can never be left with nobody who can edit roles).
create or replace function roles_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and old.is_builtin then
    raise exception 'a built-in role cannot be deleted';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists roles_guard on roles;
create trigger roles_guard before delete on roles for each row execute function roles_guard();

create or replace function role_permissions_guard() returns trigger language plpgsql as $$
begin
  if old.role_key = 'tenant_admin' and old.permission_key = 'admin.users' and exists (select 1 from roles where key = 'tenant_admin') then
    raise exception 'the administrator role always keeps the permission to manage people';
  end if;
  return old;
end $$;
drop trigger if exists role_permissions_guard on role_permissions;
create trigger role_permissions_guard before delete on role_permissions for each row execute function role_permissions_guard();

revoke execute on function roles_guard() from public;
revoke execute on function role_permissions_guard() from public;
