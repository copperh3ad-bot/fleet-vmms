# RBAC matrix

Generated 2026-11-10 by replaying every `db/tenant-template/*.sql` migration (0001 to 0049) into a scratch database and reading
`roles`, `permissions` and `role_permissions`. If a later migration changes a role, regenerate this file. Design: ADR-002; later
changes in ADR-029, 048, 059, 075, 077, 079, 085.

Role keys: **Adm** tenant_admin, **FM** fleet_manager, **Fin** finance, **Req** requester, **Aud** auditor, **Log** logistics,
**HR** hr, **Sec** gate security, **Ven** vendor (external, single-use links only, no login).

| Permission | Adm | FM | Fin | Req | Aud | Log | HR | Sec | Ven |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Fleet records** | | | | | | | | | |
| vehicle.read | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | | ✔ | |
| vehicle.write | ✔ | ✔ | | | | | | | |
| service.manage (service types, intervals) | ✔ | ✔ | | | | | | | |
| compliance.manage (papers, expiry) | ✔ | ✔ | | | | | | | |
| odometer.submit | | ✔ | | ✔ | | | | | |
| odometer.review | ✔ | ✔ | | | | | | | |
| **Job cards** | | | | | | | | | |
| jobcard.create | ✔ | ✔ | | ✔ | | ✔ | | | |
| jobcard.read_own | | | | ✔ | | | | | |
| jobcard.read_all | ✔ | ✔ | ✔ | | ✔ | ✔ | | | |
| jobcard.approve | ✔ | ✔ | | | | ✔ | | | |
| jobcard.assign_vendor | ✔ | ✔ | | | | ✔ | | | |
| **Quotes, orders and invoices** | | | | | | | | | |
| quotation.submit | | | | | | | | | ✔ |
| quotation.approve | ✔ | ✔ | | | | ✔ | | | |
| vendor.rate (migration 0056) | ✔ | ✔ | | | | | | | |
| workorder.update | | | | | | | | | ✔ |
| invoice.submit | | | | | | | | | ✔ |
| invoice.verify | ✔ | | ✔ | | | | | | |
| invoice.pay (record payment, ADR-086) | ✔ | | ✔ | | | | | | |
| invoice.read (see invoices and payments, ADR-087) | ✔ | ✔ | ✔ | | ✔ | | | | |
| invoice.approve_payment (over the limit or over the quote, ADR-087) | ✔ | ✔ | | | | | | | |
| **Policy, budget and reports** | | | | | | | | | |
| policy.read | ✔ | ✔ | ✔ | ✔ | ✔ | | | | |
| policy.manage | ✔ | ✔ | | | | | | | |
| budget.manage | ✔ | ✔ | ✔ | | | | | | |
| report.view | ✔ | ✔ | ✔ | | ✔ | | | | |
| vendor.manage | ✔ | ✔ | | | | | | | |
| **Vehicle requests (HR)** | | | | | | | | | |
| vreq.request | | | | | | | ✔ | | |
| vreq.read_all | ✔ | ✔ | ✔ | | ✔ | ✔ | ✔ | | |
| vreq.assign (give a pool vehicle, ADR-088) | ✔ | ✔ | | | | ✔ | | | |
| vreq.see_pool (see free vehicles, read-only, ADR-088) | ✔ | ✔ | | | | ✔ | ✔ | | |
| vreq.decide (approve a purchase, or reject) | ✔ | ✔ | | | | | | | |
| vreq.confirm_budget (confirm the budget for a purchase, migration 0058) | ✔ | | ✔ | | | | | | |
| depot.manage (depots and places, migration 0060) | ✔ | ✔ | | | | ✔ | | | |
| **Trips** | | | | | | | | | |
| trip.request | ✔ | ✔ | | ✔ | | ✔ | | | |
| trip.read_all | ✔ | ✔ | | | ✔ | | | | |
| trip.approve | ✔ | ✔ | | | | | | | |
| trip.dispatch (assign pool cars and drivers) | ✔ | ✔ | | | | ✔ | | | |
| trip.award (provider quotes) | ✔ | ✔ | | | | ✔ | | | |
| gate.use | ✔ | | | | | | | ✔ | |
| **Cargo** | | | | | | | | | |
| cargo.request | ✔ | ✔ | | ✔ | | ✔ | | | |
| cargo.handle | ✔ | ✔ | | | | ✔ | | | |
| cargo.read_all (read-only, ADR-088) | | | | | ✔ | | | | |
| **Administration** | | | | | | | | | |
| admin.users (invite employees) | ✔ | | | | | | | | |
| employee.manage | ✔ | ✔ | | | | | | | |
| admin.settings | ✔ | | | | | | | | |

## Rules on top of the table
- Segregation of duties: nobody approves their own job card, quotation or invoice check. The administrator may decide their own
  only while they are the sole active employee (ADR-077). The administrator also may not decide **other people's** while a fleet manager or another approver is
  active, unless the company switches `admin_decides_others` on (ADR-088, default strict).
- Logistics approves only up to the setting `dept_approval_limit`; above it a fleet manager must approve. Vehicles of the
  department are in scope by default (ADR-048, ADR-075). Logistics decides a trip with no vehicle yet, in whole-fleet mode (ADR-088).
- A driver or requester limited to one vehicle sees only that vehicle's dashboard and job cards.
- Trip and cargo permissions work only on the Pro plan (ADR-085); the AI and the WhatsApp menu are also Pro.
- Vendors hold no login; they act only through single-use links (ADR-030, ADR-033).

## Observations (as of 2026-11-10, to confirm with the owner)
1. ~~Finance had no payment permission.~~ Fixed 2026-11-11: `invoice.pay` (Finance, Tenant Admin), migration 0052, ADR-086. The person who
   checked an invoice, or approved or raised its job card, cannot record its payment.
2. HR holds only `vreq.request` and `vreq.read_all`, and no `vehicle.read`.
3. Logistics can approve job cards and quotations (within the department limit) and also dispatch and award trips.
4. The auditor can read job cards, trips, vehicle requests and reports but has no cargo read permission.
