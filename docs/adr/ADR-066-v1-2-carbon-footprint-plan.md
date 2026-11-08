# ADR-066: V1.2 plan, the carbon footprint of the fleet

Status: **proposed, plan only, nothing built** (2026-11-08). Owner direction: V1.2 calculates the carbon footprint of each vehicle from actual CO2 emissions reported each year through EPA testing; the reduction should let a company market its sustainability effort, and the reductions might be used to apply for carbon credits. Plan for the future; do not start without the owner's go. Decisions marked **OWNER** are open.

## What the product would do
1. **Per vehicle:** a CO2 figure in grams per kilometre (tailpipe), its source and its model year.
2. **Per period:** kilograms of CO2 = kilometres driven x that figure, per vehicle, department and company, monthly and yearly.
3. **Reduction:** compare a year with a chosen baseline year, as total and as intensity (g/km, kg per vehicle), so a reduction from replacing, retiring, right-sizing or changing fuel type is visible.
4. **Sustainability report:** a yearly document (PDF and CSV) with the method, data sources, assumptions and totals, which a company can attach to its own sustainability or ESG reporting.
5. **Credit readiness (later phase):** an evidence pack of the same data shaped for a carbon-credit adviser or verifier. Fleet OTG does not issue credits and does not promise any.

## What we already have, and what we lack
- Have: odometer readings every month per vehicle (the distance), vehicle make, model, year, class and fuel type, who held the vehicle and when, departments, retired vehicles, yearly budgets, exports.
- Lack: **fuel purchases** (ADR-044 chose not to record them), so a fuel-based figure is not available today. Distance x factor is the method that fits the data we hold. A fuel-log option could come later and would be more accurate.

## Where the factor comes from (in order of preference)
1. **EPA figure for the exact vehicle.** The US EPA publishes tested tailpipe CO2 in grams per mile for each model year (the data behind fueleconomy.gov, free to use as US government data). Match make, model, year and engine/transmission; convert to g/km; store the match (EPA vehicle id, model year, date fetched). Look it up once and keep it in our own table; no live call per page.
2. **Manufacturer-published figure** (for example WLTP) typed or imported by the administrator, with the document as evidence.
3. **Default by fuel type and class** (petrol, diesel, CNG, LPG; car, van, truck, loader), clearly marked "estimate", from a published emission-factor source chosen by the owner or an adviser.
4. **Electric and hybrid:** tailpipe is zero or low; an optional grid factor (entered by the owner for Pakistan, never built in, like every rate in this product) gives a full-cycle figure.

**Known gap:** many vehicles common in Pakistan (some pick-ups, local assemblies, older imports, heavy trucks, forklifts) are not in the EPA data. Expect a large share to fall to sources 2 or 3. The report must show how many vehicles use which source, so an estimate is never presented as a tested figure. **OWNER:** is "EPA figure where it exists, labelled fallback otherwise" acceptable, or must the feature be limited to vehicles with a tested figure?

## Honest limits
- **Self-reported odometer** drives the distance; the existing review of unusual readings protects it but does not make it audited data.
- **EPA figures are test-cycle values**, not measurements of each vehicle on Pakistani roads and fuel. They are a reasonable estimate, not an actual measurement; the pages and the report say so.
- **Carbon credits are a separate, demanding process.** Efficiency gains in a fleet usually have to follow an approved methodology, prove additionality, use a defined baseline, avoid double counting and be checked by an accredited third party before any credit is issued. Whether a company's fleet reductions qualify is a question for a carbon-credit adviser or the registry, not for this software. The product's promise is an accurate, transparent record; it makes **no claim that credits will be granted**. **OWNER:** engage an adviser before any marketing of credits.
- **Marketing claims:** a company's "we cut emissions by X" must be traceable to the report. Wording on the website and flyers stays at "calculate and track", not "offset" or "carbon neutral".

## Design sketch (for when it is built)
- Tenant migration (next free number at the time, now 0037): `vehicle_emission_profiles` (vehicle id, source `epa|manual|default|grid`, g/km, model year, EPA id, evidence note, entered by, date), `emission_settings` (baseline year, grid factor, reporting year start), a view `v_vehicle_emissions` (monthly km from odometer readings x the factor in force that month), audit trigger like every business table.
- A shared reference table for EPA data in the control plane (public, read-only to tenants), refreshed by a script when EPA publishes a new year; no tenant data in it.
- Permissions: `carbon.read`, `carbon.manage` (administrator and fleet manager by default). A page under `/w/<slug>/sustainability`, a vehicle tab, a yearly report export, a dashboard card.
- Gate: all tenant reads through `src/lib/db/tenant.ts`, every action checks `can()`, tests for the calculation with fixed readings, for each source, for baseline comparison and for the report totals.

## Phases
0. Decisions and a data audit: owner answers; take the live vehicle list and see what share an EPA match would cover.
1. Reference data and per-vehicle factor, with manual entry and defaults.
2. Monthly and yearly emissions per vehicle, department and company.
3. Baseline and reduction views; the sustainability report export.
4. Credit-readiness evidence pack, after an adviser confirms what a verifier needs.
5. Optional: fuel purchase log for an actual-fuel method; well-to-wheel factors.

## Plan and price
**OWNER:** which plan carries it (Basic, Pro, or a separate add-on) and at what price. The price lives in the plans table (CLAUDE.md rule 7) and appears on `/pricing` only (ADR-065). No price is set here.

## Not in V1.2
Live GPS emissions, per-trip emissions beyond recorded odometer distance, Scope 3, an offsetting marketplace, issuing or trading credits.

## Open questions for the owner
1. EPA-only, or EPA plus labelled fallbacks?
2. Which plan, and any price (not set here).
3. Is the first target the sustainability report, or credit readiness?
4. Who in the company sees it (administrator and fleet manager by default)?
5. The grid emission factor for electric vehicles, and the default fuel factors, are to be entered by the owner or an adviser, not built in.
