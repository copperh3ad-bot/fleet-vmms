-- Tenant migration 0053 (ADR-087): who may read invoices, and when a payment needs a second person's approval. Idempotent.
-- Owner decisions 2026-11-11 (docs/OWNER-DECISIONS-2026-11-11.md): A4 the auditor reads invoices and payments; B1 Finance may check and pay the same
-- invoice; B2 an invoice above 50,000 needs a Fleet Manager or Admin to approve before payment; B3 an invoice more than 10% above the approved quote
-- needs the same approval. Supersedes the checker-cannot-pay rule of migration 0052.

-- ---------- Permissions ----------
insert into permissions(key, description) values
  ('invoice.read','See invoices and the payments recorded against them'),
  ('invoice.approve_payment','Approve a payment that is over the limit or over the approved quote')
on conflict (key) do nothing;
insert into role_permissions(role_key, permission_key)
select r, p from (values
  ('finance','invoice.read'),('tenant_admin','invoice.read'),('auditor','invoice.read'),('fleet_manager','invoice.read'),
  ('fleet_manager','invoice.approve_payment'),('tenant_admin','invoice.approve_payment')
) as x(r, p)
on conflict do nothing;

-- ---------- Settings (the guard must know the keys BEFORE they are inserted) ----------
create or replace function settings_guard() returns trigger language plpgsql as $$
begin
  if new.key = 'doc_reminder_days' then
    if new.value !~ '^[0-9]+(,[0-9]+)*$' then raise exception 'doc_reminder_days must look like 60,30,14'; end if;
  elsif new.key = 'module_trips' then
    if new.value not in ('0','1') then raise exception 'module_trips must be 0 or 1'; end if;
  elsif new.key = 'odometer_whatsapp' then
    if new.value not in ('0','1') then raise exception 'odometer_whatsapp must be 0 or 1'; end if;
  elsif new.key = 'allow_learner_licence' then
    if new.value not in ('0','1') then raise exception 'allow_learner_licence must be 0 or 1'; end if;
  elsif new.key = 'odometer_send_day' then
    if new.value !~ '^[0-9]+$' or new.value::int not between 1 and 28 then raise exception 'odometer_send_day must be a day from 1 to 28'; end if;
  elsif new.key in ('dept_approval_limit','payment_approval_limit') then
    if new.value <> '' and new.value !~ '^[0-9]+(\.[0-9]+)?$' then raise exception '% must be a number or empty', new.key; end if;
  elsif new.key = 'invoice_over_quote_pct' then
    if new.value !~ '^[0-9]+(\.[0-9]+)?$' or new.value::numeric > 1000 then raise exception 'invoice_over_quote_pct must be a number up to 1000'; end if;
  elsif new.key in ('pm_warning_days','pm_warning_km','pm_warning_hours','odometer_max_km_per_day','odometer_stale_days','odometer_due_day',
                    'budget_warn_pct','budget_flag_pct','flag_jobs_90d','flag_repeat_days','flag_cost_multiple',
                    'policy_replace_years','policy_free_accidents','policy_accident_gap_months','policy_driver_share_pct') then
    if new.value !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'setting % must be a number', new.key; end if;
    if new.key = 'policy_driver_share_pct' and new.value::numeric > 100 then raise exception 'policy_driver_share_pct cannot be above 100'; end if;
  else
    raise exception 'unknown setting %', new.key;
  end if;
  return new;
end $$;
insert into settings(key, value) values ('payment_approval_limit', '50000') on conflict (key) do nothing;
insert into settings(key, value) values ('invoice_over_quote_pct', '10') on conflict (key) do nothing;

-- ---------- When does a payment need approval? ----------
-- Returns null (no approval needed), 'amount' (the invoice total is above the limit; empty limit means none), 'over_quote' (what is payable is more than
-- the approved quote or award by more than the percentage) or 'both'. The limit applies to the invoice total, not to each part payment, so splitting a
-- payment does not get round it.
create or replace function payment_approval_needed(p_kind text, p_invoice uuid) returns text language plpgsql stable as $$
declare lim numeric; pct numeric; due numeric; payable numeric; approved numeric; by_amount boolean; by_quote boolean;
begin
  select nullif(value, '')::numeric into lim from settings where key = 'payment_approval_limit';
  select nullif(value, '')::numeric into pct from settings where key = 'invoice_over_quote_pct';
  pct := coalesce(pct, 10);
  if p_kind = 'workshop' then
    select coalesce(i.payable_amount, i.amount) + i.tax_amount, coalesce(i.payable_amount, i.amount), wo.approved_amount
      into due, payable, approved
      from invoices i join work_orders wo on wo.id = i.work_order_id where i.id = p_invoice;
  else
    select ti.payable, ti.payable, t.award_amount into due, payable, approved
      from trip_invoices ti join trips t on t.id = ti.trip_id where ti.id = p_invoice;
  end if;
  if due is null then return null; end if;
  by_amount := lim is not null and due > lim;
  by_quote := approved is not null and approved > 0 and payable > approved * (1 + pct / 100);
  return case when by_amount and by_quote then 'both' when by_amount then 'amount' when by_quote then 'over_quote' end;
end $$;

-- ---------- Approvals ----------
create table if not exists payment_approvals (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid references invoices(id),
  trip_invoice_id uuid references trip_invoices(id),
  reason          text not null check (reason in ('amount','over_quote','both')),
  approved_by     uuid not null,
  approved_at     timestamptz not null default now(),
  note            text,
  check ((invoice_id is not null) <> (trip_invoice_id is not null))
);
create unique index if not exists payment_approvals_invoice_uq on payment_approvals(invoice_id) where invoice_id is not null;
create unique index if not exists payment_approvals_trip_invoice_uq on payment_approvals(trip_invoice_id) where trip_invoice_id is not null;
drop trigger if exists payment_approvals_audit on payment_approvals;
create trigger payment_approvals_audit after insert or update or delete on payment_approvals for each row execute function audit_trigger();
create or replace function payment_approval_guard() returns trigger language plpgsql as $$
begin raise exception 'a payment approval cannot be changed or deleted'; end $$;
drop trigger if exists payment_approvals_no_change on payment_approvals;
create trigger payment_approvals_no_change before update or delete on payment_approvals for each row execute function payment_approval_guard();

create or replace function approve_invoice_payment(p_kind text, p_invoice uuid, p_user uuid, p_note text default null) returns uuid
language plpgsql as $$
declare st text; need text; pid uuid; note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if p_kind not in ('workshop','trip') then raise exception 'unknown invoice kind'; end if;
  if p_kind = 'workshop' then select status into st from invoices where id = p_invoice for update;
  else select status into st from trip_invoices where id = p_invoice for update; end if;
  if st is null then raise exception 'invoice not found'; end if;
  if st <> 'verified' then raise exception 'only a checked invoice can be approved for payment'; end if;
  need := payment_approval_needed(p_kind, p_invoice);
  if need is null then raise exception 'this invoice does not need a payment approval'; end if;
  if exists (select 1 from payment_approvals where (p_kind = 'workshop' and invoice_id = p_invoice) or (p_kind = 'trip' and trip_invoice_id = p_invoice)) then
    raise exception 'this invoice is already approved for payment';
  end if;
  if need in ('over_quote','both') and (note is null or length(note) < 5) then raise exception 'a reason of at least 5 characters is required'; end if;
  insert into payment_approvals(invoice_id, trip_invoice_id, reason, approved_by, note)
    values (case when p_kind = 'workshop' then p_invoice end, case when p_kind = 'trip' then p_invoice end, need, p_user, note) returning id into pid;
  return pid;
end $$;

-- ---------- Record a payment (replaces 0052: the checker may now pay; amount-based approval takes over the separation) ----------
create or replace function record_invoice_payment(
  p_kind text, p_invoice uuid, p_user uuid, p_amount numeric, p_paid_on date, p_method text,
  p_reference text default null, p_note text default null
) returns uuid language plpgsql as $$
declare
  inv invoices; tinv trip_invoices; t trips;
  due numeric; already numeric; pid uuid; need text; approver uuid;
  ref text := nullif(trim(coalesce(p_reference, '')), '');
  note text := nullif(trim(coalesce(p_note, '')), '');
  vname text; no text;
begin
  if p_kind not in ('workshop','trip') then raise exception 'unknown invoice kind'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'enter the amount paid'; end if;
  if p_paid_on is null then raise exception 'enter the date of payment'; end if;
  if p_paid_on > current_date then raise exception 'the payment date cannot be in the future'; end if;
  if p_method is null or p_method not in ('bank_transfer','cheque','cash','online','other') then raise exception 'choose how it was paid'; end if;
  if p_method <> 'cash' and (ref is null or length(ref) < 3) then raise exception 'enter the payment reference, such as the cheque number or transfer id'; end if;

  if p_kind = 'workshop' then
    select * into inv from invoices where id = p_invoice for update;
    if inv.id is null then raise exception 'invoice not found'; end if;
    if inv.status = 'paid' then raise exception 'this invoice is already paid in full'; end if;
    if inv.status <> 'verified' then raise exception 'only a checked invoice can be paid'; end if;
    due := coalesce(inv.payable_amount, inv.amount) + inv.tax_amount;
    select coalesce(sum(amount), 0) into already from invoice_payments where invoice_id = inv.id and voided_at is null;
    select approved_by into approver from payment_approvals where invoice_id = inv.id;
    no := inv.invoice_no;
  else
    select * into tinv from trip_invoices where id = p_invoice for update;
    if tinv.id is null then raise exception 'invoice not found'; end if;
    if tinv.status <> 'verified' then raise exception 'only a checked invoice can be paid'; end if;
    select * into t from trips where id = tinv.trip_id for update;
    due := tinv.payable;
    select coalesce(sum(amount), 0) into already from invoice_payments where trip_invoice_id = tinv.id and voided_at is null;
    if already >= due then raise exception 'this invoice is already paid in full'; end if;
    select approved_by into approver from payment_approvals where trip_invoice_id = tinv.id;
    no := tinv.invoice_no;
    select name into vname from vendors where id = tinv.vendor_id;
  end if;

  need := payment_approval_needed(p_kind, p_invoice);
  if need is not null then
    if approver is null then
      raise exception 'this invoice needs approval before it can be paid (%)',
        case need when 'amount' then 'it is over the payment limit' when 'over_quote' then 'it is over the approved quote' else 'it is over the payment limit and over the approved quote' end;
    end if;
    if approver = p_user and not admin_may_decide_own('invoice.approve_payment') then
      raise exception 'segregation of duties: the person who approved this payment cannot also record it';
    end if;
  end if;

  if already + p_amount > due then
    raise exception 'this payment would take the total above the amount due (due %, already paid %)', to_char(due, 'FM999G999G999G990D00'), to_char(already, 'FM999G999G999G990D00');
  end if;

  insert into invoice_payments(invoice_id, trip_invoice_id, amount, paid_on, method, reference, note, paid_by)
    values (case when p_kind = 'workshop' then inv.id end, case when p_kind = 'trip' then tinv.id end, p_amount, p_paid_on, p_method, ref, note, p_user)
    returning id into pid;

  if p_kind = 'workshop' then
    if already + p_amount = due then update invoices set status = 'paid' where id = inv.id; end if;
  else
    insert into trip_events(trip_id, from_status, to_status, actor_id, note)
      values (t.id, t.status, t.status, p_user, 'Payment of ' || to_char(p_amount, 'FM999G999G999G990D00') || ' recorded for invoice ' || no || ' from ' || coalesce(vname, 'the provider')
              || case when already + p_amount = due then ': paid in full' else ' (part payment)' end);
  end if;
  return pid;
end $$;

revoke execute on function payment_approval_needed(text, uuid) from public;
revoke execute on function approve_invoice_payment(text, uuid, uuid, text) from public;
revoke execute on function payment_approval_guard() from public;
revoke execute on function record_invoice_payment(text, uuid, uuid, numeric, date, text, text, text) from public;
