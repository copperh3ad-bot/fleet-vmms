-- Control-plane migration 0012: a recovery code for people who sign in with a name (ADR-025). Idempotent.
-- An administrator makes a reset link for someone who has no email, which would let the administrator choose that person's password.
-- So a reset link only works together with a code that only the person knows. They choose it when they first set up; only a salted
-- hash is kept here, never the code. Wrong tries are limited in the application.
alter table public.login_names add column if not exists recovery_hash text;
