# Fleet VMMS design export

18 screens from the Claude Design canvas "Fleet VMMS Screens". Each is a standalone HTML file in `screens/` (open in any browser, no build). `png/` has a full-page screenshot of each, so you can look at them without opening a browser. `index.html` lists them all. Fonts are IBM Plex Sans and IBM Plex Mono from Google Fonts; screenshots here used fallback fonts.

The HTML is a visual spec, not code to copy. Rebuild each screen as React with Tailwind, keep the fields, labels, wording and sample data. Data is invented (Delta Textiles style names, BKL-245 etc.): use it only for seed data.

## Design tokens
| Use | Value |
|---|---|
| Page background | `#F3F5F6` |
| Card | white, 1px `#D9E0E5`, radius 8 |
| Text / muted | `#14202B` / `#5B6B78` |
| Sidebar | `#0F1E28`, active item `#1D3A4C`, badge `#F2B84B` |
| Primary button | `#0B6E8A` |
| Status pills | ok `#E1F3E8`/`#14633A`, warn `#FBEBCF`/`#7A4800`, bad `#FBE4E1`/`#A3231B`, info `#DCEDF2`/`#0A5F78`, neutral `#E7ECEF`/`#3D4A55` |
| Fonts | IBM Plex Sans 14px body; IBM Plex Mono for numbers, plates, ids (tabular figures) |
| Buttons / inputs | 40px high (32px small); phone screens use 52-56px and 44px+ targets |
| Plate | mono, 1.5px dark border, radius 4 |

Layout: fixed 232px sidebar plus fluid main, content wraps to one column when narrow. Every control needs a visible focus ring (2px `#0B6E8A`). Status is never colour alone: pills carry text.

## Screen to route to data
| Screen file | Suggested route | Reads | Saves with | Permission |
|---|---|---|---|---|
| Login | `/login` (built) | Supabase Auth | sign in | none |
| Main | `/w/[slug]` | `v_vehicle_maintenance_summary`, `v_budget_utilisation`, `v_pm_status`, `v_documents_status` | read only | `report.view` |
| Fleet | `/w/[slug]/vehicles` | `vehicles`, `v_pm_status`, `v_odometer_status`, `v_budget_utilisation` | read only | `vehicle.read` |
| Vehicle | `/w/[slug]/vehicles/[id]` | same, plus `vehicle_custody`, `job_cards` | read only | `vehicle.read` |
| AddVehicle | `/w/[slug]/vehicles/new` | `employees`, `service_types` | `onboard_vehicle()` | `vehicle.write` |
| NewJobCard, MobileJobCard | `/w/[slug]/job-cards/new` | `vehicles`, `reason_codes`, `service_types` | insert `job_cards` + `job_card_lines` + `attachments` | `jobcard.create` |
| ReviewJobCard | `/w/[slug]/job-cards/[id]` | `job_cards`, `job_card_events`, `v_budget_utilisation` | `transitionJobCard()` | `jobcard.approve`, `jobcard.assign_vendor` |
| VendorWorkOrder | `/w/[slug]/vendor/orders/[id]` | `v_vendor_work_orders` | `quotations` + `quotation_lines`, `invoices` + `invoice_lines` | `quotation.submit`, `invoice.submit` |
| InvoiceVerify | `/w/[slug]/invoices/[id]` | `v_invoice_check`, `invoice_lines` | `verify_invoice()` | `invoice.verify` |
| OdometerCycle | `/w/[slug]/odometer` | `odometer_submissions`, `v_odometer_status` | `approve_/reject_odometer_submission`, `open_odometer_cycle` | `odometer.review` |
| MobileOdometer | open decision (see below) | `odometer_submissions` | `submit_odometer()` | `odometer.submit` |
| Budgets | `/w/[slug]/budgets` | `budgets`, `v_budget_utilisation`, `settings` | `budgets`, `settings` | `budget.manage` |
| Compliance | `/w/[slug]/compliance` | `v_documents_status` | `insurance_policies`, `compliance_docs` | `compliance.manage` |
| Accidents | `/w/[slug]/accidents` | `accidents`, `challans` | insert rows | `compliance.manage` |
| ServiceRules | `/w/[slug]/settings/service-rules` | `service_types`, `settings` | same | `service.manage`, `admin.settings` |
| Users | `/w/[slug]/settings/users` | `public.tenant_memberships`, `public.invitations` | invitations | `admin.users` |
| WhyBreaks | `/w/[slug]/why` | `v_vehicle_job_cost`, `v_repeat_repairs` | read only | `report.view` |

Full detail: `docs/FORM-DB-MAP.md`.

## Open decision
MobileOdometer shows no sign-in. The rule "no unauthenticated endpoints" forbids that. Options: a single-use signed link for one reading (written exception), or phone-code login. Ask the owner before building.

## Known design gaps
Password reset, vendor list and onboarding, Reports exports, empty and error states, and the sidebar link to a Reports page (removed).
