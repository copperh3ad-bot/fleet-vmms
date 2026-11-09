-- Tenant migration 0048 (ADR-079 phase A): the open conversation of the WhatsApp menu, one at a time per employee. Idempotent.
-- A row holds where a person is in a questionnaire and what they have answered so far. Nothing here creates a job card, a trip or a reading: that happens only
-- when the person replies YES, through the same functions the app uses. Rows are deleted a day after they close.
create table if not exists whatsapp_sessions (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references employees(id) on delete cascade,
  flow            text not null,                                   -- 'menu', or the questionnaire being answered
  step            text not null,                                   -- the question being asked, or 'confirm'
  answers         jsonb not null default '{}'::jsonb,
  status          text not null default 'open' check (status in ('open','submitting','done','cancelled','lapsed')),
  result          text,                                            -- what was made, e.g. 'Trip TR-000123'
  last_message_id text,                                            -- the last WhatsApp message handled, so a repeated delivery is ignored
  expires_at      timestamptz not null default (now() + interval '30 minutes'),
  created_at      timestamptz not null default now(),
  closed_at       timestamptz
);
create unique index if not exists whatsapp_sessions_one_open on whatsapp_sessions(employee_id) where status in ('open','submitting');
create index if not exists whatsapp_sessions_closed_idx on whatsapp_sessions(closed_at) where closed_at is not null;
