# ADR-021: Contact us page

Status: accepted, 2026-10-24. Owner request: a Contact us page.

## Decision
1. **`/contact` (public).** A form (name, email, optional company, a topic, a message) and links to the pages that answer common questions. It shows the support email from the operator settings only if the owner has entered one; nothing is made up.
2. **One stored row, nothing sent.** A message is one row in `public.contact_messages` (control migration 0010, row security on, no access for the public API roles). No email is sent from the application, so there is no mail relay to abuse. The operator reads the messages in `/admin/messages` (new ones first, a count in the menu) and answers from their own email, then marks the message handled.
3. **Abuse limits.** A hidden field that only a script fills (the script is told it worked, and nothing is stored); 5 messages per hour per connection and 3 per hour per email address, counted before the write and shared across servers; every field has a length limit, in the form and again in the database. The page shows the same thanks whoever wrote, and never says whether an address is a customer.
4. **Operator access.** Reading and marking a message each check `platform_admins` inside the same transaction as the work, like every other operator function.

## Why
A form that stores a row needs no new infrastructure and is quick to reason about. Sending email would need a verified sending domain and a way to stop it being used to spam third parties, neither of which exists yet.

## Not done
- No email to the owner when a message arrives. The Messages count in the operator menu is the signal until email is set up.
- No attachments, no reply from inside the app, no spam scoring beyond the limits above.
