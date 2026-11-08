# ADR-076: A beta switch for the WhatsApp one-time codes, and shared phone numbers while testing

Status: built; deployed with the next release. No migration (the setting lives in the existing `platform_settings` table). Owner request (2026-11-09): the code mechanism has been checked and works, but testing every role needs more phone numbers than the testers have.

## Decision

1. A platform setting `otp_checks` on Admin > Settings. **`off`** stops the WhatsApp code in both places; empty or `on` asks for it exactly as before. Only the word `off` switches it off; anything else, and any failure to read the setting, keeps the codes on.
   - **Invitations** (ADR-041, ADR-046): no code is asked for or sent; the link alone makes the account. The invitation page, the "send a code" action and the code check all read the setting.
   - **Joining with a company code** (ADR-055): the request is saved as already waiting for the administrator, who is told as after a typed code. The browser keeps no reference and the sent page says the administrator now has the request. Joining then also works where WhatsApp is not set up.
2. It is a stored setting, not an environment value: it changes at once, changes back with no deploy, and the save is in the activity log. The older `INVITE_CODE_CHANNEL=off` still works for invitations.
3. **Shared phone numbers for beta.** Nothing in the data stops two employees having the same number. The one obstacle was the join form's limit of three requests an hour per number, which exists to stop the form sending WhatsApp messages to a stranger. While the codes are off nothing is sent, so that limit is skipped; the per-address and per-email limits stay. The WhatsApp job-card intake still refuses to guess between two employees with one number (ADR-061), so those people cannot use that feature until their numbers differ.
4. **What is weaker while it is off:** a phone number is stored but nothing proves it belongs to the person, and anyone with a company code can ask to join with any number. The administrator still approves or declines every request, the company code is still required, the licence is still checked, and the waiting-request cap still applies. The setting's help text says so.

## Turning it back on

Set the setting to `on` or clear it. Requests already made while it was off stay as they are; invitations opened afterwards ask for the code again.
