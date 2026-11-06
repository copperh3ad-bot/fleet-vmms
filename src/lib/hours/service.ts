// Engine hours for vehicles with an hour meter, mostly loaders and forklifts (ADR-048 phase 48b).
// Works like the odometer: every reading goes into engine_hour_readings, only accepted readings move vehicles.engine_hours, and
// vehicles.engine_hours is never written directly. A lower number, or more hours than the time elapsed allows, is refused at entry
// (the database flags it too, as a second guard).
import type { Driver, Queryable } from "@/lib/db/types";
import { authorizedAny, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";

const PERMS = ["vehicle.write", "trip.dispatch"];   // trip.dispatch: logistics looks after its own vehicles (dept_ok keeps it to those)
const MAX = 9_999_999;

export type HoursInfo = {
  tracks: boolean; hours: number | null; updated_at: string | null;
  readings: { read_at: string; reading_hours: number; source: string; status: string }[];
};

export function getHours(driver: Driver, m: Membership, vehicleId: string): Promise<HoursInfo | null> {
  return authorizedAny(driver, m, PERMS, async (q) => {
    const v = (await q.query<{ tracks_hours: boolean; engine_hours: string | null; engine_hours_updated_at: string | null }>(
      "select tracks_hours, engine_hours::text, engine_hours_updated_at::text from vehicles where id = $1 and dept_ok(id)", [vehicleId])).rows[0];
    if (!v) return null;
    const r = (await q.query<{ read_at: string; reading_hours: string; source: string; status: string }>(
      "select read_at::text, reading_hours::text, source, status from engine_hour_readings where vehicle_id = $1 order by read_at desc, created_at desc limit 8", [vehicleId])).rows;
    return { tracks: v.tracks_hours, hours: v.engine_hours === null ? null : Number(v.engine_hours), updated_at: v.engine_hours_updated_at,
      readings: r.map((x) => ({ ...x, reading_hours: Number(x.reading_hours) })) };
  });
}

export function setTracksHours(driver: Driver, m: Membership, vehicleId: string, on: boolean): Promise<void> {
  return authorizedAny(driver, m, PERMS, async (q) => {
    const r = await q.query("update vehicles set tracks_hours = $2 where id = $1 and status <> 'disposed' and dept_ok(id) returning id", [vehicleId, on]);
    if (r.rows.length === 0) throw new UserError("Vehicle not found.");
  });
}

/** The hours on file and when they were read, or null. Used to refuse a lower number on a form. */
export async function hoursOnFile(q: Queryable, vehicleId: string): Promise<{ hours: number; read_at: string } | null> {
  const r = (await q.query<{ h: string; t: string }>(
    "select reading_hours::text h, read_at::text t from engine_hour_readings where vehicle_id = $1 and status = 'accepted' order by read_at desc, created_at desc limit 1", [vehicleId])).rows[0];
  return r ? { hours: Number(r.h), read_at: r.t } : null;
}

/** Refuses a number below the reading on file, or above 24 hours for every day since it. Used by the hours form and by job cards. */
export async function assertHoursPlausible(q: Queryable, vehicleId: string, hours: number, field = "hours"): Promise<void> {
  const prev = await hoursOnFile(q, vehicleId);
  if (!prev) return;
  const shown = prev.hours.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (hours < prev.hours) throw new UserError(`The hour meter must be at least ${shown}, the reading on file.`, { [field]: `Must be at least ${shown}` });
  const days = Math.max((Date.now() - Date.parse(prev.read_at)) / 86_400_000, 1);
  if ((hours - prev.hours) / days > 24) throw new UserError(`That is more hours than the time since the last reading (${shown}) allows. Check the number.`, { [field]: "Too many hours" });
}

export function recordEngineHours(driver: Driver, m: Membership, vehicleId: string, raw: string): Promise<void> {
  const text = raw.trim();
  if (!/^\d+(\.\d)?$/.test(text)) return Promise.reject(new UserError("Enter the hour meter reading, for example 1250 or 1250.5.", { hours: "Enter a number" }));
  const hours = Number(text);
  if (hours > MAX) return Promise.reject(new UserError("That number is too large.", { hours: "Too large" }));
  return authorizedAny(driver, m, PERMS, async (q) => {
    const v = (await q.query<{ tracks_hours: boolean }>("select tracks_hours from vehicles where id = $1 and status <> 'disposed' and dept_ok(id)", [vehicleId])).rows[0];
    if (!v) throw new UserError("Vehicle not found.");
    if (!v.tracks_hours) throw new UserError("Switch on hour tracking for this vehicle first.");
    await assertHoursPlausible(q, vehicleId, hours);
    await q.query("insert into engine_hour_readings(vehicle_id, reading_hours, source, entered_by) values ($1, $2, $3, $4)",
      [vehicleId, hours, (await hoursOnFile(q, vehicleId)) ? "manual" : "baseline", m.userId]);
  });
}
