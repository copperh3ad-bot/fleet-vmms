-- Control-plane migration 0018: the link that confirms a request to join finds its organization the way other one-time links do (ADR-055). Idempotent.
alter table public.link_routes drop constraint if exists link_routes_kind_check;
alter table public.link_routes add constraint link_routes_kind_check check (kind in ('invite', 'odometer', 'quotation', 'invoice', 'reply', 'odoreply', 'joinconfirm'));
