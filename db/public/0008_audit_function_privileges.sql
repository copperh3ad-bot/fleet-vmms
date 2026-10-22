-- Platform migration 0008: the access-audit functions must not be callable through Supabase's public API. Idempotent.
-- 0007 revoked from "public" only; Supabase also grants EXECUTE to its anon and authenticated roles directly.
-- A trigger function cannot do anything when called as a function, but a SECURITY DEFINER one should not be exposed at all.
revoke all on function public.platform_audit_trigger() from public;
revoke all on function public.platform_audit_immutable() from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.platform_audit_trigger() from %I', r);
      execute format('revoke all on function public.platform_audit_immutable() from %I', r);
    end if;
  end loop;
end $$;

-- A fixed search_path for both, so a caller's setting cannot change what they resolve.
alter function public.platform_audit_immutable() set search_path = public, pg_temp;
