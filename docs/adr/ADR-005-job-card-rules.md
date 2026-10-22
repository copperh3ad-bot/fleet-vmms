# ADR-005: Job card rules (approval, events, attachments)

Status: accepted, Phase 3.

- **The database enforces the rules; the app only asks.** Migration 0006 puts these in triggers, so hand-written SQL cannot get around them:
  - Approval needs an approver who is the signed-in user (`app.user_id` matches `employees.user_id`), is not the requester, and whose role holds `jobcard.approve` (`app.role`).
  - The approver cannot be changed later. The requester cannot change after submission.
  - A card starts as a draft.
  - Every status change must have a matching `job_card_events` row, checked at commit by a deferred constraint trigger. `job_card_events` is append-only.
- **One entry point.** `transitionJobCard` (TypeScript) calls `transition_job_card` (SQL). Creation and edits are `create_job_card` / `edit_job_card`, which also save the lines and events in one transaction. The permission needed per target status is one table in `src/lib/jobcards/schemas.ts`. Phase 4 adds the vendor steps there.
- **Segregation is requester <> approver.** A manager who only typed the card in for a driver ("raise on behalf of") may approve it. If we later want "whoever opened it cannot approve", change the guard, not the app.
- **Timeline order** uses `job_card_events.seq`, because events in one transaction share a timestamp.
- **Notifications** are rows written in the same transaction as the change: submit tells every active member whose role can approve (except the actor); approve, reject and return tell the requester.
- **Attachments**: private bucket `attachments`, path `<tenant schema>/job_card/<id>/<uuid>-<clean name>`. Storage policies (platform migration 0003) let a signed-in user touch only folders of tenants they belong to. The tenant trigger `attachment_guard` rejects any other path. Type is decided by file signature plus extension (JPEG, PNG, WebP, HEIC, PDF), max 10 MB and 12 files per card. Only the requester can add or remove files, and only on a draft or returned card. Download links are signed for 5 minutes and never issued for a path outside the workspace folder.
- **Not decided here:** how drivers send odometer readings without signing in.
