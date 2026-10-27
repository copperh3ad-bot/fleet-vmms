-- Tenant migration 0025: what the AI did, and what became of it (ADR-034). Idempotent.
-- Every time a person asks the AI to read a workshop's document, one row records who asked, which model, what it returned (a DRAFT), what it cost, and
-- what the person did with it: saved it as it was, corrected it first, or never used it. The AI never saves anything itself. The share of drafts saved
-- unchanged is how the owner knows whether the cheap model is good enough.

create table if not exists ai_actions (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('document_read')),
  job_card_id        uuid not null references job_cards(id) on delete cascade,
  email_id           uuid references workshop_emails(id) on delete set null,
  document_kind      text not null check (document_kind in ('quotation', 'invoice')),
  model              text not null,
  status             text not null check (status in ('ok', 'unreadable', 'refused', 'failed')),
  reason             text,
  draft              jsonb,                       -- what the AI returned, after the server's checks; null when it could not read the file
  input_tokens       int not null default 0,
  output_tokens      int not null default 0,
  cache_write_tokens int not null default 0,
  cache_read_tokens  int not null default 0,
  requested_by       uuid not null,
  created_at         timestamptz not null default now(),
  outcome            text not null default 'pending' check (outcome in ('pending', 'saved_unchanged', 'saved_edited', 'discarded')),
  resolved_by        uuid,
  resolved_at        timestamptz
);
create index if not exists ai_actions_job_idx on ai_actions(job_card_id);

drop trigger if exists ai_actions_audit on ai_actions;
create trigger ai_actions_audit after insert or update or delete on ai_actions for each row execute function audit_trigger();
