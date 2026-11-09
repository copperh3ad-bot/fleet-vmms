-- Tenant migration 0046 (ADR-078 phase B2): a logistics provider invoices an awarded, completed trip through a single-use link, and Finance checks it. Idempotent.
-- Same pattern as the workshop invoice (0023): the link route runs as role quotation_link, which has no table access and may only call the two
-- SECURITY DEFINER functions below. The check (verify or return) is one function that writes the history.

create table if not exists trip_invoices (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references trips(id) on delete cascade,
  vendor_id     uuid not null references vendors(id),
  invoice_no    text not null check (length(trim(invoice_no)) >= 1),
  invoice_date  date not null,
  amount        numeric(14,2) not null check (amount > 0),
  notes         text,
  status        text not null default 'submitted' check (status in ('submitted','verified','disputed')),
  decision_note text,
  verified_by   uuid,
  verified_at   timestamptz,
  payable       numeric(14,2),
  submitted_at  timestamptz not null default now(),
  check (status <> 'verified' or payable is not null)
);
create index if not exists trip_invoices_trip_idx on trip_invoices(trip_id);
-- One invoice at a time per trip: a returned (disputed) one may be replaced, a submitted or verified one may not.
create unique index if not exists trip_invoices_one_live on trip_invoices(trip_id) where status in ('submitted','verified');
drop trigger if exists trip_invoices_audit on trip_invoices;
create trigger trip_invoices_audit after insert or update or delete on trip_invoices for each row execute function audit_trigger();

-- Finance checks the invoice. 'pay_approved' pays the awarded amount (the invoice must equal it); 'pay_invoiced' pays what the provider billed when it differs (a note is
-- required); 'return' sends it back (a note is required) so the provider can invoice again. The person who awarded the trip or asked for it cannot check it,
-- except a sole-employee administrator (ADR-077).
create or replace function trip_invoice_verify(p_invoice uuid, p_user uuid, p_decision text, p_note text default null) returns void
language plpgsql as $$
declare inv trip_invoices; t trips; note text := nullif(trim(coalesce(p_note, '')), ''); pay numeric; vname text;
begin
  select * into inv from trip_invoices where id = p_invoice for update;
  if inv.id is null or inv.status <> 'submitted' then raise exception 'that invoice is not waiting for a check'; end if;
  select * into t from trips where id = inv.trip_id for update;
  if not admin_may_decide_own('invoice.verify')
     and (t.decided_by = p_user or exists (select 1 from employees e where e.user_id = p_user and e.id = t.requested_by)) then
    raise exception 'segregation of duties: the person who awarded or asked for this trip cannot check its invoice';
  end if;
  if p_decision not in ('pay_approved','pay_invoiced','return') then raise exception 'choose a decision'; end if;
  if p_decision in ('pay_invoiced','return') and (note is null or length(note) < 5) then raise exception 'a note of at least 5 characters is required'; end if;
  if p_decision = 'pay_approved' and inv.amount <> t.award_amount then raise exception 'the invoice differs from the awarded amount: pay what was billed with a note, or return it'; end if;
  select name into vname from vendors where id = inv.vendor_id;
  if p_decision = 'return' then
    update trip_invoices set status = 'disputed', decision_note = note, verified_by = p_user, verified_at = now() where id = p_invoice;
    insert into trip_events(trip_id, from_status, to_status, actor_id, note) values (t.id, t.status, t.status, p_user, 'Invoice ' || inv.invoice_no || ' from ' || vname || ' returned: ' || note);
  else
    pay := case when p_decision = 'pay_approved' then t.award_amount else inv.amount end;
    update trip_invoices set status = 'verified', payable = pay, decision_note = note, verified_by = p_user, verified_at = now() where id = p_invoice;
    insert into trip_events(trip_id, from_status, to_status, actor_id, note)
      values (t.id, t.status, t.status, p_user, 'Invoice ' || inv.invoice_no || ' from ' || vname || ' checked, payable ' || to_char(pay, 'FM999G999G999G990D00') || coalesce('. ' || note, ''));
  end if;
end $$;
revoke execute on function trip_invoice_verify(uuid, uuid, text, text) from public;

do $mig$
declare s text := current_schema();
begin
  -- What the page shows: the trip, the route, the provider and the amount awarded. Nothing about who asked, any budget or other providers' quotes.
  -- Returns nothing unless the trip was awarded to this provider, is completed, and has no live invoice.
  execute format($f$
    create or replace function trip_invoice_link_info(p_trip uuid, p_vendor uuid)
    returns table (trip_no text, purpose text, from_place text, to_place text, start_at timestamptz, end_at timestamptz, award_amount numeric, vendor_name text)
    language sql stable security definer set search_path = %1$I, public as $b$
      select t.trip_no, t.purpose, t.from_place, t.to_place, t.start_at, t.end_at, t.award_amount, vn.name
        from trips t join vendors vn on vn.id = t.outsourced_vendor_id
       where t.id = p_trip and t.outsourced_vendor_id = p_vendor and t.status = 'completed' and vn.status = 'active'
         and not exists (select 1 from trip_invoices i where i.trip_id = t.id and i.status in ('submitted','verified'))
    $b$
  $f$, s);

  -- Marks the link used and saves the invoice in one step, so a refused invoice never burns a link. The people who check invoices are told.
  execute format($f$
    create or replace function submit_trip_invoice_via_link(p_trip uuid, p_vendor uuid, p jsonb, p_token_hash text)
    returns uuid language plpgsql security definer set search_path = %1$I, public as $b$
    declare t trips; vname text; amt numeric; iid uuid; inv_no text := left(nullif(trim(p->>'invoice_no'), ''), 60); inv_date date;
    begin
      update public.quotation_links k set used_at = now()
       where k.token_hash = p_token_hash and k.trip_id = p_trip and k.vendor_id = p_vendor and k.kind = 'trip_invoice'
         and k.tenant_id = (select x.id from public.tenants x where x.schema_name = current_schema())
         and k.used_at is null and k.revoked_at is null and k.expires_at > now();
      if not found then raise exception 'link is not valid'; end if;
      select * into t from trips where id = p_trip for update;
      select name into vname from vendors where id = p_vendor and status = 'active';
      if t.id is null or t.status <> 'completed' or t.outsourced_vendor_id is distinct from p_vendor or vname is null
         or exists (select 1 from trip_invoices i where i.trip_id = p_trip and i.status in ('submitted','verified')) then
        raise exception 'link is not valid';
      end if;
      if inv_no is null then raise exception 'enter the invoice number'; end if;
      begin amt := nullif(replace(p->>'amount', ',', ''), '')::numeric; exception when others then amt := null; end;
      if amt is null or amt <= 0 or amt > 1000000000 then raise exception 'enter the invoiced amount'; end if;
      begin inv_date := nullif(p->>'invoice_date', '')::date; exception when others then inv_date := null; end;
      if inv_date is null then raise exception 'enter the invoice date'; end if;
      insert into trip_invoices(trip_id, vendor_id, invoice_no, invoice_date, amount, notes)
        values (p_trip, p_vendor, inv_no, inv_date, amt, left(nullif(trim(p->>'notes'), ''), 1000)) returning id into iid;
      insert into trip_events(trip_id, from_status, to_status, actor_id, note)
        values (p_trip, 'completed', 'completed', null, 'Invoice ' || inv_no || ' from ' || vname || ' through a link: ' || to_char(amt, 'FM999G999G999G990D00'));
      insert into notifications(user_id, kind, payload)
        select distinct m.user_id, 'trip.invoice_received', jsonb_build_object('trip_id', t.id, 'trip_no', t.trip_no, 'text', t.trip_no || ': invoice from ' || vname)
          from public.tenant_memberships m
         where m.tenant_id = (select x.id from public.tenants x where x.schema_name = current_schema()) and m.status = 'active'
           and m.role in (select role_key from role_permissions where permission_key = 'invoice.verify');
      return iid;
    end $b$
  $f$, s);

  execute format('revoke all on function %I.trip_invoice_link_info(uuid, uuid) from public', s);
  execute format('revoke all on function %I.submit_trip_invoice_via_link(uuid, uuid, jsonb, text) from public', s);
  execute format('grant execute on function %I.trip_invoice_link_info(uuid, uuid), %I.submit_trip_invoice_via_link(uuid, uuid, jsonb, text) to quotation_link', s, s);
end $mig$;
