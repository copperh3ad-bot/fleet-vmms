-- Whether an organization lets the AI read the estimates and invoices its workshops send (ADR-034). Off until the organization's administrator switches it
-- on, which records who and when: the documents are sent to the AI provider, so that is the organization's decision, not ours. Idempotent.
alter table public.tenants add column if not exists ai_documents_enabled boolean not null default false;
alter table public.tenants add column if not exists ai_consent_by uuid;
alter table public.tenants add column if not exists ai_consent_at timestamptz;
