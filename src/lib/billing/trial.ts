// What a free trial allows (ADR-038). A trial lets a company try everything with a small fleet: up to 10 vehicles, the owner's number, changeable in Admin, Settings
// ("Vehicles allowed during a free trial"; empty means 10). It is checked on the server, for adding one vehicle and for importing a sheet, so the vehicle sheet
// cannot be used to get round it. It applies only while the trial runs; once the organization has subscribed, or is comped, only its plan's own limits apply.
import type { Driver } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";
import type { Membership } from "@/lib/auth/can";

export const DEFAULT_TRIAL_MAX_VEHICLES = 10;

/** The number of vehicles a free trial allows, from the owner's setting. */
export async function trialVehicleCap(driver: Driver): Promise<number> {
  const v = await withPlatform(driver, async (q) => (await q.query<{ value: string }>("select value from public.platform_settings where key = 'trial_max_vehicles'")).rows[0]?.value);
  const n = Number(v);
  return v !== undefined && v.trim() !== "" && Number.isInteger(n) && n >= 1 ? n : DEFAULT_TRIAL_MAX_VEHICLES;
}

/**
 * The cap that applies to this member's organization right now: the trial's, while its trial runs; null otherwise. Read BEFORE a tenant transaction is opened, because it
 * opens its own connection.
 */
export async function trialCapFor(driver: Driver, m: Membership): Promise<number | null> {
  return m.billing?.state === "trial" ? trialVehicleCap(driver) : null;
}

export const trialFullMessage = (cap: number) => `Your free trial includes up to ${cap} vehicles. Subscribe in Billing to add more.`;
export const trialRoomMessage = (cap: number, existing: number, adding: number) =>
  `Your free trial includes up to ${cap} vehicles and you already have ${existing}. This file has ${adding}. Upload only the first ${Math.max(0, cap - existing)}, or subscribe in Billing to add them all.`;
