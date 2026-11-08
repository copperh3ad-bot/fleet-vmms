# ADR-073: Tests run as a database account that is not a superuser

Status: built; tenant migration 0039 to be applied on live.

## Context

A QA run on the live site found that a workshop could not send an estimate: the page answered 500 and the log said `permission denied for table job_card_events`. The invoice link and the emailed-estimate path failed the same way. Every test passed, because they ran on PGlite or as a local superuser, and a superuser ignores table permissions. The live database account is not a superuser.

The cause was a deferred check (`job_card_event_required`, migration 0006). A deferred trigger runs when the transaction commits, with the rights of whoever is acting then. For a workshop using a one-time link that is a restricted database role (`quotation_link`, `inbound_mail`) which has no table access by design (ADR-006, ADR-033).

## Decision

1. **The check runs as its owner** (tenant migration 0039): `security definer` with a pinned `search_path`, execute revoked from public as for every function since 0037. It only reads one table to confirm the history is complete. The restricted roles gain no access.
2. **Tests that touch the restricted roles run as a non-superuser.** `scripts/test-live-like.sh` makes a local `fleet_owner` account (not a superuser) and a database it owns, then runs the workshop link, invoice link, emailed estimate, driver link and WhatsApp intake suites against it, one file at a time (each file rebuilds the database). `--all` runs the whole unit suite this way: apart from this bug it is clean, except two files that create extra databases and need a TCP address.
3. **The browser suite connects as the same account** (`e2e/run.sh`), so full flows run with real table permissions, and it builds from scratch and checks that every script file a page asks for exists.

## Also fixed from the same QA report

- The invitation email carried an empty link: the administrator's copy of the link is blanked on purpose when WhatsApp delivers it, and that same blank value was passed to the email. The email now gets the real link (`inviteLinks`) and the email builder refuses a blank one.
- A person who joined by company code but never typed the WhatsApp code (ADR-055: the request is invisible to the administrator until then) saw only "No workspace yet". The screen now explains the step.
- The vehicles Show button belonged to a separate form from the search box and dropped the text; they are one form. The dashboard's Service due table scrolls inside its panel on a phone.

## Order of going live

Deploy, then apply tenant migration 0039. Until it is applied the workshop quote link still fails.
