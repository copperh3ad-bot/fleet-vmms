-- Platform migration 0015: a request to join is confirmed with a code sent by WhatsApp, and carries the person's driving licence (ADR-055). Idempotent.
-- A request starts "unconfirmed" and is invisible to the administrator. A 6-digit code is sent to the person's own phone from the Fleet OTG WhatsApp number; they type it on the page
-- they are on, and only then does the request become "pending". The licence number is held only until the administrator decides, and is never written whole to the audit log.

alter table public.join_requests add column if not exists phone_confirmed_at timestamptz;
-- the reference the person's browser holds (only its hash is kept here) and how long the request may wait to be confirmed
alter table public.join_requests add column if not exists confirm_token_hash text;
alter table public.join_requests add column if not exists confirm_expires_at timestamptz;
-- the code: only a hash, how long it lives, how many wrong tries, how many sends
alter table public.join_requests add column if not exists otp_hash text;
alter table public.join_requests add column if not exists otp_expires_at timestamptz;
alter table public.join_requests add column if not exists otp_attempts int not null default 0;
alter table public.join_requests add column if not exists otp_sends int not null default 0;
alter table public.join_requests add column if not exists otp_sent_at timestamptz;
alter table public.join_requests add column if not exists licence_type text check (licence_type is null or licence_type in ('full', 'learner'));
alter table public.join_requests add column if not exists licence_no text check (licence_no is null or length(licence_no) <= 40);
alter table public.join_requests add column if not exists licence_expires_on date;

alter table public.join_requests drop constraint if exists join_requests_status_check;
alter table public.join_requests add constraint join_requests_status_check check (status in ('unconfirmed', 'pending', 'approved', 'declined'));

-- one open request per person per company, whether or not it has been confirmed yet
drop index if exists public.join_requests_pending_uq;
create unique index if not exists join_requests_open_uq on public.join_requests (tenant_id, lower(email)) where status in ('unconfirmed', 'pending');
create index if not exists join_requests_confirm_idx on public.join_requests (confirm_token_hash) where confirm_token_hash is not null;

-- The audit copies whole rows and is append-only, so what must not be kept whole is removed or masked here: the hashes of the browser reference and of the code are dropped (a six-digit
-- code's hash could be worked backwards), a licence number keeps its last four characters.
create or replace function public.platform_audit_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare o jsonb; n jsonb; actor uuid;
begin
  o := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'token_hash' - 'confirm_token_hash' - 'otp_hash' end;
  n := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'token_hash' - 'confirm_token_hash' - 'otp_hash' end;
  if o is not null and o ->> 'licence_no' is not null then o := o || jsonb_build_object('licence_no', '…' || right(o ->> 'licence_no', 4)); end if;
  if n is not null and n ->> 'licence_no' is not null then n := n || jsonb_build_object('licence_no', '…' || right(n ->> 'licence_no', 4)); end if;
  begin actor := nullif(current_setting('app.user_id', true), '')::uuid;
  exception when others then actor := null; end;
  insert into public.platform_audit_log(table_name, action, tenant_id, row_id, actor_id, old_data, new_data)
  values (tg_table_name, tg_op, coalesce((n->>'tenant_id')::uuid, (o->>'tenant_id')::uuid),
          coalesce(n->>'id', o->>'id', n->>'user_id', o->>'user_id'), actor, o, n);
  return null;
end $$;
revoke all on function public.platform_audit_trigger() from public;
