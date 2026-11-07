-- Platform migration 0016 (ADR-061): job cards raised by WhatsApp are switched on per organization by its administrator. Idempotent.
-- Off until the administrator says so, which records who and when: the messages and photos go to the AI provider, so that is the
-- organization's decision. The Pro plan is also needed (checked in code, as for the AI document reader).
alter table public.tenants add column if not exists wa_jobcards_enabled boolean not null default false;
alter table public.tenants add column if not exists wa_jobcards_by uuid;
alter table public.tenants add column if not exists wa_jobcards_at timestamptz;
