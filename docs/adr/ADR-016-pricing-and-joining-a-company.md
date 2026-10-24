# ADR-016: Pricing page, and joining a company with its code

Status: accepted, 2026-10-24. Owner request: sign-up pages for the plan and bank-transfer step, for employees and drivers, and for workshops.

## Decision
1. **Pricing page (`/pricing`, public).** Shows the plan from the `plans` table (rule 7: the price is never in code), what is included, and how paying by bank transfer works. It does not show bank details; those stay behind sign-in on the Billing page, with the company's own payment reference.
2. **Company code.** A company's administrator switches on a code (10 characters, no 0/O/1/I, about 50 bits). It lives in the registry (`tenants.join_code`, control migration 0005). It can be switched off or replaced at any time; the old code stops at once.
3. **Joining (`/join` for staff, `/join/workshop` for workshops, public).** A person gives the code, their details, and chooses a password. This writes one request into the company's own `public.join_requests` (platform migration 0009) and asks Supabase to create the login and send the confirmation email. It gives no access to anything.
4. **Approval is an invitation.** An administrator (`admin.users`) approves a request on the Users page. For staff this creates an ordinary invitation with the role they choose; for a workshop it also creates the workshop record and an invitation with the Vendor role. The person signs in, sees the invitation, and accepts it, which requires their confirmed email to match. So plan limits, role checks, duplicate checks and "confirmed email must match" apply exactly as for any invitation. Declining records the decision and lets the person ask again later.
5. **What the public endpoints can do.** Only: check the code, write one waiting request (updating it if the same email asks again), and create a login. Guards: every try counts against a per-address and per-email hourly limit (so a code cannot be guessed by trying many); at most 50 requests wait per company; a company that is locked for non-payment, suspended or still being set up does not accept requests; a wrong code says so plainly (the code space is large and tries are limited), nothing else about any company is revealed.
6. **Isolation.** A request holds the company's id and is only read or changed with that id in the query (`tests/tenant-filters.test.ts` now includes `join_requests`). `tests/join.test.ts` shows the other company's administrator cannot list, approve or decline a request, and that a request made with one company's code never lands in another.

## Corrections made at the same time
Public pages said each company has "its own private database". On the shared database each company has its own schema, kept apart by the application and checked by tests (ADR-014 amendment). The wording now says the company's data is kept apart from every other company's.

## Consequences
- A person who asks to join has to be known to the administrator: the administrator sees name, email, phone and a note, and decides. There is no automatic approval.
- No email is sent when a request is approved (there is no mail service yet beyond Supabase's confirmation mail). The person sees "waiting for approval" on their first page after signing in, and the invitation appears there once approved.
- The administrator must be told a request exists by looking at the Users page. A badge or notification is a possible later addition.
