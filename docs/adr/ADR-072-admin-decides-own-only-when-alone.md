# ADR-072: The administrator decides their own work only when nobody else could

Status: built; tenant migration 0038 to be applied on live. Owner decision (2026-11-08, after a QA report flagged self-approval). Amends ADR-029 decisions 4 and 5.

## Context

ADR-029 let the administrator (`tenant_admin`) approve a job card they raised, decide their own quotation, and check their own invoice, so a company run by one person is not stuck. But the same exception applied to every company, including those with a fleet manager and finance. The website, the FAQ and the landing page say "nobody approves their own job", which was then untrue for the administrator.

## Decision

The administrator may decide their own job card (`jobcard.approve`), quotation (`quotation.approve`) or invoice check (`invoice.verify`) **only while no other active member of the company holds that permission.**

- A database function `admin_may_decide_own(permission)` (tenant migration 0038) answers it from the live list of active members and the role permissions. It is false for every role except the administrator.
- The job card guard, `approve_quotation` and `verify_invoice` use it where they used to check "is the administrator". Every other role is unchanged.
- It is evaluated at the moment of the decision, not stored. Adding a second approver ends the exception at once; disabling them brings it back. An invited person who has not yet joined does not count.
- With two administrators each holds the permission, so neither can decide their own.
- The screens use the same answer (`adminMayDecideOwn`): the decision panel, the queue on the dashboard, and the invoice review show the decision to the administrator only when the database would accept it. When the administrator does decide their own card, the panel says so and the record shows that they raised and approved it.
- If the database does not have the function yet (a deploy that comes before migration 0038), the screens fall back to the old rule, the same one the database is still enforcing.

## Wording

The FAQ and About page now state the exception: a company where nobody else can approve. The shorter lines ("Nobody approves their own job") stay, because they are true of every company with a second approver.

## Order of going live

Deploy, then apply tenant migration 0038. Until it is applied the database keeps enforcing the old rule.
