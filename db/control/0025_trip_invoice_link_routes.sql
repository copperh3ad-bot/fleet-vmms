-- Control-plane migration 0025 (ADR-078 phase B2): the provider's trip invoice link finds its organization like the other links. Idempotent.
alter table public.link_routes drop constraint if exists link_routes_kind_check;
alter table public.link_routes add constraint link_routes_kind_check check (kind in ('invite', 'odometer', 'quotation', 'invoice', 'reply', 'odoreply', 'joinconfirm', 'trip_quote', 'trip_invoice'));
