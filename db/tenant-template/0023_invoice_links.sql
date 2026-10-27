-- Tenant migration 0023: what the unauthenticated workshop INVOICE link (ADR-033) may do. Idempotent.
-- Workshops are added by each organization and never sign up, so everything a workshop sends goes through a one-time link. The route runs as
-- role quotation_link (0022): no table access, only EXECUTE on SECURITY DEFINER functions with a pinned search_path. This migration adds two
-- functions for invoices and re-states the estimate function so an estimate can only be sent with an ESTIMATE link (kind = 'quotation').

do $mig$
declare s text := current_schema();
begin
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

  -- What the invoice page shows: the job, the vehicle, and the lines of the APPROVED quotation so the workshop bills against them. Nothing about
  -- who raised the job, any budget, or other workshops. Returns nothing unless the work order is this workshop's, the work is not yet invoiced
  -- and no invoice is already open.
  execute format($f$
    create or replace function invoice_link_info(p_job uuid, p_vendor uuid)
    returns table (job_no text, registration_no text, make text, model text, year int, description text, wo_no text, approved_amount numeric, vendor_name text, lines jsonb)
    language sql stable security definer set search_path = %1$I, public as $b$
      select jc.job_no, v.registration_no, v.make, v.model, v.year, jc.description, wo.wo_no, wo.approved_amount, vn.name,
             coalesce((select jsonb_agg(jsonb_build_object('id', ql.id, 'kind', ql.kind, 'description', ql.description, 'qty', ql.qty, 'unit_cost', ql.unit_cost) order by ql.id)
                         from quotation_lines ql where ql.quotation_id = wo.quotation_id), '[]'::jsonb)
        from job_cards jc
        join vehicles v on v.id = jc.vehicle_id
        join work_orders wo on wo.job_card_id = jc.id and wo.vendor_id = p_vendor and wo.status in ('issued','in_progress','completed')
        join vendors vn on vn.id = wo.vendor_id
       where jc.id = p_job and vn.status = 'active' and jc.status in ('quotation_approved','in_progress','completed')
         and not exists (select 1 from invoices i where i.work_order_id = wo.id and i.status in ('submitted','verified','paid'))
    $b$
  $f$, s);

  -- Marks the link used and saves the invoice in one step, so a refused invoice never burns a link. The workshop is not a user, so it cannot press
  -- "start" and "complete"; sending its invoice records the work as done (and says so in the job card's history) and then moves the job card to
  -- "invoiced", exactly where the signed-in route would end up. The people who check invoices are told.
  execute format($f$
    create or replace function submit_invoice_via_link(p_job uuid, p_vendor uuid, p jsonb, p_token_hash text)
    returns uuid language plpgsql security definer set search_path = %1$I, public as $b$
    declare wo work_orders; jc job_cards; iid uuid; l jsonb; total numeric; qlid uuid;
    begin
      update public.quotation_links k set used_at = now()
       where k.token_hash = p_token_hash and k.job_card_id = p_job and k.vendor_id = p_vendor and k.kind = 'invoice'
         and k.tenant_id = (select t.id from public.tenants t where t.schema_name = current_schema())
         and k.used_at is null and k.revoked_at is null and k.expires_at > now();
      if not found then raise exception 'link is not valid'; end if;
      select * into jc from job_cards where id = p_job for update;
      select * into wo from work_orders where job_card_id = p_job and vendor_id = p_vendor and status in ('issued','in_progress','completed') order by issued_at desc limit 1 for update;
      if jc.id is null or wo.id is null or jc.status not in ('quotation_approved','in_progress','completed')
         or not exists (select 1 from vendors where id = p_vendor and status = 'active')
         or exists (select 1 from invoices where work_order_id = wo.id and status in ('submitted','verified','paid')) then
        raise exception 'link is not valid';
      end if;
      if length(trim(coalesce(p->>'invoice_no', ''))) = 0 then raise exception 'enter the invoice number'; end if;
      if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'add at least one line'; end if;
      if jsonb_array_length(p->'lines') > 50 then raise exception 'too many lines'; end if;
      for l in select * from jsonb_array_elements(p->'lines') loop
        qlid := nullif(l->>'quotation_line_id', '')::uuid;
        if qlid is not null and not exists (select 1 from quotation_lines where id = qlid and quotation_id = wo.quotation_id) then
          raise exception 'an invoice line points at a line that is not in the approved quotation';
        end if;
      end loop;

      if wo.status = 'issued' then
        update work_orders set status = 'in_progress' where id = wo.id;
        perform transition_job_card(p_job, 'in_progress', null, 'Work recorded as started when the workshop sent its invoice');
      end if;
      if wo.status in ('issued', 'in_progress') then
        update work_orders set status = 'completed', completed_at = now() where id = wo.id;
        perform transition_job_card(p_job, 'completed', null, 'Work recorded as done when the workshop sent its invoice');
      end if;

      total := (select coalesce(sum(coalesce(nullif(e->>'qty', '')::numeric, 1) * coalesce(nullif(e->>'unit_cost', '')::numeric, 0)), 0)
                  from jsonb_array_elements(p->'lines') e);
      insert into invoices(work_order_id, invoice_no, invoice_date, amount, tax_amount)
      values (wo.id, left(trim(p->>'invoice_no'), 60), coalesce(nullif(p->>'invoice_date', '')::date, current_date), total,
              coalesce(nullif(p->>'tax_amount', '')::numeric, 0))
      returning id into iid;
      for l in select * from jsonb_array_elements(p->'lines') loop
        insert into invoice_lines(invoice_id, quotation_line_id, kind, description, qty, unit_cost)
        values (iid, nullif(l->>'quotation_line_id', '')::uuid, coalesce(nullif(l->>'kind', ''), 'service'), left(l->>'description', 300),
                coalesce(nullif(l->>'qty', '')::numeric, 1), coalesce(nullif(l->>'unit_cost', '')::numeric, 0));
      end loop;
      perform transition_job_card(p_job, 'invoiced', null, 'Invoice sent by the workshop through a link');
      insert into notifications(user_id, kind, payload)
        select distinct m.user_id, 'invoice.submitted', jsonb_build_object('job_card_id', p_job, 'job_no', jc.job_no, 'to', 'invoiced')
          from public.tenant_memberships m
         where m.tenant_id = (select t.id from public.tenants t where t.schema_name = current_schema()) and m.status = 'active'
           and m.role in (select role_key from role_permissions where permission_key = 'invoice.verify');
      return iid;
    end $b$
  $f$, s);

  execute format('revoke all on function %I.invoice_link_info(uuid, uuid) from public', s);
  execute format('revoke all on function %I.submit_invoice_via_link(uuid, uuid, jsonb, text) from public', s);
  execute format('revoke all on function %I.submit_quotation_via_link(uuid, uuid, jsonb, text) from public', s);
  execute format('grant usage on schema %I to quotation_link', s);
  execute format('grant execute on function %I.invoice_link_info(uuid, uuid), %I.submit_invoice_via_link(uuid, uuid, jsonb, text), %I.submit_quotation_via_link(uuid, uuid, jsonb, text) to quotation_link', s, s, s);
end $mig$;
