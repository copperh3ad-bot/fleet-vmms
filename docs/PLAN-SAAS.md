# SaaS build plan (ADR-014)

Each phase ends with passing tests (PGlite and local Postgres), a STATE.md entry, and a commit.

## Phase 10a: dedicated databases
- Routing driver, encrypted connection strings, per-organization pools.
- Provisioner interface (`neon`, `local`) and the provisioning state machine.
- Control migrations (`db/control`): registry columns, `user_orgs`, `link_routes`.
- Existing code that read platform tables across organizations now goes through the control plane or the organization's own database: sign-in lookup, workspace list, invitations, odometer links, reminders.
- Migration and drift scripts that visit every database.

## Phase 10b: sign-up, trial, onboarding
- `/signup`, check-your-email page, setup/progress page, welcome checklist, terms and privacy placeholders.
- One trial per confirmed email, rate limits, pending sign-up expiry.

## Phase 10c: billing
- Subscription state from dates (trial, active, grace, locked), the lock in one place, data export while locked.
- Billing page with bank details, payment reference, payment claim with proof, invoices.
- Daily job: trial and renewal reminders.

## Phase 10d: operator screen and launch readiness
- `/admin`: organizations, payment claims, settings, actions, audit.
- Runbook, load and failure tests, cost and quota notes, deployment to Netlify with the new settings.

## What the owner must supply
- A Neon account and an API key (`NEON_API_KEY`), and the Neon region to use (`NEON_REGION`, default `aws-ap-southeast-1`).
- Bank account details to show customers, the PKR per USD rate policy, and who confirms payments.
- Terms of service and privacy policy text (placeholders are provided and must be replaced before launch).
- A custom domain and a decision on Supabase captcha (Turnstile or hCaptcha) for the sign-up form.
- The Supabase plan upgrade and Neon plan sized for the number of organizations (every trial is a project).
