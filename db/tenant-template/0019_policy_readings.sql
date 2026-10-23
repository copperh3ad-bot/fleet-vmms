-- Tenant migration 0019: reading an uploaded policy. One reading per policy: the text found page by page, then what the
-- reader understood (findings). Nothing here changes a rule; a person applies findings from the review screen. Idempotent.
create table if not exists policy_readings (
  id          uuid primary key default gen_random_uuid(),
  policy_id   uuid not null unique references maintenance_policies(id) on delete cascade,
  status      text not null default 'reading' check (status in ('reading','ready','failed')),
  file_kind   text check (file_kind in ('pdf-text','pdf-scan','image')),
  pages_total int not null default 0 check (pages_total >= 0),
  pages_done  int not null default 0 check (pages_done >= 0),
  page_text   jsonb not null default '[]'::jsonb,
  confidence  int,
  findings    jsonb not null default '[]'::jsonb,
  applied     jsonb not null default '[]'::jsonb,
  error       text,
  started_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Not audited on purpose: it is a draft (text found in a file, copied page by page). The rules a person applies from it are
-- changes to settings and service types, and those are audited.
