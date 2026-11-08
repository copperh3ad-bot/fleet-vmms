-- Control-plane migration 0020: files are reached through the server only (ADR-025, amended). Runs on the control database (where Supabase Storage lives). Idempotent.
--
-- Until now a signed-in person's own login token could read, add and delete files in their organization's folder of the file bucket, whatever their role in it. The app
-- now does every file operation on the server, after its own permission checks, so the bucket needs no rules for browsers at all. With no policy for the
-- `authenticated` role, a login token can neither list nor fetch nor add a file by calling the storage API directly.
--
-- Deploy the new app BEFORE applying this: the previous app read files with the person's token and would lose its file access.

do $$
declare p text;
begin
  if to_regclass('storage.objects') is null then return; end if;
  foreach p in array array['attachments_read', 'attachments_insert', 'attachments_delete', 'attachments_operator_read'] loop
    execute format('drop policy if exists %I on storage.objects', p);
  end loop;
  -- the two helpers existed only for those policies
  execute 'drop function if exists app_private.my_tenant_schemas()';
  execute 'drop function if exists app_private.is_operator()';
end
$$;
