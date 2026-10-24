-- Public migration 0010: invitations for people with no email (ADR-025). Idempotent.
-- An invitation may now carry a sign-in name (username) instead of an email, and a "reset" invitation (reset_user_id) lets an existing
-- person with a sign-in name choose a new password from a link, because there is no email to send a reset to.
alter table public.invitations add column if not exists username text;
alter table public.invitations add column if not exists reset_user_id uuid;
-- The employee the invitation is for, by the company's employee code. The person's login is linked to that employee (and so to the vehicle
-- they hold) when they accept. The application requires it for every role except a workshop, which is linked to its workshop record instead.
alter table public.invitations add column if not exists employee_no text;

do $$ begin
  alter table public.invitations drop constraint if exists invitations_check;
  alter table public.invitations drop constraint if exists invitations_has_contact;
  alter table public.invitations add constraint invitations_has_contact check (email is not null or phone is not null or username is not null);
  alter table public.invitations drop constraint if exists invitations_username_shape;
  alter table public.invitations add constraint invitations_username_shape check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,29}$');
end $$;

-- One open invitation per sign-in name, in this database.
create unique index if not exists invitations_live_username_uq
  on public.invitations (lower(username)) where accepted_at is null and revoked_at is null and username is not null and reset_user_id is null;
-- One open invitation per employee code in a company.
create unique index if not exists invitations_live_employee_uq
  on public.invitations (tenant_id, lower(employee_no)) where accepted_at is null and revoked_at is null and employee_no is not null and reset_user_id is null;
-- One open reset link per person.
create unique index if not exists invitations_live_reset_uq
  on public.invitations (reset_user_id) where accepted_at is null and revoked_at is null and reset_user_id is not null;
