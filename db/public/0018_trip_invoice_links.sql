-- ADR-078 phase B2: the single-use link also carries a logistics provider's invoice for an awarded trip (kind 'trip_invoice'). Idempotent.
alter table public.quotation_links add column if not exists trip_id uuid;                       -- trips.id inside the tenant schema
alter table public.quotation_links drop constraint if exists quotation_links_kind_check;
alter table public.quotation_links add constraint quotation_links_kind_check check (kind in ('quotation', 'invoice', 'trip_quote', 'trip_invoice'));
alter table public.quotation_links drop constraint if exists quotation_links_target_check;
alter table public.quotation_links add constraint quotation_links_target_check
  check ((kind = 'trip_quote' and trip_quote_id is not null) or (kind = 'trip_invoice' and trip_id is not null) or (kind in ('quotation', 'invoice') and job_card_id is not null));
create index if not exists quotation_links_trip_idx on public.quotation_links(tenant_id, trip_id) where trip_id is not null;
