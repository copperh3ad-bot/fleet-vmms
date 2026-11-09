-- Tenant migration 0050: the AI can compare the quotes on a trip (ADR-080). Idempotent.
-- Its answer is advice only: a ranking with reasons, stored as the AI action's draft. Awarding stays a person's decision through trip_transition.

alter table ai_actions add column if not exists trip_id uuid references trips(id) on delete cascade;

alter table ai_actions drop constraint if exists ai_actions_kind_check;
alter table ai_actions add constraint ai_actions_kind_check check (kind in ('document_read', 'policy_read', 'quote_advice'));
alter table ai_actions drop constraint if exists ai_actions_anchor_check;
alter table ai_actions add constraint ai_actions_anchor_check check (
  (kind = 'document_read' and job_card_id is not null and document_kind is not null)
  or (kind = 'policy_read' and policy_id is not null)
  or (kind = 'quote_advice' and trip_id is not null));
create index if not exists ai_actions_trip_idx on ai_actions(trip_id) where trip_id is not null;
