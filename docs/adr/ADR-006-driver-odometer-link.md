# ADR-006: Drivers send odometer readings through a signed link (exception to "no unauthenticated endpoints")

Status: accepted (decision by the owner, 2026-10-22). Not built yet.

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
