# ADR-070: One log of everything the software does

Status: built, not yet live (control migration 0021 and a deploy). Owner request: all software activity is logged, so any error or audit can be investigated from it.

## What already existed

- `audit_log` in each company's schema: every change to the company's data (who, which row, before and after), written by triggers.
- `public.platform_audit_log`: changes to access, invitations, billing and plans.
- `ai_actions`: each AI reading, with tokens and outcome.

None of them says what was *asked* and what came of it: a refused action, a failed sign-in, a webhook that was rejected, a job that did not run, an error that crashed a page.

## Decision

One append-only table, `public.activity_log` (control migration 0021), written from the places every request already passes through, so a new feature is covered without remembering to log it:

| Kind | Written by | What it records |
|---|---|---|
| action | `runAction` (every workspace server action) | the action's name, person, company, role, worked / not accepted / refused / failed, how long |
| billing | the operator `run()`, accounting and activity exports | everything the operator does |
| auth | a wrapper on every public form action (`authEvent`) | sign-in, sign-up, password reset, joining, accepting an invitation, the contact form: the account typed, and how it ended |
| security | `assertCan`, `requireMembership`, `requireOperator` | every permission refusal, a visit to a workspace the person is not in or that is locked, a refused visit to the operator area, and each time the log is viewed or downloaded |
| page | `requireMembership`, `requireOperator` | one line per page view in a workspace or the operator area |
| webhook | `loggedRoute` on the inbound email and WhatsApp routes and the confirmation link | route, status, duration |
| job | `timedJob` in the daily reminders function and script | each step with its counts and duration |
| error | `instrumentation.ts` `onRequestError` | every error the server could not handle: route, class, digest, a scrubbed message |

Every row also carries the request id and path (set by the proxy, so a browser cannot choose them), the caller's address and browser, and a small `details` object.

The Supabase email hook runs as a tiny function that must wake in under a second, so it writes one line to the host's log ("email accepted by the mail server") instead of the database. Supabase's own auth log shows each call.

## Safeguards

- **No secrets, no content.** Free text is scrubbed (tokens, keys, `user:password@` in a URL, long hex), cut short, and any detail whose name looks like a secret (`password`, `token`, `code`, `key`, and so on) is replaced by `[hidden]`. Message bodies, files and passwords are never passed in.
- **Never breaks the work.** The logger never throws. Inside a request the write happens after the response (`after()`), so a page is not slowed.
- **Append-only.** A database trigger refuses any update, and any delete except from `purge_activity_log()`, which keeps at least 30 days. The daily job purges past 400 days (`ACTIVITY_RETENTION_DAYS` can change it).
- **Private.** Row security on, no rights for the Supabase API roles. Only the platform operator reads it, on Admin, Activity, or as a CSV; the check runs in the page and again in the query.
- **Names.** An action's name is read from the call stack where it enters `runAction`. If a build ever hides it, the row says `action` and still carries the path, person, result and request id.
- **Personal data.** Sign-in lines hold the email or sign-in name that was typed, and addresses are kept, because that is how an attack on one account is seen. The privacy page says so, and the retention period bounds it.

## Not covered

- Errors in the browser's own JavaScript (no endpoint to receive them: rule 5).
- Reads of data by the operator through the database console; the database's own log covers that.
- Tamper evidence beyond append-only (a hash chain). Someone with full database rights could still alter the table.

## Order of going live

Apply control migration 0021 first, then deploy; until it is applied the logger's writes fail quietly and the daily purge skips itself.
