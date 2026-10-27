-- The workshop link (ADR-030) now carries either an estimate or an invoice (ADR-033). Same table, same single-use rules; `kind` says which. Idempotent.
alter table public.quotation_links add column if not exists kind text not null default 'quotation';
alter table public.quotation_links drop constraint if exists quotation_links_kind_check;
alter table public.quotation_links add constraint quotation_links_kind_check check (kind in ('quotation', 'invoice'));

-- The address a workshop may reply to (ADR-033) is made from a random code. Only its SHA-256 is stored, like the link's own token. A reply is accepted
-- until the request expires or is revoked, a few times (a workshop may send the estimate and then a corrected one), and never after that.
alter table public.quotation_links add column if not exists reply_code_hash text;
alter table public.quotation_links add column if not exists replies_used int not null default 0;
create unique index if not exists quotation_links_reply_idx on public.quotation_links(reply_code_hash) where reply_code_hash is not null;
