# ADR-049: The app sends the invitation itself, from its own WhatsApp number

Status: accepted, 2026-11-07. Owner request. Extends ADR-026 (the link goes to a phone number and nowhere else) and ADR-041 (WhatsApp Business account).

## Why
ADR-026 kept the invitation link off the screen, but the administrator still pressed "Send on WhatsApp", which opens a `wa.me` link **with the link inside it**, from the administrator's own phone. So the administrator, or a fleet manager, held the link and could open it first, and whoever opens it first owns the account. The owner's rule: **nobody in the company is handed a sign-up link**, so no unverified person can be signed up in someone else's name. Only the person at the invited phone number receives it.

## Decision
1. When `WHATSAPP_INVITE_TEMPLATE` is set (with the business number and token that already exist), creating or re-sending an invitation **sends the message from the Fleet OTG business number** to the number on the invitation, using an approved template. The server does the sending; the page is never given the link (`InviteResult.url` is empty).
2. The template is `fleetotg_invite` (Utility, English): body "Hello {{1}}, {{2}} has invited you to join their fleet on Fleet OTG. Tap the button below to create your account. The link works once and is valid for 7 days. Please do not forward it." and one URL button "Open invitation" to `https://www.fleetotg.com/invite/{{1}}`. The only variable in the button is the token, so the message cannot point anywhere but our own invitation page. Name and company are cleaned of line breaks and capped at 60 characters.
3. The screen says it was sent, to which number, and shows no link and **no `wa.me` or text-message buttons** (those would hand the link back). If the send fails, it says so and points to "Send a new link" in the list, which cancels the old link and sends a fresh one. A failed send never leaves a link in anyone's hands.
4. The one-time code (ADR-041/046/047) still goes by its own channel, unchanged. The invitation link and the code now both come from the app, never from a person.
5. Not changed: password-reset links keep the old buttons. They also need the person's recovery code, which the administrator never has, so the link alone is no use to them. With `WHATSAPP_INVITE_TEMPLATE` unset nothing changes at all.
6. If the invitation also has an email address, the email with the link still goes to that address (the person's own inbox), as before.

## Owner steps
Meta must approve `fleetotg_invite` (submitted 2026-11-07, template id 3658937344263786; Meta may recategorise it as Marketing), the WhatsApp account needs a payment method, and `WHATSAPP_INVITE_TEMPLATE=fleetotg_invite` must be set in Netlify. Test with one real invitation.

## Tests
`tests/whatsapp-invite.test.ts`: the template payload, token only in the button, cleaning, failure, file mode. The browser suite keeps testing the unset (old) path.
