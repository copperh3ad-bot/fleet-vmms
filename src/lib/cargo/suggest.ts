// Suggests which vehicle could carry a cargo request (ADR-092, owner decision F). It only suggests: Logistics confirms and assigns by hand.
//   Suitable = in service, load capacity at least the cargo weight, load space at least the cargo volume when both are recorded, and not booked on an approved or started trip that overlaps the time window.
//   Location = where the vehicle's last finished trip ended; with no finished trip, its base location. Never live tracking.
//   Order = already at the pick-up place first, then the smallest vehicle that is big enough (so a big truck is not spent on a small load), then the plate.
import type { Queryable } from "@/lib/db/types";
import type { Driver } from "@/lib/db/types";
import type { Membership } from "@/lib/auth/can";
import { fleetAuthorized as authorized } from "@/lib/billing/fleet-ops";
import { UserError } from "@/lib/master/service";

export type Suggestion = {
  vehicle_id: string; registration_no: string; label: string; vehicle_class: string | null; capacity_kg: number; capacity_m3: number | null; seats: number | null;
  location: string | null; location_from: "last_trip" | "base" | null; at_pickup: boolean; class_match: boolean; reasons: string[];
};
export type CargoSuggestions = {
  weight_kg: number | null;
  volume_m3: number | null;
  window: { from: string; to: string };
  suggestions: Suggestion[];
  /** in-service vehicles that are free in the window but have no load capacity recorded, so they could not be judged */
  unknown_capacity: number;
  /** in-service vehicles that are big enough but booked in the window */
  busy: number;
  /** why there is nothing to show, in words; null when there are suggestions */
  message: string | null;
};

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** The same place written two ways ("Lahore" and "Lahore depot, Kot Lakhpat") counts as the same place when one contains the other. */
export const samePlace = (a: string | null | undefined, b: string | null | undefined) => {
  const x = norm(a), y = norm(b);
  return x !== "" && y !== "" && (x === y || x.includes(y) || y.includes(x));
};

/** The window a cargo request needs a vehicle for; with no delivery time, twelve hours from the pick-up, as the trip made from it will have. */
export const cargoWindow = (pickupAt: string, deliverBy: string | null) => ({
  from: new Date(pickupAt).toISOString(),
  to: deliverBy ? new Date(deliverBy).toISOString() : new Date(Date.parse(pickupAt) + 12 * 3600_000).toISOString(),
});

export async function suggestVehiclesIn(q: Queryable, cargoId: string): Promise<CargoSuggestions> {
  const c = (await q.query<{ weight_kg: string | null; volume_m3: string | null; pickup_place: string; pickup_at: string; deliver_by: string | null; vehicle_type: string | null }>(
    "select weight_kg::text, volume_m3::text, pickup_place, pickup_at::text, deliver_by::text, vehicle_type from cargo_requests where id = $1", [cargoId])).rows[0];
  if (!c) throw new UserError("Cargo request not found.");
  const window = cargoWindow(c.pickup_at, c.deliver_by);
  const weight = c.weight_kg === null ? null : Number(c.weight_kg);
  const volume = c.volume_m3 === null ? null : Number(c.volume_m3);
  const empty = (message: string): CargoSuggestions => ({ weight_kg: weight, volume_m3: volume, window, suggestions: [], unknown_capacity: 0, busy: 0, message });
  if (weight === null) return empty("Enter the weight of the load to get a suggestion.");

  const rows = (await q.query<{
    id: string; registration_no: string; label: string; vehicle_class: string | null; capacity: string | null; space: string | null; seats: number | null; base_location: string | null;
    booked: boolean; last_end: string | null;
  }>(
    `select v.id, v.registration_no, concat_ws(' ', v.make, v.model) as label, v.vehicle_class, v.load_capacity_kg::text as capacity, v.load_volume_m3::text as space, v.seats, v.base_location,
            exists (select 1 from trips t where t.vehicle_id = v.id and t.status in ('approved','started') and t.start_at < $2::timestamptz and t.end_at > $1::timestamptz) as booked,
            (select t.to_place from trips t where t.vehicle_id = v.id and t.status = 'completed' order by t.completed_at desc nulls last, t.end_at desc limit 1) as last_end
       from vehicles v where v.status = 'active' and dept_ok(v.id) order by v.registration_no`, [window.from, window.to])).rows;

  let unknown = 0, busy = 0;
  const wantedType = norm(c.vehicle_type);
  const out: Suggestion[] = [];
  for (const v of rows) {
    if (v.capacity === null) { if (!v.booked) unknown++; continue; }
    if (Number(v.capacity) < weight) continue;
    if (volume !== null && v.space !== null && Number(v.space) < volume) continue;      // too small in space; a vehicle with no space recorded is kept, with a note
    if (v.booked) { busy++; continue; }
    const location = v.last_end ?? v.base_location;
    const at_pickup = samePlace(location, c.pickup_place);
    const class_match = wantedType !== "" && v.vehicle_class !== null && (wantedType.includes(norm(v.vehicle_class)) || norm(v.vehicle_class).includes(wantedType));
    const reasons = [
      `carries ${Number(v.capacity).toLocaleString("en-US")} kg for a ${weight.toLocaleString("en-US")} kg load`,
      ...(volume !== null ? [v.space !== null ? `${Number(v.space).toLocaleString("en-US")} m3 of space for ${volume.toLocaleString("en-US")} m3` : "load space not recorded, check it fits"] : []),
      "free for the whole time needed",
      location ? (at_pickup ? `already at ${location}, the pick-up place` : `at ${location}${v.last_end ? " (where its last trip ended)" : " (its base)"}, not at the pick-up place`) : "location not recorded",
      ...(class_match ? [`a ${v.vehicle_class}, the kind asked for`] : []),
    ];
    out.push({ vehicle_id: v.id, registration_no: v.registration_no, label: v.label, vehicle_class: v.vehicle_class, capacity_kg: Number(v.capacity), capacity_m3: v.space === null ? null : Number(v.space), seats: v.seats,
      location, location_from: location ? (v.last_end ? "last_trip" : "base") : null, at_pickup, class_match, reasons });
  }
  out.sort((a, b) => Number(b.at_pickup) - Number(a.at_pickup) || Number(b.class_match) - Number(a.class_match) || a.capacity_kg - b.capacity_kg || a.registration_no.localeCompare(b.registration_no));

  const message = out.length > 0 ? null
    : busy > 0 ? `${busy} vehicle${busy === 1 ? " is" : "s are"} big enough but already booked for this time. Ask logistics providers for quotes instead.`
    : unknown > 0 ? `No vehicle with a recorded load capacity is free. ${unknown} free vehicle${unknown === 1 ? " has" : "s have"} no load capacity recorded; add it on the vehicle to include ${unknown === 1 ? "it" : "them"}.`
    : "No vehicle in the fleet can carry this load. Ask logistics providers for quotes.";
  return { weight_kg: weight, volume_m3: volume, window, suggestions: out, unknown_capacity: unknown, busy, message };
}

/** For Logistics and whoever handles cargo. Nothing is assigned here. */
export function suggestVehicles(driver: Driver, m: Membership, cargoId: string): Promise<CargoSuggestions> {
  return authorized(driver, m, "cargo.handle", (q) => suggestVehiclesIn(q, cargoId));
}
