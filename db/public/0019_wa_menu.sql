-- Platform migration 0019 (ADR-079): the WhatsApp menu and its questionnaires are switched on per organization by its administrator. Idempotent.
-- Off until the administrator says so, which records who and when. The Pro plan is also needed (checked in code).
alter table public.tenants add column if not exists wa_menu_enabled boolean not null default false;
alter table public.tenants add column if not exists wa_menu_by uuid;
alter table public.tenants add column if not exists wa_menu_at timestamptz;
