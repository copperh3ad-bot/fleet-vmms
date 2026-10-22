-- Private Storage bucket for photos and documents. Idempotent.
-- Objects live at <tenant schema>/<entity type>/<entity id>/<file>. A signed-in user can touch only the folder of a
-- tenant they are an active member of. What they may do inside it (create, read) is checked by the app, which
-- also records each file in the tenant's attachments table.
-- Databases without Supabase Storage (local Postgres, PGlite in tests) skip all of this.
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;

  insert into storage.buckets (id, name, public, file_size_limit)
  values ('attachments', 'attachments', false, 10485760)
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

  execute 'create schema if not exists app_private';
  execute $f$
    create or replace function app_private.my_tenant_schemas() returns setof text
    language sql stable security definer set search_path = ''
    as $body$
      select t.schema_name
        from public.tenants t join public.tenant_memberships m on m.tenant_id = t.id
       where m.user_id = (select auth.uid()) and m.status = 'active' and t.status = 'active'
    $body$
  $f$;
  execute 'revoke all on function app_private.my_tenant_schemas() from public, anon';
  execute 'grant usage on schema app_private to authenticated';
  execute 'grant execute on function app_private.my_tenant_schemas() to authenticated';

  execute 'drop policy if exists attachments_read on storage.objects';
  execute $p$create policy attachments_read on storage.objects for select to authenticated
    using (bucket_id = 'attachments' and (storage.foldername(name))[1] in (select app_private.my_tenant_schemas()))$p$;
  execute 'drop policy if exists attachments_insert on storage.objects';
  execute $p$create policy attachments_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'attachments' and (storage.foldername(name))[1] in (select app_private.my_tenant_schemas()))$p$;
  execute 'drop policy if exists attachments_delete on storage.objects';
  execute $p$create policy attachments_delete on storage.objects for delete to authenticated
    using (bucket_id = 'attachments' and (storage.foldername(name))[1] in (select app_private.my_tenant_schemas()))$p$;
end $$;
