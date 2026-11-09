-- Control-plane migration 0026 (ADR-079): Pro includes the WhatsApp menu and questionnaires. A feature flag only; no price (CLAUDE.md rule 7). Idempotent.
update public.plans set features = features || '{"whatsapp_menu": true}'::jsonb where key = 'pro';
