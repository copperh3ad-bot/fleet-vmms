# ADR-093: Depots and places, and the cargo weight on WhatsApp

Status: accepted 2026-11-11 (owner decision F5, and the WhatsApp gap left in ADR-092). Built, not deployed. Tenant migration 0060.

## Depots and places
- Each organization keeps its own list (`depots`: name, city, kind: depot, office, yard, port, workshop, site, other; on or off). It is managed from **Depots and places** in the Admin menu
  by the administrator, the fleet manager and Logistics (`depot.manage`). A name is unique ignoring case and spacing, per company.
- The list is **suggestions, not a foreign key**: the vehicle's base location, a cargo pick-up and destination, and a trip's from and to stay free text, offered with a drop-down of the
  active places. Renaming or switching off a depot therefore breaks nothing, and an unlisted place can still be typed. The vehicle count per depot matches a vehicle's base location by name
  (ignoring case and spacing).
- It is a step of the Get started walk-through ("Add your depots and places"), so it is asked during onboarding.
- The cargo vehicle suggestion (ADR-092) now compares places that are spelled the same way, which is what makes "where is this vehicle" dependable.

## Cargo weight on WhatsApp
- **Form (Flow):** the load screen has an optional *Total weight in kg* field. When it is empty and the quantity's unit is a weight (kg, lbs, tonnes) the weight is worked out from the
  quantity (lbs and tonnes converted, to one decimal). Other units (bags, cartons...) give no weight unless the field is filled. The Flow JSON in `docs/whatsapp-flows/cargo.json` is
  regenerated; **the owner must paste the new file into WhatsApp Manager and republish the cargo form** for the field to appear. Until then the form works as before and the
  weight comes only from the unit rule.
- **Text chat:** a new optional question after the quantity ("Total weight in kilograms... or SKIP"), shown in the summary.
- Invalid weights come back with the reason, as for the other answers.

## Not built
Importing depots from a spreadsheet; geocoding or distances between places; using a depot as a required choice.
