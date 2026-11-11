-- Tenant migration 0057 (ADR-090): owner decision C1 of 2026-11-11. Ask two or three workshops for an estimate on the same job card. Idempotent.
--
-- Model: job_cards.vendor_id stays "the workshop on the card" (the first one asked; after approval, the winner, so invoices, links and
-- everything downstream keep working unchanged). Extra workshops asked for an estimate are rows in job_card_invitees. At most three workshops
-- in all (the first one plus two more).
--   * Any asked workshop may send ONE estimate while the card is waiting (vendor_assigned) or has estimates in (quotation_received).
--   * The card moves to quotation_received on the first estimate; later estimates just join it.
--   * Approving one estimate declines the other waiting ones, makes its workshop the card's workshop, and issues the work order.
--   * Declining one estimate sends the card back to vendor_assigned only when no other estimate is waiting for a decision.
-- The unauthenticated workshop-link functions keep their shape; only the "is this workshop asked?" test changed (workshop_invited).

create table if not exists job_card_invitees (
  job_card_id uuid not null references job_cards(id) on delete cascade,
  vendor_id   uuid not null references vendors(id),
  invited_by  uuid,
  invited_at  timestamptz not null default now(),
  primary key (job_card_id, vendor_id)
);
drop trigger if exists job_card_invitees_audit on job_card_invitees;
create trigger job_card_invitees_audit after insert or update or delete on job_card_invitees
  for each row execute function audit_trigger();

-- Is this workshop one of those asked for an estimate on this card?
create or replace function workshop_invited(p_job uuid, p_vendor uuid) returns boolean language sql stable as $$
  select exists (select 1 from job_cards where id = p_job and vendor_id = p_vendor)
      or exists (select 1 from job_card_invitees where job_card_id = p_job and vendor_id = p_vendor)
$$;

-- Does the workshop already have an estimate waiting for a decision on this card? (One at a time; a declined one may be replaced.)
create or replace function workshop_has_waiting_estimate(p_job uuid, p_vendor uuid) returns boolean language sql stable as $$
  select exists (select 1 from quotations where job_card_id = p_job and vendor_id = p_vendor and status = 'submitted')
$$;

-- Ask one more workshop. The caller's permission is checked by the app; the rules of the card are checked here.
create or replace function invite_workshop(p_job uuid, p_vendor uuid, p_user uuid) returns void language plpgsql as $$
declare jc job_cards;
begin
  select * into jc from job_cards where id = p_job for update;
  if jc.id is null then raise exception 'job card not found'; end if;
  if jc.status not in ('vendor_assigned','quotation_received') then raise exception 'estimates can be asked for only while the job card is waiting for them'; end if;
  if not exists (select 1 from vendors where id = p_vendor and status = 'active') then raise exception 'choose an active workshop'; end if;
  if workshop_invited(p_job, p_vendor) then raise exception 'this workshop is already asked'; end if;
  if 1 + (select count(*) from job_card_invitees where job_card_id = p_job) >= 3 then raise exception 'at most three workshops can be asked on one job card'; end if;
  insert into job_card_invitees(job_card_id, vendor_id, invited_by) values (p_job, p_vendor, p_user);
end $$;

-- Take back a request that has not been answered. The first workshop on the card is changed by assigning again, not here.
create or replace function uninvite_workshop(p_job uuid, p_vendor uuid) returns void language plpgsql as $$
begin
  if exists (select 1 from quotations where job_card_id = p_job and vendor_id = p_vendor) then raise exception 'this workshop has already sent an estimate'; end if;
  delete from job_card_invitees where job_card_id = p_job and vendor_id = p_vendor;
  if not found then raise exception 'this workshop was not asked as an extra workshop'; end if;
end $$;

-- ---------- The workshop signs in (0007) ----------
create or replace function submit_quotation(p_job uuid, p_user uuid, p jsonb) returns uuid language plpgsql as $$
declare jc job_cards; vid uuid := vendor_of(p_user); qid uuid; l jsonb;
begin
  if vid is null then raise exception 'this login is not linked to an active vendor'; end if;
  select * into jc from job_cards where id = p_job for update;
  if jc.id is null or not workshop_invited(p_job, vid) then raise exception 'job card not found'; end if;
  if jc.status not in ('vendor_assigned','quotation_received') then raise exception 'this job is not waiting for a quotation'; end if;
  if workshop_has_waiting_estimate(p_job, vid) then raise exception 'you have already sent an estimate for this job'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'add at least one line'; end if;
  insert into quotations(job_card_id, vendor_id, amount, details, days_needed, valid_until, warranty_months)
  values (p_job, vid, 0, nullif(p->>'details', ''), nullif(p->>'days_needed', '')::int,
          nullif(p->>'valid_until', '')::date, nullif(p->>'warranty_months', '')::int)
  returning id into qid;
  for l in select * from jsonb_array_elements(p->'lines') loop
    insert into quotation_lines(quotation_id, kind, description, qty, unit_cost)
    values (qid, coalesce(nullif(l->>'kind', ''), 'service'), l->>'description',
            coalesce(nullif(l->>'qty', '')::numeric, 1), coalesce(nullif(l->>'unit_cost', '')::numeric, 0));
  end loop;
  if jc.status = 'vendor_assigned' then perform transition_job_card(p_job, 'quotation_received', p_user); end if;
  return qid;
end $$;

-- ---------- Approve (0054) ----------
-- As 0054, plus: the other waiting estimates are declined, the winner becomes the card's workshop, and the declined workshops are told.
create or replace function approve_quotation(p_quotation uuid, p_user uuid, p_note text default null) returns uuid
language plpgsql as $$
declare q quotations; jc job_cards; wid uuid; me uuid := actor_employee(p_user);
begin
  select * into q from quotations where id = p_quotation for update;
  if q.id is null then raise exception 'quotation not found'; end if;
  select * into jc from job_cards where id = q.job_card_id for update;
  if q.status <> 'submitted' or jc.status <> 'quotation_received' then raise exception 'this quotation is not awaiting a decision'; end if;
  if me is not null and me = jc.requested_by and not admin_may_decide_own('quotation.approve', jc.vehicle_id, q.amount) then
    raise exception 'segregation of duties: the requester cannot approve the quotation';
  end if;
  if admin_blocked_from_others('quotation.approve') then
    raise exception 'company rule: the administrator does not decide quotations while a fleet manager or other approver is active';
  end if;
  update quotations set status = 'approved' where id = q.id;
  insert into notifications(user_id, kind, payload)
    select distinct vn.user_id, 'quotation.rejected', jsonb_build_object('job_card_id', jc.id, 'job_no', jc.job_no)
      from quotations o join vendors vn on vn.id = o.vendor_id
     where o.job_card_id = jc.id and o.status = 'submitted' and o.id <> q.id and vn.user_id is not null;
  update quotations set status = 'rejected' where job_card_id = jc.id and status = 'submitted' and id <> q.id;
  if jc.vendor_id is distinct from q.vendor_id then update job_cards set vendor_id = q.vendor_id where id = jc.id; end if;
  insert into work_orders(wo_no, job_card_id, vendor_id, quotation_id, approved_amount)
  values ('WO-' || lpad(nextval('work_order_seq')::text, 6, '0'), jc.id, q.vendor_id, q.id, q.amount)
  returning id into wid;
  perform transition_job_card(jc.id, 'quotation_approved', p_user, p_note);
  return wid;
end $$;

-- ---------- Decline (0007) ----------
create or replace function reject_quotation(p_quotation uuid, p_user uuid, p_note text) returns void language plpgsql as $$
declare q quotations; jc job_cards; who text;
begin
  if length(trim(coalesce(p_note, ''))) < 5 then raise exception 'a comment of at least 5 characters is required'; end if;
  select * into q from quotations where id = p_quotation for update;
  if q.id is null then raise exception 'quotation not found'; end if;
  select * into jc from job_cards where id = q.job_card_id for update;
  if q.status <> 'submitted' or jc.status <> 'quotation_received' then raise exception 'this quotation is not awaiting a decision'; end if;
  update quotations set status = 'rejected' where id = q.id;
  if exists (select 1 from quotations where job_card_id = jc.id and status = 'submitted') then
    -- other estimates are still waiting: the card stays as it is, and the history says what happened
    select name into who from vendors where id = q.vendor_id;
    insert into job_card_events(job_card_id, from_status, to_status, actor_id, comment)
    values (jc.id, jc.status, jc.status, p_user, 'Estimate from ' || coalesce(who, 'a workshop') || ' declined: ' || trim(p_note));
  else
    perform transition_job_card(jc.id, 'vendor_assigned', p_user, p_note);
  end if;
end $$;

-- ---------- The workshop signs in: what it sees (0014) ----------
create or replace view v_vendor_job_requests as
select jc.id as job_card_id, jc.job_no, jc.status as job_status, jc.priority, jc.needed_by, jc.description, jc.cause_text,
       jc.odometer_km, vn.id as vendor_id, v.registration_no, v.make, v.model, v.year,
       (select q.status from quotations q where q.job_card_id = jc.id and q.vendor_id = vn.id order by q.created_at desc limit 1) as last_quotation_status,
       (select max(e.created_at) from job_card_events e where e.job_card_id = jc.id and e.to_status = 'vendor_assigned') as assigned_at
from job_cards jc join vehicles v on v.id = jc.vehicle_id
join vendors vn on vn.user_id::text = current_setting('app.user_id', true)
where jc.status in ('vendor_assigned','quotation_received') and workshop_invited(jc.id, vn.id);

-- Hardening as in 0037: a view runs with its caller's rights, and no function is open to every role.
alter view v_vendor_job_requests set (security_invoker = true);
revoke execute on function workshop_invited(uuid, uuid) from public;
revoke execute on function workshop_has_waiting_estimate(uuid, uuid) from public;
revoke execute on function invite_workshop(uuid, uuid, uuid) from public;
revoke execute on function uninvite_workshop(uuid, uuid) from public;

-- ---------- The unauthenticated workshop links and the emailed reply (0022, 0023, 0024) ----------
do $mig$
declare s text := current_schema();
begin
  -- Nothing about who raised the card, what it may cost or who else was asked. Nothing unless this workshop is asked and has no estimate waiting.
  execute format($f$
    create or replace function quote_link_info(p_job uuid, p_vendor uuid)
    returns table (job_no text, registration_no text, make text, model text, year int, description text, cause_text text, needed_by date, vendor_name text)
    language sql stable security definer set search_path = %1$I, public as $b$
      select jc.job_no, v.registration_no, v.make, v.model, v.year, jc.description, jc.cause_text, jc.needed_by, vn.name
        from job_cards jc join vehicles v on v.id = jc.vehicle_id join vendors vn on vn.id = p_vendor
       where jc.id = p_job and workshop_invited(jc.id, p_vendor) and jc.status in ('vendor_assigned','quotation_received')
         and not workshop_has_waiting_estimate(jc.id, p_vendor) and vn.status = 'active'
    $b$
  $f$, s);

  execute format($f$
    create or replace function submit_quotation_via_link(p_job uuid, p_vendor uuid, p jsonb, p_token_hash text)
    returns uuid language plpgsql security definer set search_path = %1$I, public as $b$
    declare jc job_cards; qid uuid; l jsonb; n int := 0;
    begin
      update public.quotation_links k set used_at = now()
       where k.token_hash = p_token_hash and k.job_card_id = p_job and k.vendor_id = p_vendor and k.kind = 'quotation'
         and k.tenant_id = (select t.id from public.tenants t where t.schema_name = current_schema())
         and k.used_at is null and k.revoked_at is null and k.expires_at > now();
      if not found then raise exception 'link is not valid'; end if;
      select * into jc from job_cards where id = p_job for update;
      if jc.id is null or not workshop_invited(p_job, p_vendor) or jc.status not in ('vendor_assigned','quotation_received')
         or workshop_has_waiting_estimate(p_job, p_vendor)
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
      if jc.status = 'vendor_assigned' then
        perform transition_job_card(p_job, 'quotation_received', null, coalesce(nullif(left(p->>'comment', 200), ''), 'Estimate sent by the workshop through a link'));
      end if;
      insert into notifications(user_id, kind, payload)
        select distinct m.user_id, 'quotation.received', jsonb_build_object('job_card_id', p_job, 'job_no', jc.job_no, 'to', 'quotation_received')
          from public.tenant_memberships m
         where m.tenant_id = (select t.id from public.tenants t where t.schema_name = current_schema()) and m.status = 'active'
           and m.role in (select role_key from role_permissions where permission_key = 'quotation.approve');
      return qid;
    end $b$
  $f$, s);

  execute format($f$
    create or replace function inbound_target(p_job uuid, p_vendor uuid, p_kind text)
    returns table (job_no text, vendor_name text, vendor_email text)
    language sql stable security definer set search_path = %1$I, public as $b$
      select jc.job_no, vn.name, vn.email
        from job_cards jc join vendors vn on vn.id = p_vendor
       where jc.id = p_job and vn.status = 'active'
         and ((p_kind = 'quotation' and workshop_invited(jc.id, p_vendor) and jc.status in ('vendor_assigned', 'quotation_received'))
           or (p_kind = 'invoice'   and jc.vendor_id = p_vendor and jc.status in ('quotation_approved', 'in_progress', 'completed', 'invoiced')))
    $b$
  $f$, s);

  execute format($f$
    create or replace function file_workshop_email(p_job uuid, p_vendor uuid, p_kind text, p_from text, p_subject text, p_body text, p_message_id text)
    returns uuid language plpgsql security definer set search_path = %1$I, public as $b$
    declare jc job_cards; vn vendors; eid uuid; perm text := case when p_kind = 'quotation' then 'quotation.approve' else 'invoice.verify' end;
    begin
      if p_kind not in ('quotation', 'invoice') then raise exception 'unknown kind'; end if;
      select * into jc from job_cards where id = p_job;
      select * into vn from vendors where id = p_vendor;
      if jc.id is null or vn.id is null or not workshop_invited(p_job, p_vendor) then raise exception 'reply is not valid'; end if;
      if p_message_id is not null then
        select id into eid from workshop_emails where message_id = p_message_id;
        if eid is not null then return eid; end if;
      end if;
      insert into workshop_emails(job_card_id, vendor_id, kind, from_address, sender_matches, subject, body_text, message_id)
      values (p_job, p_vendor, p_kind, left(p_from, 320), lower(trim(coalesce(vn.email, ''))) = lower(trim(p_from)),
              left(p_subject, 300), left(p_body, 20000), left(p_message_id, 400))
      returning id into eid;
      insert into notifications(user_id, kind, payload)
        select distinct m.user_id, 'workshop.email', jsonb_build_object('job_card_id', p_job, 'job_no', jc.job_no, 'kind', p_kind)
          from public.tenant_memberships m
         where m.tenant_id = (select t.id from public.tenants t where t.schema_name = current_schema()) and m.status = 'active'
           and m.role in (select role_key from role_permissions where permission_key = perm);
      return eid;
    end $b$
  $f$, s);

  execute format('revoke all on function %I.quote_link_info(uuid, uuid) from public', s);
  execute format('revoke all on function %I.submit_quotation_via_link(uuid, uuid, jsonb, text) from public', s);
  execute format('revoke all on function %I.inbound_target(uuid, uuid, text) from public', s);
  execute format('revoke all on function %I.file_workshop_email(uuid, uuid, text, text, text, text, text) from public', s);
  execute format('grant execute on function %I.quote_link_info(uuid, uuid), %I.submit_quotation_via_link(uuid, uuid, jsonb, text) to quotation_link', s, s);
end $mig$;
