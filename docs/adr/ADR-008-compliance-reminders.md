# ADR-008: Compliance records and expiry reminders

Status: accepted, Phase 7.

- **A renewal is a new row.** Insurance goes to `insurance_policies`, every other document to `compliance_docs`. `v_documents_expiring` already keeps only the newest expiry per (vehicle, type), so a renewal replaces the old row in lists and reminders, and the old row stays as history.
- **Reminders are claimed in the database.** `claim_document_reminders(today)` finds what is due and records it in `document_reminders` in one statement; the caller writes the notifications in the same transaction. A second or concurrent run finds nothing new. Thresholds come from `settings.doc_reminder_days` (default 60,30,14) plus an "expired" step at 0.
- **One notice per step, and only the tightest one.** A document that is first entered with 10 days left gets one notice, not three; the wider thresholds are marked as claimed so they never fire later. Each step (60, 30, 14, expired) fires once as time passes.
- **Who is told:** members whose role holds `compliance.manage`, and the vehicle's current holder if they have a login. In-app notifications only. Email and WhatsApp need a provider and a cost decision, so they are not built.
- **How it runs: a script, not an endpoint.** `npm run reminders` (`scripts/send-reminders.mts`) goes through every active workspace with a system actor that holds no permissions. A web endpoint would be a new unauthenticated or secret-protected route (rule 5); a scheduler calling a script on the host needs neither. A failing workspace is reported and does not stop the others. **Open: the scheduler itself** (a daily job on the hosting provider) is chosen when hosting is chosen.
- **Only vehicles that are active or in the workshop** are listed and reminded. Sold or inactive vehicles are ignored.
- **Accidents and challans:** the driver defaults to whoever held the vehicle at that date (existing trigger), can be overridden. A claim reference needs the "claim made" box. A job card linked to an accident must be for the same vehicle. Challan "paid" sets the paid date, reopening clears it.
- **Files** on documents, accidents and challans use the same checks as job card files (type by signature, 10 MB, 12 per record, tenant folder). `attachment_guard` now verifies the target exists for every entity type.
- **Known gaps:** the 30 and 90 day buckets in `v_documents_status` are fixed in the view, not taken from settings (Phase 6 settings screen). No email or WhatsApp. No bulk import of documents yet.
