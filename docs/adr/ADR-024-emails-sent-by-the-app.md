# ADR-024: Emails sent by the app, not by Supabase

Status: accepted, 2026-10-24. Owner request: sign-up emails must be sent from inside the app instead of by Supabase.

## Decision
1. **Supabase's Send Email hook.** Supabase still creates the account and the secure one-time code, but instead of sending the email itself it calls `POST /api/auth/send-email`, and the app sends the email from the company's own address. The hook is available on every Supabase plan. It covers every email Supabase would have sent: sign-up confirmation (including "send again" and joining with a company code), password reset, and the rarer kinds (sign-in link, invitation, email change). Invitations made inside the app are separate and unchanged.
2. **Why the hook and not a service key.** The alternative is to make the links ourselves with the admin API. That needs Supabase's all-powerful `service_role` key on the server and changes every sign-up flow. The hook needs no new key and no change to the flows: the links Supabase puts in the email are the same ones it always did (`/auth/v1/verify?token=...&type=...&redirect_to=...`), so the confirmation page, the reset page and the code exchange are untouched.
3. **The endpoint is public, so it proves who is calling.** It is named in `PUBLIC_PATHS`, but it does nothing without a valid signature: Standard Webhooks (HMAC-SHA256 over id, timestamp and body, constant-time comparison), a secret only Supabase and the app share (`AUTH_HOOK_SECRET`), and a timestamp within 5 minutes. It refuses bodies over 100 KB before reading them, validates the payload strictly (address shape, code characters, action name), escapes everything it puts in HTML, and never logs an address, a code or a link.
4. **Any mail service.** The app sends through SMTP, so any service works (Resend, Amazon SES, Brevo, Postmark, a hosting mailbox). It needs `SMTP_URL`, `EMAIL_FROM` and `AUTH_HOOK_SECRET`, all set in Netlify and never in the repository. Changing service is changing `SMTP_URL`. The sender address must be verified with the service, and the domain needs the SPF, DKIM and DMARC records the service names.
5. **Failure is visible.** If the app cannot send, it answers with an error, and Supabase tells the person the email could not be sent, rather than the person waiting for a message that was never sent. The existing per-address and per-connection limits on sign-up and reset requests still apply before Supabase is asked.
6. **Rollout order matters.** Set `SMTP_URL`, `EMAIL_FROM` and `AUTH_HOOK_SECRET` and deploy first, send a test, and only then turn the hook on in Supabase. Turning the hook on first would make every sign-up fail until the settings exist. Turning the hook off returns to Supabase's built-in sender at once.

## Not done
- Our own wording is used for the emails in English only; Supabase's templates in the dashboard no longer apply once the hook is on.
- No delivery tracking, bounce handling or unsubscribe: these are one-time account emails. A service's own dashboard shows delivery.
- No email queue or retry. A failed send is reported to the person, who can ask again.
