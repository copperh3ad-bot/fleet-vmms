-- Platform migration 0009: requests to join a company, from its staff or from a workshop (ADR-016). Idempotent.
-- A request is only a request. An administrator approves it, and approval creates an ordinary invitation, so every limit and
-- check that applies to an invitation applies here too.
create table if not exists public.join_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  kind          text not null check (kind in ('staff', 'workshop')),
  full_name     text not null check (length(trim(full_name)) between 2 and 120),
  email         text not null check (length(email) between 5 and 200),
  phone         text check (phone is null or length(phone) <= 30),
  workshop_name text check (workshop_name is null or length(trim(workshop_name)) between 2 and 120),
  note          text check (note is null or length(note) <= 500),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by    uuid,
  decided_at    timestamptz,
  decline_reason text check (decline_reason is null or length(decline_reason) <= 300),
  invitation_id uuid,
  vendor_id     uuid,
  created_at    timestamptz not null default now(),
  check (kind <> 'workshop' or workshop_name is not null)
);
create unique index if not exists join_requests_pending_uq on public.join_requests (tenant_id, lower(email)) where status = 'pending';
create index if not exists join_requests_tenant_idx on public.join_requests (tenant_id, status, created_at);

alter table public.join_requests enable row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table public.join_requests from %I', r); end if;
  end loop;
end $$;

drop trigger if exists join_requests_audit on public.join_requests;
create trigger join_requests_audit after insert or update or delete on public.join_requests
  for each row execute function public.platform_audit_trigger();
