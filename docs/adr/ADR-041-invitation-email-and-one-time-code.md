# ADR-041: Employees are added with an invitation; the link is emailed too; a texted code confirms it

Status: accepted, 2026-10-28. Amends ADR-025 and ADR-026 (invitations and the phone-only link).

## Decision
1. **An employee is only ever added together with an invitation, with every detail filled in.** The invite form on the Users page (the only way in) asks for the full name, employee number, department, phone number and role, and either an email or, for someone with no email, a sign-in name. `addEmployeeWithInvite` makes the employee record and the invitation in one transaction, so a record with no way to sign in cannot be left behind, and a refused invitation (plan limit, an open invitation) leaves no record. It needs both `admin.users` and `employee.manage`. The Employees page no longer has an add form; it edits what exists. Workshops are unchanged (the Vendors flow).
2. **The invitation link is also emailed** when the invitation has an email (`src/lib/email/invitation.ts`), so "Send invitation" does what it says. The WhatsApp and text buttons stay. The screen says whether the email went; a mail problem never undoes the invitation. "Send a new link" emails the new link too. This replaces ADR-026's "nowhere else".
3. **A one-time code confirms the link** (`src/lib/admin/invite-otp.ts`). When texting is set up and the invitation has a phone number, the invitation page asks for a 6-digit code before it makes the account. "Send me a code" texts it to the number the administrator typed for the employee; the administrator never sees it. Only a hash is stored; it runs out after 10 minutes; five wrong tries end it; a new code at least 60 seconds apart, five per invitation, ten per connection per 10 minutes. A forwarded or stolen link is no use without the employee's phone. Not asked for on a password reset (the recovery code protects that) or when texting is not set up.
4. **Texting is off until the owner sets it up** (`src/lib/sms.ts`, Twilio by plain REST, no library): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (a number, or a messaging service id) in Netlify. No key, no code asked, invitations work as before. Each text costs money.
5. **The page that sends the text is open to anyone with a link** (CLAUDE.md rule 5, ADR-012): it only texts the number already on the invitation, never one a visitor supplies, and the answer says only the last four digits.
6. **Migration:** platform 0014 (`public.invitations` gains the code's hash, expiry, tries and sends).

## Not done
- No WhatsApp sending (Twilio WhatsApp needs an approved sender); text only.
- A person who is invited without an email and without a phone cannot exist (every invitation needs a number, ADR-026).
- The code protects the invitation link; accepting from the home page by a confirmed email is unchanged.
