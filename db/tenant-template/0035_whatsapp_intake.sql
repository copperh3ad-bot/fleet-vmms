-- Tenant migration 0035 (ADR-061): job cards raised by WhatsApp. Idempotent.

-- Where a job card came from, shown on the card and in its history.
alter table job_cards add column if not exists source text not null default 'app';
alter table job_cards drop constraint if exists job_cards_source_check;
alter table job_cards add constraint job_cards_source_check check (source in ('app', 'whatsapp'));

-- One row per conversation that is drafting a job card. The draft is what the AI returned after the server's checks; nothing becomes a
-- job card until the sender replies YES. Closed rows are deleted after 7 days. It also records the cost and outcome of each AI read.
create table if not exists whatsapp_intake (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id),
  status        text not null default 'waiting' check (status in ('waiting', 'confirmed', 'cancelled', 'lapsed')),
  draft         jsonb not null,                       -- vehicle_id, registration_no, reason_code_id, category, cause_text, priority
  media         jsonb not null default '[]'::jsonb,   -- [{path, name, mime}]: photos already stored for this conversation
  rounds        int not null default 1 check (rounds between 1 and 4),
  job_card_id   uuid references job_cards(id) on delete set null,
  model         text,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  expires_at    timestamptz not null default now() + interval '30 minutes',
  created_at    timestamptz not null default now(),
  closed_at     timestamptz
);
create index if not exists whatsapp_intake_open_idx on whatsapp_intake(employee_id) where status = 'waiting';
-- One open conversation per person: a new message while one is waiting is a correction of it, not a second draft.
create unique index if not exists whatsapp_intake_one_open_uq on whatsapp_intake(employee_id) where status = 'waiting';

drop trigger if exists whatsapp_intake_audit on whatsapp_intake;
create trigger whatsapp_intake_audit after insert or update or delete on whatsapp_intake
  for each row execute function audit_trigger();
