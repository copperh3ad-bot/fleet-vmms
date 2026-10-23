# ADR-014: Self-serve SaaS, a dedicated database per organization, $149 a month

Status: accepted (owner decisions, 2026-10-23): organizations sign up themselves; each gets its own dedicated database (Neon); $149 per month per organization; 3-day trial; payment by direct bank transfer for now, card providers later. Replaces ADR-012's "invite only" for creating organizations (inviting people inside an organization is unchanged) and ends "pricing is undecided" in CLAUDE.md rule 7.

## Shape

- **Control plane** is the current Supabase Postgres (`DATABASE_URL`). It holds only what must exist before an organization's database can be found or paid for: the organization registry, which organizations a login belongs to, where each link or invitation token belongs, sign-ups in progress, billing (trial, subscription, payment claims, invoices), platform settings and operators. Shared tables live in `db/public` (every database), control-only tables in `db/control` (control database only).
- **Each organization has a dedicated Postgres database** (a Neon project, created by API at sign-up). Inside it runs the same layout as today: the platform tables from `db/public` (a one-organization copy: its `tenants` row, memberships, invitations, odometer links, plan) plus its `tenant_<id>` schema. This keeps every existing query, trigger and join working unchanged: the organization's database is a complete, self-contained copy of the system for one customer.
- **Source of truth** for who may do what is the organization's own database. The control plane keeps only an index (`user_orgs`: login -> organization) so a login can find its organizations, and a token index (`link_routes`) so an open page (`/o/<token>`, `/invite/<token>`) can find the right database from a token. The index can be rebuilt; losing a row denies access, never grants it.
- **Existing organizations stay where they are.** `tenants.db_kind` is `shared` (today's schema-in-the-control-database, for `beta` and `demo-fleet`) or `dedicated`. Both are served by one routing driver, so nothing has to be moved.
- **Auth and files stay on the one Supabase project:** one login can belong to several organizations, and file paths still start with the organization's schema name (the database refuses anything else). Moving files to per-organization storage is not part of this change.

## How requests find a database

- `getDriver()` returns a routing driver. `withTenant` and `withLinkContext` tell it which schema they need; it looks the organization up in the control plane (cached 60 s), and uses a small pool for that organization's database (at most 3 connections, idle ones closed, a bounded number of pools kept). `withPlatform` always means the control database. Nothing outside `src/lib/db` opens a connection (rule 1 stands).
- Connection strings are secrets. They are stored encrypted (AES-256-GCM, key in the environment as `ORG_DB_KEY`), never logged, never in the repository, never shown on a screen. If the key is lost they can be fetched again from Neon's API.

## Provisioning

- Sign-up creates a login (Supabase email confirmation required) and a pending sign-up row. **No database is created until the email is confirmed and the person is signed in**, so a stranger typing addresses cannot make databases. One trial per confirmed email.
- Provisioning is a resumable state machine (create database, platform migrations, tenant migrations, owner records, billing row), advanced a step at a time by a progress page, so no single request runs long. Every step can be repeated safely. A failed provisioning is retried or cleaned up (the Neon project is destroyed only when it never became active).
- Provider behind an interface: `neon` for real use, `local` (a database on a local Postgres) for development and tests.

## Billing

- **Price:** USD 149 per month per organization, one plan, held in a `plans` row (`price_cents`), never in code. No per-seat or per-vehicle price. Plan limits (vehicles, users) stay available but the standard plan has none.
- **Trial:** 3 days from the moment the organization is ready, no card, full access. Then the organization is **locked**: it can sign in, see the billing page and export its data, and nothing else (writes and open links stop). Locked is a state computed from dates, not a job that has to run.
- **Direct bank transfer (now):** the billing page shows the operator's bank details (editable by the operator, stored in platform settings, not in the repository) and a payment reference. The organization submits a payment claim (amount, date, bank reference, proof file). An operator checks the bank and confirms or rejects it on the operator screen. Confirming records an invoice and extends the subscription by one month from the later of now and the current end. A late payment has a 5-day grace period before the lock.
- **Providers later:** payment goes through a `BillingProvider` interface. Bank transfer is the first implementation. A card provider adds its own webhook, which is a new open endpoint and will need its own ADR (signature check, replay protection).
- **Currency:** the price is in USD. Bank transfers in PKR need a rate: an operator-set `pkr_per_usd` setting shows the PKR amount on invoices and the billing page. Until it is set only USD is shown. (Open question for the owner: who sets the rate, how often.)
- **Deleting data:** a locked organization's database is kept for 30 days. Deleting a database is never automatic; an operator does it from the operator screen with a typed confirmation, and the action is logged.

## Operator screen

- `/admin` for logins in `platform_admins` only: organizations (state, trial end, billing, database kind), payment claims queue, settings (bank details, PKR rate, price), actions (extend a trial, suspend or reinstate, mark a payment by hand, delete a database). Every action is written to the platform audit log. The operator never sees an organization's business data and never sees a connection string.

## Rules changed in CLAUDE.md

- **Rule 5:** adds the public sign-up page. It is public, rate limited (shared across servers), writes only a pending sign-up row and asks Supabase to create the login; it reveals nothing about existing accounts.
- **Rule 7:** pricing is decided: USD 149 per month per organization, stored in `plans`.
- **New rule 9:** an organization's data and its memberships live in its own database; the control plane holds only the index, billing and the registry.

## Not built (yet)

Card payments, automatic invoices by email (no sending channel), per-organization file storage, moving shared organizations to dedicated databases (a script can do it later), tax handling (bank-transfer invoices carry the price as set; tax treatment is for the owner and an accountant), a public marketing site beyond sign-up, terms and privacy pages beyond placeholders the owner must replace.
