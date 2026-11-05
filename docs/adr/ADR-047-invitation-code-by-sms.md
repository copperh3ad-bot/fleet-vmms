# ADR-047: The invitation code can go by text message (SMS)

Status: accepted, 2026-11-06 (built, not run against a real provider, not deployed). Extends ADR-046. Owner choice: SMS is the route for people invited without an email, because WhatsApp is blocked on Meta's side and email cannot reach them.

## Decision
1. **SMS is a third channel for the code** beside WhatsApp and email. `src/lib/sms.ts` sends one text through a provider by plain REST, no library, written the same way as `src/lib/whatsapp.ts`: off until set up, a file hook for tests (`SMS_FILE`, refused unless `ALLOW_FILE_MAILER=1`), and nothing sensitive logged (an error says only `sms failed: <status>`).
2. **Two providers are written, chosen by `SMS_PROVIDER`:** `twilio` and `plivo`. Both take `SMS_ACCOUNT_ID` (Twilio's Account SID, Plivo's Auth ID), `SMS_AUTH_TOKEN` (a secret, in Netlify) and `SMS_FROM` (a number, or a registered sender name; with Twilio a Messaging Service id starting `MG` also works). Another provider is one more branch in `sendSms`.
3. **`INVITE_CODE_CHANNEL` is now an order of preference** (`src/lib/admin/invite-channel.ts`); the first channel that is set up for that invitation is used:
   - unset, `auto` or `whatsapp`: WhatsApp, then SMS. Where WhatsApp works nothing changes. Where only SMS is set up, SMS is used with no other setting.
   - `sms`: SMS, then WhatsApp. **Use this while WhatsApp is blocked.**
   - `email`: the invited email, then SMS, then WhatsApp.
   - `off`: no code.
   A password-reset link never asks for one. SMS and WhatsApp need the invitation's phone number (every invitation has one, ADR-026).
4. **The text is one short segment**, because every segment is billed: `Fleet OTG code 123456. It works for 10 minutes. Do not share it.` (no workspace name). Everything else is ADR-041: only a hash stored, 10-minute expiry, five wrong tries, 60 seconds between sends, five sends per invitation, ten requests per connection per 10 minutes.
5. **The page says where it went without giving the number away:** "a text message to the number ending 4567".
6. **No migration.**

## What is known about Pakistan, and what is not
These come from provider pages and pricing sites, not from the providers' own checked quotes. **Check them before relying on them.**
- **Price per text to Pakistan:** about USD 0.47 on Twilio and about USD 0.08 on Plivo, per aggregator sites. An invitation is one text per employee (a few more if resent), so even Twilio's figure is a small monthly cost for a small fleet. Verify on each provider's own rates page.
- **Sender names:** Pakistan expects a sender ID to be registered with the regulator (PTA) and the networks; providers describe it as taking weeks and needing business documents. Networks may also replace a brand name with a number. **A text sent from a provider's own number is the way to start without waiting**, and may be shown with a different sender on some networks. Delivery to all four networks (Jazz, Telenor, Zong, Ufone) must be tested with real numbers before this is relied on.
- **Local gateways:** Pakistani companies sell PTA-approved bulk SMS with local routes, which may deliver better and cost less. Each has its own API. They are not written here; the owner would name one, and `sendSms` gets a branch for it.

## To switch it on (owner)
1. Open an account with Twilio or Plivo, buy or get a sending number, and note the account id and token.
2. In Netlify set `SMS_PROVIDER`, `SMS_ACCOUNT_ID`, `SMS_AUTH_TOKEN` (secret), `SMS_FROM`, and `INVITE_CODE_CHANNEL=sms`. Redeploy.
3. Invite a test employee with your own phone number and check the text arrives on your network. Repeat with a number on each network you care about.

## Not done
- **Not run against a real provider.** The request formats follow each provider's documented REST call and are covered by unit tests with a fake `fetch`; the first real send may need a small fix.
- Delivery receipts, retries to a second provider, and a voice call fallback.
- A local Pakistani gateway adapter (needs the owner to pick one).
- Browser-suite coverage of the code step.

## Privacy
The phone number and a one-time code are sent to the SMS provider the owner chooses. The Privacy policy names the mail service and Anthropic; it needs a line for the SMS provider once one is chosen. Lawyer review is already pending.
