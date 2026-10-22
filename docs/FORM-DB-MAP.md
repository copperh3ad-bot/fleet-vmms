# Screen to database map

Every screen in the design canvas, what it reads, and the one call that saves it. Anything saving to more than one table goes through a SQL function so it is all-or-nothing. All writes go through `lib/db/tenant.ts` and `can()`.

| Screen | Reads | Saves with | Permission |
|---|---|---|---|
| Sign in | `public.tenants` (slug), Supabase Auth, `tenant_memberships` | Auth only | none |
| Dashboard | `v_vehicle_maintenance_summary`, `v_budget_utilisation`, `v_pm_status`, `v_documents_status`, `job_cards` | read only | `report.view` |
| Vehicles list / record | `vehicles`, `v_pm_status`, `v_odometer_status`, `v_budget_utilisation`, `vehicle_custody` | read only | `vehicle.read` |
| Add a vehicle | `employees` (names only), `service_types` | `onboard_vehicle(jsonb)`: vehicle, first odometer reading, custody, service baselines, insurance, documents, budget in one transaction | `vehicle.write` |
| Vehicle record: custody | `vehicle_custody`, `v_pm_status` | `change_custody()`, `end_custody()` | `vehicle.write` |
| Vehicles: import CSV | `vehicles`, `employees`, `service_types` | `onboard_vehicle` per row, all rows in one transaction, refused if any row has an error | `vehicle.write` |
| Employees | `employees` | insert/update `employees` | `employee.manage` |
| Vendors | `vendors` | insert/update `vendors`, block/unblock | `vendor.manage` |
| New job card (desktop, phone) | `vehicles`, `reason_codes`, `service_types` | insert `job_cards` + `job_card_lines` + `attachments`; `requested_reason_code_id` is set by trigger | `jobcard.create` |
| *(built Phase 3)* New job card / edit | `create_job_card()`, `edit_job_card()` (card, lines, custodian snapshot, events in one call); files via `attachments` + Storage | `/w/[slug]/job-cards/new`, `/[id]/edit` | `jobcard.create` |
| *(built Phase 3)* Job card record and decision | `getJobCard`, `transition_job_card()`; approve re-tag, reject/return need a comment, vendor assign | `/w/[slug]/job-cards/[id]` | `jobcard.approve`, `jobcard.assign_vendor` |
| *(built Phase 3)* Notifications | `notifications` (own rows) | `/w/[slug]/notifications` | any job card permission |
| *(built Phase 4)* Vendor portal: my work, send quotation, work order, send invoice | `v_vendor_job_requests`, `v_vendor_work_orders`, `v_vendor_quotation_lines`, `v_vendor_invoices`; `submit_quotation()`, `vendor_start_work()`, `vendor_complete_work()`, `submit_invoice()` | `/w/[slug]/vendor/*` | `quotation.submit`, `workorder.update`, `invoice.submit` |
| *(built Phase 4)* Quotation decision on the job card | `approve_quotation()` (issues the work order), `reject_quotation()` | `/w/[slug]/job-cards/[id]` | `quotation.approve` |
| *(built Phase 4)* Invoices and invoice check | `v_invoice_check`, `invoice_lines`, `verify_invoice()`, close via `transition_job_card` | `/w/[slug]/invoices`, `/invoices/[id]` | `invoice.verify` |
| Review job card | `job_cards`, `job_card_events`, `v_budget_utilisation` | `transitionJobCard()` (re-tag writes `reason_code_id`, requester's original is kept); vendor via `vendor_id` | `jobcard.approve`, `jobcard.assign_vendor` |
| Vendor portal | `v_vendor_work_orders` (filters itself on the signed-in user, no requester or budget) | `quotations` + `quotation_lines` (total follows lines); after approval `invoices` + `invoice_lines` | `quotation.submit`, `invoice.submit` |
| Invoice verification | `v_invoice_check`, `invoice_lines`, `attachments` | `verify_invoice(id, user, decision, note)`: sets payable amount, moves job card, writes event. Blocks approver and requester | `invoice.verify` |
| Monthly odometer review | `odometer_submissions`, `v_odometer_status` | `approve_odometer_submission`, `reject_odometer_submission`, `open_odometer_cycle` | `odometer.review` |
| Phone odometer | `odometer_submissions` | `submit_odometer` | `odometer.submit` |
| Budgets | `budgets`, `v_budget_utilisation`, `settings` | insert/update `budgets` (overlap blocked, amount change needs a new reason), `settings` for 80/100 % | `budget.manage` |
| Compliance | `v_documents_status` (insurance + other documents, newest renewal only) | `insurance_policies` or `compliance_docs` + `attachments`; reminders tracked in `document_reminders` | `compliance.manage` |
| Accidents and challans | `accidents`, `challans`, `vehicle_custody` | insert rows; driver filled from custody by trigger; paid date set by trigger | `compliance.manage` |
| Service rules | `service_types`, `settings` | update `service_types` (incl. `applies_to_classes`), `settings` (known keys only, numeric) | `service.manage`, `admin.settings` |
| Users and roles | `public.tenant_memberships`, `public.invitations`, `role_permissions` | invitation insert (token hash only), accept creates membership + employee | `admin.users` |
| Why it keeps breaking | `v_vehicle_job_cost`, `v_repeat_repairs`, `job_cards.requested_reason_code_id` vs `reason_code_id` | read only | `report.view` |

## Open decision

The phone odometer page says drivers need no sign-in. CLAUDE.md forbids unauthenticated endpoints. Resolve before building: either (a) a single-use signed link scoped to one submission, written down as a deliberate exception, or (b) drivers sign in with a phone number code. Not built yet.

## Known gaps

- "Last seen" on Users comes from Supabase Auth, not a tenant table.
- Reports screen and export formats are not designed.
- Flag rules (`flag_jobs_90d`, `flag_repeat_days`, `flag_cost_multiple`) are stored and validated, but the views that use them are not written yet. `v_repeat_repairs` still has no time window.
