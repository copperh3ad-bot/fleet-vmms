-- Control-plane migration 0023 (ADR-078): Pro includes outsourced trips, quoted and awarded among third-party logistics providers. Idempotent.
-- A feature flag only; no price (CLAUDE.md rule 7). Basic keeps the module off.
update public.plans set features = features || '{"outsourced_trips": true}'::jsonb where key = 'pro';
