# ADR-062: Daily maintenance reminders, and reminders by email

Status: accepted, 2026-11-07 (built, not deployed; tenant migration 0036 not run on live). Owner request: "Turn on auto reminders to users whose licence is expiring or periodic maintenance is due." Chosen with the owner: in-app plus email; maintenance-due goes to the vehicle's holder and the fleet managers.

## What already ran
Licence and vehicle-document expiry reminders already ran every day (the Netlify scheduled function `reminders`, 03:00 UTC), as in-app notices: 60, 30 and 14 days before (the company's `doc_reminder_days`), and one when expired. The licence holder and the people who hold `compliance.manage` are told. Nothing was done for periodic maintenance, which only showed as markers on screen.

## Decision
1. **Maintenance reminders.** `claim_pm_reminders()` (tenant migration 0036) reads the existing `v_pm_status` and claims, in the same statement that returns them, each service that is **due soon** or **overdue** on an **active** vehicle with a service history. A service gets one "due soon" and one "overdue" notice per cycle; `pm_reminders` is keyed by vehicle, service, stage and the last-done date, so doing the service starts a new cycle. A service with an open job card is left alone (the view marks it scheduled).
2. **Who is told:** the person holding the vehicle (`custodian`) and everyone with `service.manage` (the administrator and fleet manager). Notice kinds `service.due` and `service.overdue`, shown in Notifications with a link to the vehicle.
3. **Email.** Where a mail service is set up (`SMTP_URL` and `EMAIL_FROM`, ADR-024), each person with an email address on their **employee record** gets **one email a day** listing everything new for them across documents, licences and maintenance (`buildReminderMail`), with a link to their notices. Nothing new, no email. Emails go after the database transaction has committed; a mail failure is logged by code only and never undoes a notice. The email never carries a licence number. Without a mail service the in-app notices still run and nothing is emailed.
4. **Order of work in the daily run** (`runDocumentReminders`): documents and licences, then maintenance, then the emails. A company that has not yet had migration 0036 simply has no maintenance reminders; its other reminders still go.
5. A locked (unpaid) organization still gets nothing, as before.

## Not done
WhatsApp reminders: they need two Utility templates (licence expiring, service due) approved by Meta. Left for the owner to ask for.

## Owner steps
Run tenant migration 0036 on live, then deploy. For email, set `SMTP_URL` and `EMAIL_FROM` in Netlify (still on the owner's list); staff need an email address on their employee record.

## Tests
`tests/pm-reminders.test.ts` (8): nothing when far off; one due-soon notice to holder and managers; one overdue notice; a new cycle after a service; a vehicle not in service is skipped; no email without a mail service; one digest email per person and none for someone without an address; the digest text.
