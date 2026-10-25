-- Control-plane migration 0013: the workshop estimate link (ADR-030) finds its organization the same way the odometer link does. Idempotent.
alter table public.link_routes drop constraint if exists link_routes_kind_check;
alter table public.link_routes add constraint link_routes_kind_check check (kind in ('invite', 'odometer', 'quotation'));
