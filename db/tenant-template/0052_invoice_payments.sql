-- Tenant migration 0052 (ADR-086): recording payment of workshop invoices and logistics provider trip invoices. Idempotent.
-- Payments are append-only; a mistake is voided with a reason. The two functions below are the only way in and write nothing else.

-- ---------- Permission ----------
insert into permissions(key, description) values
  ('invoice.pay','Record payment of a checked workshop or provider invoice')
on conflict (key) do nothing;
insert into role_permissions(role_key, permission_key)
select r, p from (values ('finance','invoice.pay'),('tenant_admin','invoice.pay')) as x(r, p)
on conflict do nothing;

-- ---------- Payments ----------
create sequence if not exists invoice_payment_seq;
create table if not exists invoice_payments (
  id              uuid primary key default gen_random_uuid(),
  payment_no      text not null unique default ('PAY-' || lpad(nextval('invoice_payment_seq')::text, 6, '0')),
  invoice_id      uuid references invoices(id),
  trip_invoice_id uuid references trip_invoices(id),
  amount          numeric(14,2) not null check (amount > 0),
  paid_on         date not null,
  method          text not null check (method in ('bank_transfer','cheque','cash','online','other')),
  reference       text,
  note            text,
  paid_by         uuid not null,
  created_at      timestamptz not null default now(),
  voided_at       timestamptz,
  voided_by       uuid,
  void_reason     text,
  check ((invoice_id is not null) <> (trip_invoice_id is not null)),
  check ((voided_at is null) = (voided_by is null))
);
create index if not exists invoice_payments_invoice_idx on invoice_payments(invoice_id) where invoice_id is not null;
create index if not exists invoice_payments_trip_invoice_idx on invoice_payments(trip_invoice_id) where trip_invoice_id is not null;

drop trigger if exists invoice_payments_audit on invoice_payments;
create trigger invoice_payments_audit after insert or update or delete on invoice_payments
  for each row execute function audit_trigger();

-- A recorded payment cannot be deleted or changed; only the three void columns may be filled in, once.
create or replace function invoice_payment_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'a payment cannot be deleted: void it instead'; end if;
  if (to_jsonb(new) - 'voided_at' - 'voided_by' - 'void_reason') is distinct from (to_jsonb(old) - 'voided_at' - 'voided_by' - 'void_reason') then
    raise exception 'a recorded payment cannot be changed: void it and record it again';
  end if;
  if old.voided_at is not null then raise exception 'this payment is already void'; end if;
  return new;
end $$;
drop trigger if exists invoice_payments_no_change on invoice_payments;
create trigger invoice_payments_no_change before update or delete on invoice_payments
  for each row execute function invoice_payment_guard();

-- ---------- Record a payment ----------
-- p_kind is 'workshop' (a row of invoices) or 'trip' (a row of trip_invoices). Returns the new payment's id.
create or replace function record_invoice_payment(
  p_kind text, p_invoice uuid, p_user uuid, p_amount numeric, p_paid_on date, p_method text,
  p_reference text default null, p_note text default null
) returns uuid language plpgsql as $$
declare
  inv invoices; tinv trip_invoices; wo work_orders; jc job_cards; t trips;
  due numeric; already numeric; pid uuid;
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
    select * into wo from work_orders where id = inv.work_order_id;
    select * into jc from job_cards where id = wo.job_card_id;
    if not admin_may_decide_own('invoice.pay')
       and (inv.verified_by = p_user or exists (select 1 from employees e where e.user_id = p_user and e.id in (jc.approved_by, jc.requested_by))) then
      raise exception 'segregation of duties: the person who checked the invoice, or approved or raised the job card, cannot record its payment';
    end if;
    due := coalesce(inv.payable_amount, inv.amount) + inv.tax_amount;
    select coalesce(sum(amount), 0) into already from invoice_payments where invoice_id = inv.id and voided_at is null;
    no := inv.invoice_no;
  else
    select * into tinv from trip_invoices where id = p_invoice for update;
    if tinv.id is null then raise exception 'invoice not found'; end if;
    if tinv.status <> 'verified' then raise exception 'only a checked invoice can be paid'; end if;
    select * into t from trips where id = tinv.trip_id for update;
    if not admin_may_decide_own('invoice.pay')
       and (tinv.verified_by = p_user or t.decided_by = p_user or exists (select 1 from employees e where e.user_id = p_user and e.id = t.requested_by)) then
      raise exception 'segregation of duties: the person who checked the invoice, or awarded or asked for the trip, cannot record its payment';
    end if;
    due := tinv.payable;
    select coalesce(sum(amount), 0) into already from invoice_payments where trip_invoice_id = tinv.id and voided_at is null;
    if already >= due then raise exception 'this invoice is already paid in full'; end if;
    no := tinv.invoice_no;
    select name into vname from vendors where id = tinv.vendor_id;
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

-- ---------- Void a payment ----------
create or replace function void_invoice_payment(p_payment uuid, p_user uuid, p_reason text) returns void
language plpgsql as $$
declare p invoice_payments; why text := nullif(trim(coalesce(p_reason, '')), ''); t trips; tinv trip_invoices;
begin
  select * into p from invoice_payments where id = p_payment for update;
  if p.id is null then raise exception 'payment not found'; end if;
  if p.voided_at is not null then raise exception 'this payment is already void'; end if;
  if why is null or length(why) < 5 then raise exception 'a reason of at least 5 characters is required'; end if;
  update invoice_payments set voided_at = now(), voided_by = p_user, void_reason = why where id = p_payment;
  if p.invoice_id is not null then
    update invoices set status = 'verified' where id = p.invoice_id and status = 'paid';
  else
    select * into tinv from trip_invoices where id = p.trip_invoice_id;
    select * into t from trips where id = tinv.trip_id;
    insert into trip_events(trip_id, from_status, to_status, actor_id, note)
      values (t.id, t.status, t.status, p_user, 'Payment ' || p.payment_no || ' of ' || to_char(p.amount, 'FM999G999G999G990D00') || ' for invoice ' || tinv.invoice_no || ' voided: ' || why);
  end if;
end $$;

-- Stay closed to every role by default (migration 0037); the app's own login is the owner and needs no grant.
revoke execute on function record_invoice_payment(text, uuid, uuid, numeric, date, text, text, text) from public;
revoke execute on function void_invoice_payment(uuid, uuid, text) from public;
revoke execute on function invoice_payment_guard() from public;
