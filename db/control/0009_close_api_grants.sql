-- Control-plane migration 0009: the public API roles hold no privileges on our tables. Idempotent.
-- Supabase grants anon and authenticated full access to every table made in the public schema, and the first tables here were made before
-- each migration revoked it. Row security already keeps those roles out (every table has it on, with no policy), so nothing was exposed;
-- this removes the privileges as well, so a table made without row security would still be closed. The application connects as its own
-- role and is not affected. Storage keeps working: its rules go through functions in app_private, which run with their own rights.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      -- tables and sequences made from now on start closed, whoever makes them
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      if exists (select 1 from pg_roles where rolname = 'postgres') then
        execute format('alter default privileges for role postgres in schema public revoke all on tables from %I', r);
        execute format('alter default privileges for role postgres in schema public revoke all on sequences from %I', r);
      end if;
    end if;
  end loop;
end $$;
