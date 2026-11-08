-- Control-plane migration 0022: makes and models that fleet owners typed because the list did not have them, and the operator's decision on each (ADR-071). Idempotent.
--
-- A vehicle is never refused for not being on the list: the owner types the name and the vehicle is saved at once. The name is also recorded here, once however many
-- vehicles and companies use it. The operator approves it (it then joins everyone's drop-down), merges it into a name that already exists (a spelling variant), or rejects
-- it (a mistake or nonsense). Until it is decided, the company that typed it sees it in its own drop-down and nobody else does.
--
-- A row has a make and, for a model, the make it belongs to. `make_key` and `model_key` are the names with case, spaces and punctuation taken out, so
-- "Land Cruiser", "land-cruiser" and "LANDCRUISER" are one name. The row for a make alone has an empty model_key.

create table if not exists public.vehicle_name_suggestions (
  id              uuid primary key default gen_random_uuid(),
  make            text not null check (char_length(make) between 1 and 60),
  model           text check (model is null or char_length(model) between 1 and 60),
  make_key        text not null check (make_key <> ''),
  model_key       text not null default '',
  status          text not null default 'pending' check (status in ('pending', 'approved', 'merged', 'rejected')),
  /** when merged: the name this one was folded into (a make, and for a model its model) */
  merged_make     text,
  merged_model    text,
  uses            integer not null default 1 check (uses >= 1),
  first_tenant_id uuid,
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text check (decision_note is null or char_length(decision_note) <= 300),
  unique (make_key, model_key),
  check ((model is null) = (model_key = '')),
  check (status <> 'merged' or merged_make is not null)
);
create index if not exists vehicle_name_suggestions_status_idx on public.vehicle_name_suggestions(status, uses desc, first_seen);

-- Which companies used a name, so "used by 4 companies" is a count of companies and not of vehicles, and so one company cannot flood the queue.
create table if not exists public.vehicle_name_uses (
  suggestion_id uuid not null references public.vehicle_name_suggestions(id) on delete cascade,
  tenant_id     uuid not null,
  first_used    timestamptz not null default now(),
  primary key (suggestion_id, tenant_id)
);
create index if not exists vehicle_name_uses_tenant_idx on public.vehicle_name_uses(tenant_id, first_used desc);

do $$
declare t text; r text;
begin
  foreach t in array array['vehicle_name_suggestions', 'vehicle_name_uses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('revoke all on table public.%I from %I', t, r); end if;
    end loop;
  end loop;
end $$;

-- Every decision is on the platform audit trail.
drop trigger if exists vehicle_name_suggestions_audit on public.vehicle_name_suggestions;
create trigger vehicle_name_suggestions_audit after insert or delete or update of status, make, model, merged_make, merged_model, decision_note on public.vehicle_name_suggestions
  for each row execute function public.platform_audit_trigger();       -- not on `uses`: that changes with every vehicle added
