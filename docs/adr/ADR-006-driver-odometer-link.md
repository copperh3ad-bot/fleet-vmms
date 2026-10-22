# ADR-006: Drivers send odometer readings through a signed link (exception to "no unauthenticated endpoints")

Status: accepted (decision by the owner, 2026-10-22). Built in the odometer-link phase; see "As built" at the end.

**Decision.** Drivers who have no login submit their monthly reading through a single-use link sent by the admin. This is the only unauthenticated route besides `/login` and `/api/health`. It is an exception to CLAUDE.md rule 5 and is limited as follows.

**Limits (these are requirements for the build, each with a test):**
- The link carries a random token of at least 32 bytes. Only its hash is stored (platform table, with tenant, submission, expiry, used-at). A lookup by token can never list anything.
- One link = one `odometer_submissions` row = one reading. Single use: used-at is set in the same transaction as the reading. It expires after 48 hours and the admin can revoke it.
- The page shows the plate and one number field, nothing else. No other data of the tenant is readable through it.
- The reading is saved as `submitted` and still has to be approved by an admin, so a leaked link cannot move a vehicle's odometer by itself. Implausible values are flagged by the existing `odometer_validate` trigger.
- The route runs as a dedicated narrow database role context that can call `submit_odometer` and nothing else. It does not use a user's membership.
- Rate limited per IP and per token; the same message for unknown, used and expired links; the token is never logged.
- No photo upload through the link in v1 (no unauthenticated file writes).

**Rejected:** phone-code login (more steps for drivers; needs an SMS provider and cost).

**Revisit** if links are shared in groups and misused: then require a phone code on top.

## As built
- Platform table `public.odometer_links` (migration `db/public/0004`): SHA-256 of the token, tenant, submission, expiry, used-at, revoked-at. Tenant functions `link_submission_info` and `submit_odometer_via_link` (migration `0008`) are all the link route calls. Path `/o/<43-character token>` is the only extra open path (`ODOMETER_LINK_PATH` in `src/lib/auth/routing.ts`, matched exactly and tested). Responses carry `no-store`, `no-referrer` and `noindex`.
- "Used" is set in the same transaction as the reading, so a refused reading (closed cycle, bad value) does not burn the link. Typos are rejected before anything is written.
- Unknown, malformed, used, expired, revoked, closed-cycle and suspended-workspace links all show the same sentence.
- Closing a cycle, entering the reading by hand, or making a new link cancels older live links for that vehicle.
- **Deviation from the limit "dedicated narrow database role":** the link runs through `withLinkContext` (`src/lib/db/tenant.ts`), which sets no user and a role name that holds no permission, and the route code calls only the functions above. It is not a separate Postgres login: the pooled Supabase connection cannot switch role without extra grants. A hand-written query in that code path could still read tenant tables, so this relies on code review of two small files (`src/lib/odometer/link.ts`, `src/app/o/[token]/*`). Revisit in Phase 9 (real role with `execute` on two functions).
- **Rate limiting** is in memory per server process (`src/lib/rate-limit.ts`): 60 page views and 30 sends per address, 10 sends per link, per 10 minutes. It slows guessing, but a token has 256 bits so guessing is not the real risk. It is not shared across servers; Phase 9 moves it to shared storage.
- Admin side: `/w/<slug>/odometer` (start a month, make links, copy or open WhatsApp, enter by hand, approve or reject, close). The raw link is shown once; only the hash is kept.
