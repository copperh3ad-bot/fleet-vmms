# ADR-029: Own-vehicle portal, optional costs, and administrator approval

**Status:** Accepted  **Date:** 2026-10-25

## Decisions
1. **A person limited to their own vehicle (`vehicle_scope = own`) gets two things: the dashboard and the job cards of the vehicle they hold.**
   Every other workspace page answers "not allowed", even by typed address (`requireMembership(slug, { fullScope: true })`), and the sidebar
   shows only Dashboard and Job cards. Workshops (role `vendor`) are unaffected.
2. **Their dashboard shows what their vehicle has cost**: this month, this year, all time, open cards, a per-vehicle table and the latest cards.
   Only job cards raised while they were the holder (`custodian_id` = their employee record) count, the same rule that decides which cards they may
   open. The query filters on the signed-in person, not on anything the page sends.
3. **The person raising a job card need not know any cost.** A line with no cost is stored at zero; the form and the phone wizard say so. The real
   cost comes later from the verified invoice (which replaces the estimate in `v_vehicle_job_cost`).
4. **The administrator (`tenant_admin`) may approve a job card they raised themselves.** Migration 0020 gives the role `jobcard.approve` and
   `jobcard.assign_vendor`, drops the table's blunt "approver is not the requester" check, and the guard keeps that rule for every other role.
   Approval is still recorded with the person and the time.

5. **The same holds for quotations and invoices.** Migration 0021 gives the administrator `quotation.approve` and `invoice.verify`, and
   `approve_quotation` and `verify_invoice` skip the separation-of-duties refusal for that role only. Everyone else keeps it.

## Not changed
Finance and fleet managers keep every separation of duties.

## Needs the owner
Migrations 0020 and 0021 must be run on every tenant schema (`scripts/migrate-tenants.mts`) before administrators can self-approve on the live site.
