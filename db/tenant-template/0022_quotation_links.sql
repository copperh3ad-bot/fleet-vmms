-- Tenant migration 0022: what the unauthenticated workshop estimate link (ADR-030) may do. Idempotent.
-- The link route runs as role quotation_link: no table access at all, only EXECUTE on the two functions below, which are
-- SECURITY DEFINER with a pinned search_path. So even a bug in the route's code cannot read or change anything else.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'quotation_link') then
    create role quotation_link nologin noinherit;
  end if;
  execute format('grant quotation_link to %I', current_user);   -- lets the app's own login switch to it with SET ROLE
end $$;

do $mig$
declare s text := current_schema();
begin
  -- What the page shows: the job number, the vehicle and what is wanted. Nothing about who raised it, what it may cost or who else quoted.
  -- Returns nothing unless the job is still waiting for this workshop's estimate.
  execute format($f$
    create or replace function quote_link_info(p_job uuid, p_vendor uuid)
    returns table (job_no text, registration_no text, make text, model text, year int, description text, cause_text text, needed_by date, vendor_name text)
    language sql stable security definer set search_path = %1$I, public as $b$
      select jc.job_no, v.registration_no, v.make, v.model, v.year, jc.description, jc.cause_text, jc.needed_by, vn.name
        from job_cards jc join vehicles v on v.id = jc.vehicle_id join vendors vn on vn.id = jc.vendor_id
       where jc.id = p_job and jc.vendor_id = p_vendor and jc.status = 'vendor_assigned' and vn.status = 'active'
    $b$
  $f$, s);

  -- Marks the link used and saves the estimate against the job card in one step, so a refused estimate never burns a link
  -- and the route never touches the links table. The job card moves on to "quotation received" exactly as when the workshop
  -- signs in, and the people who decide on quotations are told.
  execute format($f$
    create or replace function submit_quotation_via_link(p_job uuid, p_vendor uuid, p jsonb, p_token_hash text)
    returns uuid language plpgsql security definer set search_path = %1$I, public as $b$
    declare jc job_cards; qid uuid; l jsonb; n int := 0;
    begin
      update public.quotation_links k set used_at = now()
       where k.token_hash = p_token_hash and k.job_card_id = p_job and k.vendor_id = p_vendor
         and k.tenant_id = (select t.id from public.tenants t where t.schema_name = current_schema())
         and k.used_at is null and k.revoked_at is null and k.expires_at > now();
      if not found then raise exception 'link is not valid'; end if;
      select * into jc from job_cards where id = p_job for update;
      if jc.id is null or jc.vendor_id is distinct from p_vendor or jc.status <> 'vendor_assigned'
         or not exists (select 1 from vendors where id = p_vendor and status = 'active') then
        raise exception 'link is not valid';
      end if;
      if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'add at least one line'; end if;
      if jsonb_array_length(p->'lines') > 50 then raise exception 'too many lines'; end if;
      insert into quotations(job_card_id, vendor_id, amount, details, days_needed, valid_until, warranty_months)
      values (p_job, p_vendor, 0, left(nullif(p->>'details', ''), 2000), nullif(p->>'days_needed', '')::int,
              nullif(p->>'valid_until', '')::date, nullif(p->>'warranty_months', '')::int)
      returning id into qid;
      for l in select * from jsonb_array_elements(p->'lines') loop
        insert into quotation_lines(quotation_id, kind, description, qty, unit_cost)
        values (qid, coalesce(nullif(l->>'kind', ''), 'service'), left(l->>'description', 300),
                coalesce(nullif(l->>'qty', '')::numeric, 1), coalesce(nullif(l->>'unit_cost', '')::numeric, 0));
        n := n + 1;
      end loop;
      perform transition_job_card(p_job, 'quotation_received', null, 'Estimate sent by the workshop through a link');
      insert into notifications(user_id, kind, payload)
        select distinct m.user_id, 'quotation.received', jsonb_build_object('job_card_id', p_job, 'job_no', jc.job_no, 'to', 'quotation_received')
          from public.tenant_memberships m
         where m.tenant_id = (select t.id from public.tenants t where t.schema_name = current_schema()) and m.status = 'active'
           and m.role in (select role_key from role_permissions where permission_key = 'quotation.approve');
      return qid;
    end $b$
  $f$, s);

  execute format('revoke all on function %I.quote_link_info(uuid, uuid) from public', s);
  execute format('revoke all on function %I.submit_quotation_via_link(uuid, uuid, jsonb, text) from public', s);
  execute format('grant usage on schema %I to quotation_link', s);
  execute format('grant execute on function %I.quote_link_info(uuid, uuid), %I.submit_quotation_via_link(uuid, uuid, jsonb, text) to quotation_link', s, s);
end $mig$;
