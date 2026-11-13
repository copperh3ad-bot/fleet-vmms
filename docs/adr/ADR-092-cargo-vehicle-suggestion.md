# ADR-092: Suggesting a vehicle for a cargo request

Status: accepted 2026-11-11 (owner decisions F1 to F4, docs/OWNER-DECISIONS-2026-11-11.md). Built, not deployed. Tenant migration 0059.

## Decision
- A cargo request carries a **weight in kilograms** (optional on the request form; Logistics can enter or correct it on the request while it is open and has no trip).
- For a person who handles cargo (Pro, `cargo.handle`), the request page shows **which vehicle?**: the system suggests, nothing is assigned (F1).
  - **Suitable (F2):** in service, load capacity at least the weight, and not on an approved or started trip that overlaps the time needed (pick-up to delivery; twelve hours from
    the pick-up when no delivery time was given). A vehicle with no load capacity recorded cannot be judged; the page says how many such vehicles were left out.
  - **Location (F3):** where the vehicle's last *completed* trip ended; with no completed trip, its base location. Never live tracking. "Same place" ignores case and punctuation
    and holds when one name contains the other ("Lahore" and "Gulberg warehouse, Lahore").
  - **Order:** already at the pick-up place first, then the kind of vehicle asked for (class named in the request), then the smallest that is big enough, then the plate.
    Each suggestion lists its reasons in words. The first five are shown.
- Logistics **confirms by hand**: "Make a trip with this vehicle" creates the trip request with that vehicle as the *preferred* vehicle. The trip is still approved by its approver, who
  assigns the vehicle and the driver. The cargo history records the vehicle chosen.
- **Nothing suitable (F4):** the page says why (too heavy for the fleet, or vehicles booked, or capacities missing) and offers "Make a trip and ask logistics providers": a trip request
  without a vehicle, where the existing quote flow (ADR-078) lets the user choose which providers to ask.

## Not built
F5 (depots and locations added during onboarding) is ADR-093. Suggestions are not
sent to WhatsApp. The weight on WhatsApp (form and chat) is ADR-093.

## Amendment (2026-11-13): volume

A cargo request may also carry its volume in cubic metres (`cargo_requests.volume_m3`, tenant migration 0064), and a vehicle may record its load space (`vehicles.load_volume_m3`, migration 0065). The suggestion drops a vehicle whose recorded space is smaller than the load's volume; a vehicle with no space recorded is still suggested, with the note "load space not recorded, check it fits", the same way a missing weight capacity is handled by the existing "no capacity recorded" count. The load capacity and space of an existing vehicle are set on the vehicle's page (Manage this vehicle), and at creation on the Add a vehicle form; the Excel import does not carry the space yet. The typed WhatsApp chat asks for the volume as an optional step after the weight, and the published WhatsApp form has the same box.
