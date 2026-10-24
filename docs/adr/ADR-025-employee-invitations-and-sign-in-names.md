# ADR-025: Invitations tied to an employee code, and sign-in names for people with no email

Status: accepted, 2026-10-24. Owner requests: "Invited users don't need to sign up with emails" and "Each invite is linked to an employee code and role in an organisation".

## Decision
1. **Every invitation names a role and an employee code.** The one exception is a workshop, which is linked to its workshop record instead. The code finds the employee record in that company (codes are already unique per company). When the person accepts, their login is linked to that record, so the vehicle the employee holds is theirs: a vehicle user sees exactly the vehicle on their record, with no matching by email. If no record has the code yet, one is made with that code and the name given. A record that already has a login, or is marked as no longer working there, cannot be invited. One open invitation per employee code.
2. **A person can be invited with an email or with a sign-in name.** With an email, nothing changes: they confirm the address and sign in with it. Without one, the administrator gives a short sign-in name (suggested as `<company>.<employee code>`, for example `acme.d-101`). The invitation link carries no email. The person opens it, sees their name, and chooses their own password.
3. **How a login with no email works.** Supabase Auth identifies people by email, so the app makes the login itself (`src/lib/supabase/admin.ts`): a made-up address on `login.fleetotg.com` (a domain with no mailbox), already confirmed, with the password they chose. The link between name and address is `public.login_names` (control migration 0011, global because a name must find one person, row security on, no public API access). The sign-in box takes an email or a name: no `@` means a name, which is looked up to the made-up address. The made-up address itself is refused at sign-in and never shown. Every failure gives the same message, and the existing per-account and per-connection limits apply to names too.
4. **No email means no reset email.** An administrator makes a one-time reset link for the person (valid 2 days, replaces any earlier one, only for people with a sign-in name, never for yourself, needs `admin.users`). The person opens it and chooses a new password. People who sign in with an email keep "Forgot your password?".
5. **The service key.** Making and changing these logins needs Supabase's service key (`SUPABASE_SERVICE_ROLE_KEY`), which can create, change and delete any login. It is read in exactly one file, used by exactly one other, never sent to a browser, never logged, and used for three things only: make a login, change its password on a reset link, remove a login whose set-up failed. A test fails if any other file names it. Without the key set, inviting by sign-in name is refused with a plain message and everything else works as before.
6. **Half-finished set-ups can be retried.** The made login records which invitation made it; opening the same link again finishes the job (sets the password again, completes the membership). A name already held by a login from another invitation is never handed over.
7. **The email hook** (ADR-024) refuses to send to a made-up address, so nothing is ever mailed there.
8. **Join with a company code** (people who ask to join and are approved) still uses an email, because that request is made by the person. The approver now also enters the employee code, since every invitation needs one.

## Accepted risks
- A person with no email has no proof of who they are beyond the link they were handed. The administrator hands it over; the link works once and expires in 7 days.
- An administrator can make a reset link for anyone in their company who signs in with a name, and could use it themselves. That person's actions would then appear under their name. The invitation, with who made it, is kept in the audit trail. This is the usual power of an administrator for accounts with no email and is stated here so it is a decision, not a surprise.
- A forgotten password cannot be fixed by the person alone; they ask their administrator. This is deliberate: there is no channel to prove it is them.

## Not done
- Sign-in by phone number or one-time codes (needs a text-message service).
- Employees with no invitation, or a bulk invite of a whole employee list (one at a time for now).
- Changing a sign-in name once made.
