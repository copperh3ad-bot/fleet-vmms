# ADR-088: Roles after the questionnaire, and the strict administrator

**Status:** Accepted (built, not deployed)  **Date:** 2026-11-11  **Amends:** ADR-072, ADR-075, ADR-077

## Context
The full-flow QA runs (QA-FULLFLOW-2026-11-10 and R9) found that the administrator could approve other people's job cards while a fleet manager was
active (F-01), that Logistics could not give a pool vehicle on an HR request or decide a trip that had no vehicle yet (F-02), that HR could not see which
vehicles were free, that the auditor could not read cargo, and that requesters were refused the Vehicles page although the permission list gives them
`vehicle.read` (F-06). The owner answered each in docs/OWNER-DECISIONS-2026-11-11.md (A1 to A6). Invoice reading for the auditor was done in ADR-087.

## Decision
- **A1, the strict administrator.** New company setting `admin_decides_others` (default **0**, strict). While it is 0 the administrator may not approve a job
  card, a quotation or an invoice check **if another active member who is not the administrator holds that permission**. If nobody else could decide,
  the administrator is never blocked. A workshop, a disabled member and an invited person who has not joined never count. Set to 1 the administrator may decide
  too. This is added to ADR-077, which already stops the administrator deciding their **own** item unless they are the only employee. The checks are in
  the database (`admin_blocked_from_others`, called by `job_card_guard`, `approve_quotation` and `verify_invoice`, migration 0054).
  Companies that upgrade become strict; the setting is on the Service rules page (Company switches).
- **A2, HR requests.** New permission `vreq.assign` (Logistics, Fleet Manager, Admin): give a vehicle from the pool. `vreq.decide` (Fleet Manager,
  Admin) keeps approving a purchase and rejecting. Logistics also gets `vreq.read_all` so it sees the requests. New requests notify everyone who holds
  `vreq.assign`.
- **A3, trips.** No new permission. Logistics already acts on trips that are "dispatchable" (pick-and-drop runs, and trips on a vehicle in its
  department). The gap was a trip with no vehicle chosen yet. While Logistics sees the whole fleet (the default, ADR-075) such a trip is now Logistics' to
  see, approve, reject and assign. In department-scoped mode it is not. The owner said "within the department limit"; this reads that as "within the
  department's reach". Trips carry no amount, so the money limit `dept_approval_limit` does not apply to them.
- **A4, cargo.** New permission `cargo.read_all` for the auditor: read-only. Handling cargo still needs `cargo.handle`.
- **A5, HR and the pool.** New permission `vreq.see_pool` (HR, plus Logistics, Fleet Manager, Admin): a read-only list of vehicles in service that nobody
  holds, on the Vehicle requests page. It gives no access to the vehicle list.
- **A6, own vehicles.** A member limited to their own vehicle may open the Vehicles list and the page of their own vehicle, read-only. The services already
  filtered by custody; the pages no longer refuse that member. The plan-usage line and the export are hidden for them because they show company-wide numbers.

## Not decided here
Whether Logistics should be able to reject an HR request (it cannot today), a company-wide limit on trips, and whether a requester should see the other
vehicles of their department.

## Consequences
Existing companies with a fleet manager become strict on the next deploy; to keep the old behaviour they switch `admin_decides_others` on.
The job card page used to show the administrator an Approve button that failed with the company-rule message (QA run R10). It no longer does: `adminBlockedFromOthers`
(`src/lib/auth/can.ts`) asks the database function, and the job card page (approve and quotation approve) and the invoice page (check) show the rule in words instead of the button or form.
The database still refuses the decision either way.
