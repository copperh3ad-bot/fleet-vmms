-- Tenant migration 0037: close two defaults that were open but unreachable. Idempotent.
--
-- 1. PostgreSQL lets every role execute a new function unless told otherwise. Nobody outside the app could reach these (the API roles cannot even enter
--    a tenant schema), but a grant to a role should be a decision, so the default is removed here and for functions made later. The restricted link roles
--    (odometer_link, quotation_link, inbound_mail) keep the EXECUTE they were given by name in their own migrations.
-- 2. A view runs with its owner's rights unless it says otherwise. Making each one run with the caller's rights means a view can never show a row the
--    caller's own table access would hide.

do $mig$
declare
  s text := current_schema();
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = s::regnamespace and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public', r.sig);
  end loop;
  execute format('alter default privileges in schema %I revoke execute on functions from public', s);

  for r in
    select c.relname from pg_class c where c.relnamespace = s::regnamespace and c.relkind = 'v'
  loop
    execute format('alter view %I.%I set (security_invoker = true)', s, r.relname);
  end loop;
end
$mig$;
