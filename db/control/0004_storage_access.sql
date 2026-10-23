-- Control-plane migration 0004: who may touch which folder of the file bucket (ADR-014). Runs on the control database
-- only (that is where Supabase Storage lives). Idempotent.
--
-- Until now the bucket policies asked public.tenant_memberships, which only the older shared organizations still fill.
-- An organization with its own database keeps its memberships there, so the policies now ask the control plane's index of
-- logins to organizations (public.user_orgs) instead. The app keeps that index in step: a person who is disabled is
-- removed from it, and added again when enabled. What a person may do inside the folder is still decided by the app.
--
-- Also: an operator may read the receipts customers upload as proof of payment, and nothing else in the bucket
-- (<schema>/billing/...). Operators never see business files.

-- A disabled person in a shared organization must not keep storage access through the backfill made in control 0001.
delete from public.user_orgs u using public.tenant_memberships m
 where m.user_id = u.user_id and m.tenant_id = u.tenant_id and m.status = 'disabled';

do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;

  execute 'create schema if not exists app_private';
  execute $f$
    create or replace function app_private.my_tenant_schemas() returns setof text
    language sql stable security definer set search_path = ''
    as $body$
      select t.schema_name
        from public.tenants t join public.user_orgs u on u.tenant_id = t.id
       where u.user_id = (select auth.uid()) and t.status = 'active'
    $body$
  $f$;
  execute 'revoke all on function app_private.my_tenant_schemas() from public, anon';
  execute 'grant execute on function app_private.my_tenant_schemas() to authenticated';

  execute $f$
    create or replace function app_private.is_operator() returns boolean
    language sql stable security definer set search_path = ''
    as $body$ select exists (select 1 from public.platform_admins where user_id = (select auth.uid())) $body$
  $f$;
  execute 'revoke all on function app_private.is_operator() from public, anon';
  execute 'grant execute on function app_private.is_operator() to authenticated';

  execute 'drop policy if exists attachments_operator_read on storage.objects';
  execute $p$create policy attachments_operator_read on storage.objects for select to authenticated
    using (bucket_id = 'attachments' and (storage.foldername(name))[2] = 'billing' and app_private.is_operator())$p$;
end $$;
