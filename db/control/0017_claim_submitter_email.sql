-- Control-plane migration 0017: remember where to send the answer to a payment claim (ADR-051). Idempotent.
-- The address is the signed-in person's own, taken from their session when they press "I have paid". It is used for one email, the answer to that claim.
alter table public.payment_claims add column if not exists submitter_email text;
