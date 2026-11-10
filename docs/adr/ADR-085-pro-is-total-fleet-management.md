# ADR-085: Basic is maintenance management, Pro is total fleet management

Status: accepted, 2026-11-10 (owner decision: trip scheduling makes Fleet OTG more than a maintenance app; Basic leans to maintenance management only, Pro is the whole fleet solution).

## Decision
- **Basic** = maintenance management: job cards and approvals, workshops and quotations, invoices checked, servicing, reminders, papers, odometer by link, budgets and reports, departments, and HR vehicle requests (who holds a vehicle, which cost follows).
- **Pro** = total fleet management: Basic plus **trip scheduling** and **cargo requests** (moved from Basic), logistics provider quotes and invoices, the AI (documents, quote advice), and the WhatsApp menu.
- The split is enforced in the app, not only in the words. A plan feature flag `fleet_ops` (control migration 0027: Basic `false`, Pro `true`; no price, CLAUDE.md rule 7). `TenantPlan.fleetOps` is `features.fleet_ops !== false`, so **only a plan that says false loses the feature**: an organization with no plan row (before billing existed, and in tests) and a plan silent on it keep trips and cargo. The Basic company's 3-day Pro trial uses Pro's features, so it has them too.
- One check, in `src/lib/billing/fleet-ops.ts`: the trips and cargo services use `fleetAuthorized` and `fleetAuthorizedAny` instead of `authorized` and `authorizedAny`. They look the plan up **before** the tenant transaction opens, then check the permission as before. A Basic company gets "Trip scheduling and cargo requests are part of the Pro plan." The Trips and Cargo links are hidden, `tripsEnabled` answers false, and the cargo pages show the same sentence. `createCargoRequest` checks the plan before it validates the form.
- **Not moved:** HR vehicle requests stay in Basic. They decide who holds a vehicle, which the cost-per-vehicle and licence rules depend on. The WhatsApp menu was already Pro.
- Public words follow: the site, Compare plans, FAQ, llms.txt, pricing and About pages, and both flyers say Basic is maintenance management and Pro is total fleet management. The Compare data has eight Pro rows (two new: Trip scheduling, Cargo requests). No figure or price is added.

## Effect on live
Both live companies are on Pro, so nothing changes for them. A company on Basic that had switched trips on would lose Trips and Cargo from the moment control 0027 is applied; existing trip and cargo records stay in its database and return if it moves to Pro. The control migration is idempotent and needs the owner's approval to apply live.

## Tests
`tests/fleet-ops-plan.test.ts`: the flag (false only when the plan says so), the migration's values, a Basic company refused trips and cargo (and `tripsEnabled` false), and Pro or no plan row keeping them. `tests/plan-compare.test.ts` updated to eight Pro rows.
