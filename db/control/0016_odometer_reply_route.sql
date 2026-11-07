-- Control-plane migration 0016: a driver's WhatsApp reply to the monthly odometer request finds its organization the way a workshop's reply does (ADR-050). Idempotent.
alter table public.link_routes drop constraint if exists link_routes_kind_check;
alter table public.link_routes add constraint link_routes_kind_check check (kind in ('invite', 'odometer', 'quotation', 'invoice', 'reply', 'odoreply'));
