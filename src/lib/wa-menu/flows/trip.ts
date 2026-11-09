// "Reserve a Trip" (ADR-079): the questions behind the app's trip request form. It ends in requestTrip with the sender's own role, so the module switch, the permission and
// every later approval are exactly the app's.
import { can } from "@/lib/auth/can";
import { withTenant } from "@/lib/db/tenant";
import { requestTrip, tripsOn } from "@/lib/trips/service";
import type { Flow } from "../types";
import { bad, good, listChoices, parseDateTime, parseNumber, parseText, pickChoice, showDateTime, type Choice } from "../text";
import { pickableVehicles } from "../vehicles";
import { formDateTime, TRIP_SCREEN } from "../forms";

export const tripFlow: Flow = {
  id: "trip",
  label: "Reserve a Trip",
  short: "Reserve a Trip",
  allowed: (driver, m) => withTenant(driver, m, async (q) => (await can(q, m.role, "trip.request")) && (await tripsOn(q))),
  steps: [
    { key: "purpose", ask: async () => "What is the trip for? For example: deliver samples to the Karachi office.", parse: async (raw) => parseText(raw, 3, 300, "what the trip is for") },
    { key: "from_place", ask: async () => "Where does it start?", parse: async (raw) => parseText(raw, 2, 120, "the starting place") },
    { key: "to_place", ask: async () => "Where is it going?", parse: async (raw) => parseText(raw, 2, 120, "the destination") },
    {
      key: "start_at",
      ask: async () => "When does it leave? Write the date and time, like 12/11/2026 8:30 or tomorrow 8am.",
      parse: async (raw, c) => parseDateTime(raw, c.now, { mustBeFuture: true }),
    },
    {
      key: "end_at",
      ask: async () => "When will the vehicle be back? Write the date and time.",
      parse: async (raw, c) => {
        const r = parseDateTime(raw, c.now, { mustBeFuture: true });
        if (r.ok && Date.parse(r.value) <= Date.parse(String(c.answers.start_at))) return bad("The return must be after the departure. Please send a later time.");
        return r;
      },
    },
    {
      key: "passengers",
      optional: true,
      ask: async () => "How many passengers? Send a number, or SKIP.",
      parse: async (raw) => parseNumber(raw, { min: 0, max: 200, integer: true, what: "the number of passengers" }),
    },
    {
      key: "vehicle",
      optional: true,
      choices: (c) => (c.answers._vehicle_choices as Choice[] | undefined) ?? null,
      ask: async (c) => {
        const list = await withTenant(c.driver, c.m, (q) => pickableVehicles(q, c.me.employeeId, c.m.vehicleScope === "own"));
        c.answers._vehicle_choices = list;
        return list.length ? `Do you prefer a vehicle? Reply with a number, or SKIP to let the fleet office choose.\n${listChoices(list)}` : "Do you prefer a vehicle? There is none to offer, so send SKIP.";
      },
      parse: async (raw, c) => {
        const list = (c.answers._vehicle_choices as Choice[] | undefined) ?? [];
        return list.length ? pickChoice(raw, list, "a vehicle") : bad("Please send SKIP.");
      },
    },
  ],
  form: {
    env: "WHATSAPP_FORM_TRIP", screen: TRIP_SCREEN, cta: "Open form", body: "Tap the button to fill in the trip request. It has dropdowns, so it takes a minute.",
    read: async (r, c) => {
      const purpose = parseText(r.purpose ?? "", 3, 300, "what the trip is for");
      const from = parseText(r.from ?? "", 2, 120, "the starting place");
      const to = parseText(r.to ?? "", 2, 120, "the destination");
      const start = formDateTime(r.start_date, r.start_time, c.now, "the departure");
      const end = formDateTime(r.end_date, r.end_time, c.now, "the return");
      const pax = (r.passengers ?? "").trim() ? parseNumber(r.passengers!, { min: 0, max: 200, integer: true, what: "the number of passengers" }) : good(null);
      const first = [purpose, from, to, start, end, pax].find((x) => !x.ok);
      if (first && !first.ok) return { ok: false, error: first.error };
      if (start.ok && end.ok && Date.parse(end.value) <= Date.parse(start.value)) return { ok: false, error: "The return must be after the departure." };
      return { ok: true, answers: { purpose: purpose.ok && purpose.value, from_place: from.ok && from.value, to_place: to.ok && to.value, start_at: start.ok && start.value, end_at: end.ok && end.value, passengers: pax.ok ? pax.value : null, vehicle: null } };
    },
  },
  summary: (a) => [
    "Trip request:", String(a.purpose),
    `${a.from_place} to ${a.to_place}`,
    `Leaves ${showDateTime(String(a.start_at))}, back ${showDateTime(String(a.end_at))}`,
    a.passengers !== null && a.passengers !== undefined ? `Passengers: ${a.passengers}` : null,
    a.vehicle ? `Preferred vehicle: ${(a.vehicle as Choice).label}` : "No preferred vehicle",
  ].filter(Boolean).join("\n"),
  async submit(c) {
    const a = c.answers;
    const id = await requestTrip(c.driver, c.m, {
      kind: "trip", purpose: a.purpose, from_place: a.from_place, to_place: a.to_place, start_at: a.start_at, end_at: a.end_at,
      passengers: a.passengers === null || a.passengers === undefined ? "" : String(a.passengers), preferred_vehicle_id: (a.vehicle as Choice | null)?.id ?? "",
    });
    const no = (await withTenant(c.driver, c.m, (q) => q.query<{ trip_no: string }>("select trip_no from trips where id = $1", [id]))).rows[0]?.trip_no;
    return `Done. Trip ${no ?? ""} has been requested and sent to the fleet office for approval. You can follow it in the app.`;
  },
};
