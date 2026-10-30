-- Tenant migration 0026: the AI can also read a maintenance policy (ADR-043). Idempotent.
-- An AI action is now anchored either to a job card (reading a workshop's estimate or invoice, ADR-034) or to a policy (reading the company's own policy).
-- Its answer is still only a DRAFT: for a policy it is stored as the policy's reading, and a person chooses what to apply.

alter table ai_actions alter column job_card_id drop not null;
alter table ai_actions alter column document_kind drop not null;
alter table ai_actions add column if not exists policy_id uuid references maintenance_policies(id) on delete cascade;

alter table ai_actions drop constraint if exists ai_actions_kind_check;
alter table ai_actions add constraint ai_actions_kind_check check (kind in ('document_read', 'policy_read'));
alter table ai_actions drop constraint if exists ai_actions_document_kind_check;
alter table ai_actions add constraint ai_actions_document_kind_check check (document_kind is null or document_kind in ('quotation', 'invoice'));
alter table ai_actions drop constraint if exists ai_actions_anchor_check;
alter table ai_actions add constraint ai_actions_anchor_check check (
  (kind = 'document_read' and job_card_id is not null and document_kind is not null)
  or (kind = 'policy_read' and policy_id is not null));
create index if not exists ai_actions_policy_idx on ai_actions(policy_id);

alter table policy_readings add column if not exists source text not null default 'patterns';
alter table policy_readings drop constraint if exists policy_readings_source_check;
alter table policy_readings add constraint policy_readings_source_check check (source in ('patterns', 'ai'));
alter table policy_readings add column if not exists ai_action_id uuid references ai_actions(id) on delete set null;
