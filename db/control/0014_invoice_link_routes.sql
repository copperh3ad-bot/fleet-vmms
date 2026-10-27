-- Control-plane migration 0014: the workshop invoice link and the workshop's email reply address (ADR-033) find their organization the same way the estimate link does. Idempotent.
alter table public.link_routes drop constraint if exists link_routes_kind_check;
alter table public.link_routes add constraint link_routes_kind_check check (kind in ('invite', 'odometer', 'quotation', 'invoice', 'reply'));
