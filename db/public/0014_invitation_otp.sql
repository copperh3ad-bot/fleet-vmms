-- A one-time code texted to the invited person's phone, to be typed before the invitation link makes an account (ADR-041). Only a hash of the code is kept, with
-- when it runs out, how many wrong tries it has had, and how many were sent, so a stolen link is not enough on its own. Idempotent.
alter table public.invitations add column if not exists otp_hash text;
alter table public.invitations add column if not exists otp_expires_at timestamptz;
alter table public.invitations add column if not exists otp_attempts int not null default 0;
alter table public.invitations add column if not exists otp_sends int not null default 0;
alter table public.invitations add column if not exists otp_sent_at timestamptz;
