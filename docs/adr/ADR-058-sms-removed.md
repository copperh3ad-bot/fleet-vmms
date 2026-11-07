# ADR-058: SMS (Twilio and Plivo) removed

Status: accepted, 2026-11-07. Owner decision: remove the unused Twilio/SMS code and the `SMS_*` Netlify values. Supersedes ADR-047.

## Decision
- The invitation code goes by **WhatsApp or email only**. `src/lib/sms.ts` and `scripts/test-sms.mts` are deleted, and the SMS tests with them.
- `INVITE_CODE_CHANNEL`: unset, `auto` or `whatsapp` use WhatsApp; `email` tries email then WhatsApp; `off` asks for no code. `sms` is no longer a value and behaves as `auto`.
- The "Send as a text message" compose link on the Users and quotation pages (`smsLink` in `src/lib/phone.ts`) is unrelated (it opens the person's own messaging app) and stays.
- Netlify values `SMS_PROVIDER`, `SMS_ACCOUNT_ID`, `SMS_AUTH_TOKEN`, `SMS_FROM` are no longer read and are unset.

## Consequence
A person invited with a phone but no WhatsApp reachable (for example an Indonesian number, Meta code 130497) gets no code by SMS. Use the email route for them, or `off`.
