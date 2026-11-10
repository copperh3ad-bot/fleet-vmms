-- Control-plane migration 0027 (ADR-085): trip scheduling and cargo requests are part of Pro. Basic is maintenance management; Pro is the whole fleet. A feature flag only; no price (CLAUDE.md rule 7). Idempotent.
update public.plans set features = features || '{"fleet_ops": false}'::jsonb where key = 'standard';
update public.plans set features = features || '{"fleet_ops": true}'::jsonb where key = 'pro';
