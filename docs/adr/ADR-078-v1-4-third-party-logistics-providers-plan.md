# ADR-078: V1.4 plan, third-party logistics providers (3PL) quote and invoice for trips

Status: **plan only, nothing built.** Proposed 2026-11-09. Owner request: "V1.4 adds 3rd party logistics providers as vendors, they can also quote for trips and invoice accordingly." Builds on ADR-007 and ADR-030/033 (vendors, estimate and invoice links for job cards), ADR-045 (trips, pool cars), ADR-067 (V1.3, deferred) and ADR-077. No price is set here (CLAUDE.md rule 7). Decisions marked **OWNER** are open.

## What exists today
- A **vendor** (`vendors`) is a workshop. It is assigned to a job card, quotes through a single-use `/q/<token>` link or a login ("My work"), is approved by a person who is not the card's requester, then invoices through `/i/<token>`; Finance verifies the invoice against the approved amount (`vendor_flow`, `quotation_links`, `invoice_links`, role `vendor`).
- A **trip** (`trips`) is requested, approved with an own vehicle and employee driver assigned, started and completed with odometer readings. No cost is held on a trip.

## Decision (proposed)
1. **A vendor has a type**: `workshop` (default, today's behaviour) or `logistics` (a 3PL). Same table, same Vendors page, same login role `vendor`; the type decides which work it is offered.
2. **A trip can be outsourced.** A dispatcher (`trip.dispatch` / `trip.approve`) approving a trip chooses either *own vehicle and driver* (today) or *a logistics provider*. For a provider the vehicle and driver stay empty (the "approved needs vehicle and driver" check is relaxed for outsourced trips); the provider's vehicle registration and driver name are recorded as text when known.
3. **Quote.** A trip can ask one or more providers for a quote through the same kind of single-use link (`/q/<token>` kind `trip`), showing only route, date and time, passengers or load description, and nothing about who asked or any budget. The quote is an amount with notes and validity. Same narrow database role pattern as ADR-030. A provider with a login quotes through "My work".
4. **Award.** Someone other than the requester awards one quote (the rule for job cards, including ADR-077 for the administrator). The trip is then `approved` as outsourced to that provider. Other quotes close.
5. **Invoice.** After the trip is completed, the provider invoices through a single-use invoice link; Finance verifies against the awarded amount exactly as for job cards (difference needs a note; the person who awarded cannot verify).
6. **Completion** of an outsourced trip is confirmed by the dispatcher (no odometer, since it is not our vehicle). Distance may be entered by hand.
7. **State machine.** Trip states are unchanged; outsourced adds sub-states through `trip_events` (quote requested, quote received, awarded, invoiced, verified). `transitionTrip` remains the only writer of `trips.status`.
8. **Reports.** Outsourced trip cost per provider and per period; own versus outsourced counts. Costs are never mixed into the vehicle cost report, since there is no vehicle of ours.
9. **Permissions.** New: `trip.quote.approve` (awarding) and `trip.invoice.verify`, granted by default to the same roles as `quotation.approve` and `invoice.verify`. Vendor-type `logistics` logins see only their own trips.

## Owner decisions (2026-11-09)
- A. **Vendor types are differentiated**: `workshop` and `logistics` are distinct types with their own screens, offers and permissions (a workshop is never offered a trip, a provider never a job card). Whether they also get a separate login role, or the one `vendor` role with the type deciding, is a build detail; either way a login sees only work of its own type.
- B. **One trip goes to many providers; each quotes; one is awarded.** The dispatcher picks the providers; each gets its own single-use link; the other quotes close on award.
- C. **Rate cards are decided by each tenant individually.** Each organization may enter its own providers' standing rates (per km, per day, per route) as reference beside the quotes; nothing is built in and no rate is shared between tenants (the same rule as ADR-018 for rates). Rate cards are optional and never replace a quote.
- D. **Logistics may award** (and the Fleet manager and administrator under the existing rules); nobody awards their own request.
- E. **A Pro feature**, because it needs AI to manage the quotes (compare, flag the outlier, summarize). Pro is Phase 2 and priced by the owner in fleet-size bands (rule 7), so nothing here sets a price. Until Pro exists the module is simply off for Basic organizations; the plan check is the same one other Pro features will use.
- F. **Links are sent on WhatsApp** to each provider's own number (ADR-026 rule: the number comes from the vendor record). Same hand-off or server-side send as job card links.

## Data and gates (when built)
Tenant migration (next free number): `vendors.kind`; `trips.outsourced_vendor_id`, `trips.vendor_vehicle_text`, `trips.vendor_driver_text`, `trips.award_amount`; trip quotation and invoice tables (or the existing ones widened with a `trip_id`, to be decided when built: widening keeps one verification path); link kinds in `public.link_routes`; two SECURITY DEFINER functions and a database role as in ADR-030/033; the relaxed check on `trips`. Embedded migrations, tests as non-superuser (ADR-073), browser scenario for the whole flow, FAQ/About/Features wording. CLAUDE.md rule 5 gains the single-use provider quote and invoice links.

## Phases
- **A:** vendor type, outsourced trip, request to many providers, award, tests.
- **B:** quote link and invoice link for trips, verification, tests.
- **C:** tenant rate cards, the Pro gate, reports, notifications, browser scenario, copy.
- **Later (AI):** quote comparison and outlier flags, once Pro is built.

## Amendment, 2026-11-09 (phase A and the quote link built)
- **Phase A is live** (tenant 0044, control 0023): vendor type, outsourced trips, quotes entered by staff, award, Pro gate.
- **Phase B, quote link (built, not yet live):** the provider's single-use link is the same `/q/<token>` page and the same `public.quotation_links` table with kind `trip_quote` and a `trip_quote_id` (public 0017, control 0024). Tenant 0045 adds `trip_quote_link_info` and `submit_trip_quote_via_link`, SECURITY DEFINER, executable by role `quotation_link` only. The page shows the trip number, purpose, route, stops, times and passengers; never who asked, any budget or other providers' quotes. The link works once, stops when the trip is rejected, cancelled or awarded or the provider is declined, and a refused quote does not burn it. Staff send it from the trip page: through their own WhatsApp or messages app to the provider's own number (not shown on screen), or from Fleet OTG on WhatsApp when `WHATSAPP_TRIP_QUOTE_TEMPLATE` names an approved template (params: provider, company, trip number; button suffix the token).
- **Not built:** the provider's invoice link and Finance's check of it (phase B2), rate cards, reports, the AI quote comparison.
- **Needs the owner:** a WhatsApp utility template for the trip quote request, if sending from Fleet OTG is wanted; until then the hand-off buttons work.

## Amendment, 2026-11-09 (phase B2 built: the provider's invoice and Finance's check)
- **Applied on live:** public 0017, control 0024 and tenant 0045 (the quote link). **Not yet applied:** public 0018, control 0025 and tenant 0046 (this amendment).
- **Invoice link:** the same `/q/<token>` page and `public.quotation_links` table, kind `trip_invoice` with a `trip_id`. Allowed only for an awarded trip that has been marked returned and has no live invoice; works once; a refused invoice does not burn it. The page shows the trip, the route and the agreed price, never who asked or other providers' quotes. Staff send it from the trip page through their own WhatsApp or messages app to the provider's own number (not shown on screen). No server-side WhatsApp template for invoices yet.
- **Invoice:** `trip_invoices` (number, date, amount, notes). One live (submitted or verified) invoice per trip; a returned one can be replaced through a new link.
- **Check:** `trip_invoice_verify` is the one function that records the decision, with a history line on the trip. Needs `invoice.verify` (Finance, administrator). Decisions: pay the agreed amount (the invoice must equal it), pay what was billed (note required when it differs), or return it (note required). The person who awarded the trip, or asked for it, cannot check its invoice, except a sole-employee administrator (ADR-077).
- **Who sees it:** Finance sees the Trips menu and an outsourced trip once a provider has invoiced it, nothing else about trips.
- **Not built:** rate cards, outsourced-trip cost reports, the AI quote comparison, a WhatsApp template for the invoice request.

## Amendment, 2026-11-09 (phase C built: rate cards, the cost report, the Pro copy)
- **Rate cards (tenant 0047):** `provider_rates`, entered by whoever manages vendors for a logistics provider (label, how it is charged, the rate, a note). Each organization's own, never built in or shared. Shown on the Vendors page and beside each provider's quote on the trip. A Pro feature like the rest. A rate never replaces a quote.
- **Outsourced trips report:** `/w/<slug>/trips/outsourced`, and a CSV `outsourced-trips`: per provider, trips, awarded, invoiced, payable (what Finance has checked), "saved by comparing" (the highest quote received minus the price awarded, only where more than one provider quoted) and trips still waiting for an invoice. Open to those who award, read all trips or check invoices. Outsourced trips are kept out of the vehicle cost reports, since the vehicle is not the organization's.
- **WhatsApp from Fleet OTG:** the same optional template send for the invoice request (`WHATSAPP_TRIP_INVOICE_TEMPLATE`), beside the quote one. Without the secrets the hand-off buttons work.
- **Pro copy:** one new line in the Pro plan's points. No price is stated or set.
- **Still not built:** the AI quote comparison and a provider sign-in. Both wait on the owner (docs/OWNER-CHECKLIST.md).
