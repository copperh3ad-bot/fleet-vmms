# ADR-046: The invitation code can go by email, and can be switched off

Status: accepted, 2026-11-06. Amends ADR-041 rule 3 and 4 (the one-time code was WhatsApp only). Owner request: an alternative to WhatsApp for the code, because Meta has not approved the `fleetotg_code` template and the business is not verified.

## The problem
Since ADR-041 an invitation page asks for a 6-digit code when WhatsApp sending is set up. With the Netlify WhatsApp variables set but no approved template, every code send fails ("The code could not be sent"), so **no invited person can finish creating an account**. The owner asked for an alternative to WhatsApp.

## What the code is for, and what email can and cannot do
The code stops a stolen, forwarded or overheard link from being enough on its own. Who needs that depends on how the person is invited:

- **Invited with an email.** `acceptInvitation` already refuses anyone whose email is not confirmed (`src/lib/admin/service.ts`, "Confirm your email address first"). The link alone cannot get into the workspace; the mailbox has to be reached too. A code by email therefore adds little here. What it does add: a person who holds the link cannot register the invited address ahead of the real person (pre-registering an address with a password of their own) without also reading that mailbox.
- **Invited with a sign-in name and no email.** The link alone makes the login (`acceptWithUsername`). This is the person the code protects most, and **email cannot reach them**. They need a phone channel: WhatsApp, or SMS.

So email is a real alternative for the first group and not for the second. This ADR does not pretend otherwise.

## Decision
1. **A setting, `INVITE_CODE_CHANNEL`, chooses where the code goes** (Netlify variable, not a secret; `src/lib/admin/invite-channel.ts`):
   - unset or `auto` or `whatsapp`: WhatsApp when it is set up and the invitation has a phone number. **Exactly what ADR-041 did; nothing changes for anyone who does not set it.**
   - `email`: the invitation's email address when it has one and mail sending is set up (`SMTP_URL`, `EMAIL_FROM`); otherwise WhatsApp as above. So a person invited by sign-in name still gets a phone code when WhatsApp works.
   - `off`: no code on any invitation. A code that cannot be delivered must never block every invitation; `off` is the switch for that, and it is honest that it removes the second factor.
2. **One send path for both channels.** `sendInviteCode` picks the channel, then everything else is the same as ADR-041: the code is made on the server, only a hash is stored, it runs out after 10 minutes, five wrong tries end it, a new code at least 60 seconds apart, five per invitation, ten per connection per 10 minutes. The code is stored before it is sent, so a code that went out can always be checked.
3. **The email carries the code and never the link** (`buildInviteCodeMail`). The invitation link is emailed separately by ADR-041 rule 2, so the two do not travel in one message.
4. **The page says where the code went, without giving it away:** "your email j\*\*\*@example.com" or "WhatsApp, to the number ending 4567". The page already shows the invited email in a read-only box, so the mask protects only the hint, not the address.
5. **A password-reset link never asks for a code** (its recovery code protects it), whatever the setting.
6. **No migration.** The code's hash, expiry, tries and sends are the columns ADR-041 added (platform 0014).
7. **Failure is logged without personal data:** the channel and the mail service's own error code, never the address, the number or the code.

## To switch it on (owner)
- To stop invitations being blocked **today**: set `INVITE_CODE_CHANNEL=off`, or `email`, in Netlify and redeploy. `email` needs the mail service already working (it is: invitations and sign-up emails use it).
- When Meta approves the template, set `INVITE_CODE_CHANNEL` back to unset (or `whatsapp`) if you want phone codes for everyone, or leave `email` to keep email for people who have one.

## Not done
- **SMS.** The true replacement for WhatsApp for people with no email. It needs an SMS provider account (a new vendor, cost and Pakistan delivery to be checked) and so the owner's decision. The channel setting is built so SMS is one more branch in `invite-channel.ts` and `invite-otp.ts`.
- **A code given by the administrator in person or by phone.** Rejected for now: ADR-041 says the administrator never sees the code, so that an invitation cannot be completed by the person who made it.
- Browser-suite coverage of the code step (it needs the mail outbox and a code read-back); the unit tests cover both channels.

## Tests
`tests/invite-otp.test.ts`: the email channel (masked hint, code in the mail, no link in the mail, nothing on WhatsApp, the right code passes), every ADR-041 limit again on email, fallback to WhatsApp (mail not set up, or no email on the invitation), default stays WhatsApp for every spelling of unset/auto/whatsapp, `off`, reset links, a mail service that refuses, and the mail text escaped.
