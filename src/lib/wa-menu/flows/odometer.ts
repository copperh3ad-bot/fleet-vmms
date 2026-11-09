// "Submit Odometer Readings" (ADR-079): a person sends a reading on their own. It ends in recordOwnReading, the same table and checks as every other reading: a lower reading or an
// impossible jump is kept but flagged for the fleet office, and only accepted readings move the vehicle's odometer.
import { can } from "@/lib/auth/can";
import { withTenant } from "@/lib/db/tenant";
import { recordOwnReading } from "@/lib/odometer/service";
import type { Flow } from "../types";
import { bad, good, listChoices, parseNumber, pickChoice, type Choice } from "../text";
import { findVehicleByRegistration, heldVehicles } from "../vehicles";

const FLAG: Record<string, string> = { lower_than_previous: "it is lower than the last reading", implausible_jump: "it is a bigger jump than a vehicle could drive in that time" };

export const odometerFlow: Flow = {
  id: "odometer",
  label: "Submit Odometer Readings",
  short: "Submit Odometer Reading",
  allowed: (driver, m) => withTenant(driver, m, (q) => can(q, m.role, "odometer.submit")),
  steps: [
    {
      key: "vehicle",
      choices: (c) => (c.answers._vehicle_choices as Choice[] | undefined) ?? null,
      ask: async (c) => {
        const list = await withTenant(c.driver, c.m, (q) => heldVehicles(q, c.me.employeeId));
        c.answers._vehicle_choices = list;
        return list.length ? `Which vehicle? Reply with a number, or type a registration number.\n${listChoices(list)}` : "Which vehicle? Type its registration number, for example LHR-1001.";
      },
      parse: async (raw, c) => {
        const list = (c.answers._vehicle_choices as Choice[] | undefined) ?? [];
        if (list.length && /^\d{1,2}$/.test(raw.trim())) return pickChoice(raw, list, "a vehicle");
        const found = await withTenant(c.driver, c.m, (q) => findVehicleByRegistration(q, c.me.employeeId, c.m.vehicleScope === "own", raw));
        return found ? good(found, found.label) : bad("I could not find that vehicle among the ones you can send a reading for. Please check the registration number.");
      },
    },
    {
      key: "km",
      ask: async (c) => `What does the odometer show on ${(c.answers.vehicle as Choice).label.split(" (")[0]} now? Send the kilometres, for example 48320.`,
      parse: async (raw) => parseNumber(raw, { min: 0, max: 5_000_000, what: "the odometer reading" }),
    },
  ],
  summary: (a) => `Odometer reading:\n${(a.vehicle as Choice).label}\n${Number(a.km).toLocaleString("en-US")} km`,
  async submit(c) {
    const v = c.answers.vehicle as Choice;
    const r = await recordOwnReading(c.driver, c.m, v.id, Number(c.answers.km));
    const km = `${Number(c.answers.km).toLocaleString("en-US")} km`;
    if (r.status === "flagged") return `Recorded ${km} for ${r.registration_no}, but ${FLAG[r.flag_reason ?? ""] ?? "it needs a check"}${r.last_km ? ` (the last reading was ${Number(r.last_km).toLocaleString("en-US")} km)` : ""}, so the fleet office will review it before it counts.`;
    return `Done. ${km} recorded for ${r.registration_no}. Thank you.`;
  },
};
