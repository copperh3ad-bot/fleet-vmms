-- Control-plane migration 0024 (ADR-078 phase B): the logistics provider's trip quote link finds its organization the same way the workshop estimate link does. Idempotent.
alter table public.link_routes drop constraint if exists link_routes_kind_check;
alter table public.link_routes add constraint link_routes_kind_check check (kind in ('invite', 'odometer', 'quotation', 'invoice', 'reply', 'odoreply', 'joinconfirm', 'trip_quote'));
