-- The workshop link (ADR-030) now carries either an estimate or an invoice (ADR-033). Same table, same single-use rules; `kind` says which. Idempotent.
alter table public.quotation_links add column if not exists kind text not null default 'quotation';
alter table public.quotation_links drop constraint if exists quotation_links_kind_check;
alter table public.quotation_links add constraint quotation_links_kind_check check (kind in ('quotation', 'invoice'));
