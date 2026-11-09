-- ADR-078 phase B: the single-use link now also carries a logistics provider's quote for a trip (kind 'trip_quote'). Same table, same single-use rules. Idempotent.
-- A trip quote link names a trip_quotes row (which already names the trip and the provider); a job card link still names a job card.
alter table public.quotation_links alter column job_card_id drop not null;
alter table public.quotation_links add column if not exists trip_quote_id uuid;                 -- trip_quotes.id inside the tenant schema
alter table public.quotation_links drop constraint if exists quotation_links_kind_check;
alter table public.quotation_links add constraint quotation_links_kind_check check (kind in ('quotation', 'invoice', 'trip_quote'));
alter table public.quotation_links drop constraint if exists quotation_links_target_check;
alter table public.quotation_links add constraint quotation_links_target_check
  check ((kind = 'trip_quote' and trip_quote_id is not null) or (kind <> 'trip_quote' and job_card_id is not null));
create index if not exists quotation_links_trip_quote_idx on public.quotation_links(tenant_id, trip_quote_id) where trip_quote_id is not null;
