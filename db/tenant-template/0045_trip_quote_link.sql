-- Tenant migration 0045 (ADR-078 phase B): what the unauthenticated logistics provider quote link may do. Idempotent.
-- Same pattern as the workshop estimate link (0022): the link route runs as role quotation_link, which has no table access, only EXECUTE on the
-- two SECURITY DEFINER functions below with a pinned search path. So even a bug in the route cannot read or change anything else.

do $mig$
declare s text := current_schema();
begin
  -- What the page shows: the trip number, what is to be moved, the route and the times. Nothing about who asked, any budget or what other providers quoted.
  -- Returns nothing unless this provider's quote is still wanted on a trip still waiting for approval.
  execute format($f$
    create or replace function trip_quote_link_info(p_quote uuid)
    returns table (trip_no text, purpose text, from_place text, to_place text, stops text, start_at timestamptz, end_at timestamptz, passengers int, vendor_name text)
    language sql stable security definer set search_path = %1$I, public as $b$
      select t.trip_no, t.purpose, t.from_place, t.to_place, t.stops, t.start_at, t.end_at, t.passengers, vn.name
        from trip_quotes tq join trips t on t.id = tq.trip_id join vendors vn on vn.id = tq.vendor_id
       where tq.id = p_quote and tq.status = 'requested' and t.status = 'requested' and vn.status = 'active' and vn.kind = 'logistics'
    $b$
  $f$, s);

  -- Marks the link used and saves the quote in one step, so a refused quote never burns a link. The people who may award are told.
  execute format($f$
    create or replace function submit_trip_quote_via_link(p_quote uuid, p jsonb, p_token_hash text)
    returns uuid language plpgsql security definer set search_path = %1$I, public as $b$
    declare tq trip_quotes; t trips; vname text; amt numeric;
    begin
      update public.quotation_links k set used_at = now()
       where k.token_hash = p_token_hash and k.trip_quote_id = p_quote and k.kind = 'trip_quote'
         and k.tenant_id = (select x.id from public.tenants x where x.schema_name = current_schema())
         and k.used_at is null and k.revoked_at is null and k.expires_at > now();
      if not found then raise exception 'link is not valid'; end if;
      select * into tq from trip_quotes where id = p_quote for update;
      if tq.id is null or tq.status <> 'requested' then raise exception 'link is not valid'; end if;
      select * into t from trips where id = tq.trip_id for update;
      select name into vname from vendors where id = tq.vendor_id and status = 'active' and kind = 'logistics';
      if t.status <> 'requested' or vname is null then raise exception 'link is not valid'; end if;
      begin amt := nullif(replace(p->>'amount', ',', ''), '')::numeric; exception when others then amt := null; end;
      if amt is null or amt <= 0 then raise exception 'enter the quoted amount'; end if;
      if amt > 1000000000 then raise exception 'enter the quoted amount'; end if;
      update trip_quotes set status = 'quoted', amount = amt, vehicle_text = left(nullif(trim(p->>'vehicle_text'), ''), 120),
             driver_text = left(nullif(trim(p->>'driver_text'), ''), 120), notes = left(nullif(trim(p->>'notes'), ''), 1000),
             valid_until = nullif(p->>'valid_until', '')::date, quoted_at = now() where id = p_quote;
      insert into trip_events(trip_id, from_status, to_status, actor_id, note)
        values (t.id, 'requested', 'requested', null, 'Quote from ' || vname || ' through a link: ' || to_char(amt, 'FM999G999G999G990D00'));
      insert into notifications(user_id, kind, payload)
        select distinct m.user_id, 'trip.quote_received', jsonb_build_object('trip_id', t.id, 'trip_no', t.trip_no, 'text', t.trip_no || ': quote from ' || vname)
          from public.tenant_memberships m
         where m.tenant_id = (select x.id from public.tenants x where x.schema_name = current_schema()) and m.status = 'active'
           and m.role in (select role_key from role_permissions where permission_key = 'trip.award');
      return p_quote;
    end $b$
  $f$, s);

  execute format('revoke all on function %I.trip_quote_link_info(uuid) from public', s);
  execute format('revoke all on function %I.submit_trip_quote_via_link(uuid, jsonb, text) from public', s);
  execute format('grant execute on function %I.trip_quote_link_info(uuid), %I.submit_trip_quote_via_link(uuid, jsonb, text) to quotation_link', s, s);
end $mig$;
