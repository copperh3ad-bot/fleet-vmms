// "Schedule Cargo Pick-up and Delivery" (ADR-079 phase C, reshaped to the company's own Vehicle Request Form, ADR-079 amendment 2026-11-09): the form's boxes, asked one at a time, in the
// form's order: requesting department, the date and time the vehicle is needed, pick-up location, destination, vehicle type, the inventory or material load, the quantity with its unit,
// the person or persons to contact, and any special instructions. The request date is the day it is sent. It ends in createCargoRequest with the sender's own role; the fleet manager or
// Logistics accepts it in the app and may turn it into a trip.
import { can } from "@/lib/auth/can";
import { withTenant } from "@/lib/db/tenant";
import { createCargoRequest } from "@/lib/cargo/service";
import type { Flow } from "../types";
import { bad, good, parseDateTime, parseNumber, parseText, showDateTime } from "../text";
import { CARGO_SCREEN, formDateTime, optionOf, UNITS, VEHICLE_TYPES, WEIGHT_UNIT_KG } from "../forms";

const SAME = /^(1|yes|y|same|ok|okay|correct|mine)[.! ]*$/i;

export const cargoFlow: Flow = {
  id: "cargo",
  label: "Schedule Cargo Pick-up and Delivery",
  short: "Cargo Pick-up, Delivery",
  allowed: (driver, m) => withTenant(driver, m, (q) => can(q, m.role, "cargo.request")),
  steps: [
    {
      key: "department",
      ask: async (c) => {
        const own = (await withTenant(c.driver, c.m, async (q) => (await q.query<{ department: string | null }>("select department from employees where id = $1", [c.me.employeeId])).rows[0]?.department))?.trim() || null;
        c.answers._own_department = own;
        return own ? `Which department is this request for? Your record says ${own}. Reply 1 to use it, or type another department.` : "Which department is this request for?";
      },
      parse: async (raw, c) => {
        const own = c.answers._own_department as string | null | undefined;
        if (own && SAME.test(raw.trim())) return good(own);
        return parseText(raw, 2, 80, "the department");
      },
    },
    {
      key: "pickup_at",
      ask: async () => "When do you need the vehicle? Write the date and time, like 12/11/2026 9:00 or tomorrow 10am.",
      parse: async (raw, c) => parseDateTime(raw, c.now, { mustBeFuture: true }),
    },
    { key: "pickup_place", ask: async () => "Pick-up location (from): the address or place.", parse: async (raw) => parseText(raw, 2, 200, "the pick-up place") },
    { key: "drop_place", ask: async () => "Destination (to): the address or place.", parse: async (raw) => parseText(raw, 2, 200, "the destination") },
    { key: "vehicle_type", ask: async () => "Which type of vehicle is required? For example: 10-tonne truck, pickup, van.", parse: async (raw) => parseText(raw, 2, 60, "the type of vehicle") },
    { key: "description", ask: async () => "Inventory or material load details: what is being moved? For example: sacks of grain, sample fabric, spare parts.", parse: async (raw) => parseText(raw, 3, 300, "what is being moved") },
    { key: "quantity_text", ask: async () => "Quantity of the load, with its unit. For example: 18000 lbs (180 bags), 12 cartons, 300 kg.", parse: async (raw) => parseText(raw, 1, 120, "how much there is, with the unit") },
    {
      key: "weight_kg", optional: true,
      ask: async () => "Total weight of the load in kilograms, so the fleet office can pick a vehicle that can carry it. For example: 2500. Or reply SKIP.",
      parse: async (raw) => parseNumber(raw, { min: 0.1, max: 1_000_000, what: "the weight in kilograms" }),
    },
    {
      key: "poc_details",
      ask: async () => "Person or persons to contact, with phone numbers. For example: Ali 0300 1234567 / Sara 0321 7654321.",
      parse: async (raw) => {
        const r = parseText(raw, 5, 200, "who to contact and their phone number");
        return r.ok && !/\d{7,}/.test(r.value.replace(/[\s-]/g, "")) ? bad("Please include a phone number the driver can call.") : r;
      },
    },
    { key: "instructions", optional: true, ask: async () => "Any special instructions or requirements? Or reply SKIP.", parse: async (raw) => parseText(raw, 2, 500, "the instructions") },
  ],
  form: {
    env: "WHATSAPP_FORM_CARGO", screen: CARGO_SCREEN, cta: "Open form", body: "Tap the button to fill in the cargo request. It has dropdowns, so it takes a minute.",
    read: async (r, c) => {
      const dept = parseText(r.department ?? "", 2, 80, "the department");
      const when = formDateTime(r.date, r.time, c.now, "the vehicle needed on", true);
      const from = parseText(r.pickup ?? "", 2, 200, "the pick-up place");
      const to = parseText(r.drop ?? "", 2, 200, "the destination");
      const vehicle = optionOf(VEHICLE_TYPES, r.vehicle, "a vehicle type");
      const load = parseText(r.material ?? "", 3, 300, "what is being moved");
      const qty = parseNumber(r.quantity ?? "", { min: 0.01, max: 10_000_000, what: "the quantity" });
      // the weight: given directly, or worked out when the quantity is itself a weight (kg, lbs, tonnes); empty when neither
      const weightGiven = (r.weight ?? "").trim() ? parseNumber(r.weight!, { min: 0.1, max: 1_000_000, what: "the weight in kilograms" }) : good(null);
      const unit = optionOf(UNITS, r.unit, "a unit");
      const poc = parseText(r.contact ?? "", 5, 200, "who to contact and their phone number");
      const note = (r.instructions ?? "").trim() ? parseText(r.instructions!, 2, 500, "the instructions") : good(null);
      const bad1 = [dept, when, from, to, vehicle, load, qty, unit, poc, note, weightGiven].find((x) => !x.ok);
      if (bad1 && !bad1.ok) return { ok: false, error: bad1.error };
      if (!/\d{7,}/.test(String(poc.ok && poc.value).replace(/[\s-]/g, ""))) return { ok: false, error: "Please include a phone number the driver can call." };
      return { ok: true, answers: {
        department: dept.ok && dept.value, pickup_at: when.ok && when.value, pickup_place: from.ok && from.value, drop_place: to.ok && to.value, vehicle_type: vehicle.ok && vehicle.value.title,
        weight_kg: weightGiven.ok && weightGiven.value !== null ? weightGiven.value : unit.ok && qty.ok && WEIGHT_UNIT_KG[unit.value.id] ? Math.round(qty.value * WEIGHT_UNIT_KG[unit.value.id] * 10) / 10 : null,
        description: load.ok && load.value, quantity_text: `${qty.ok && qty.value} ${unit.ok && unit.value.title}`, poc_details: poc.ok && poc.value, instructions: note.ok ? note.value : null,
      } };
    },
  },
  summary: (a) => [
    "Cargo request:",
    `Department: ${a.department}`,
    `Vehicle needed: ${showDateTime(String(a.pickup_at))}. Type: ${a.vehicle_type}`,
    `From: ${a.pickup_place}`,
    `To: ${a.drop_place}`,
    `Load: ${a.description}, ${a.quantity_text}`,
    `Contact: ${a.poc_details}`,
    ...(a.weight_kg ? [`Weight: ${Number(a.weight_kg).toLocaleString("en-US")} kg`] : []),
    a.instructions ? `Instructions: ${a.instructions}` : "No special instructions",
  ].join("\n"),
  async submit(c) {
    const a = c.answers;
    const made = await createCargoRequest(c.driver, c.m, {
      department: a.department, pickup_at: a.pickup_at, pickup_place: a.pickup_place, drop_place: a.drop_place, vehicle_type: a.vehicle_type,
      description: a.description, quantity_text: a.quantity_text, weight_kg: a.weight_kg ?? "", poc_details: a.poc_details, instructions: a.instructions ?? "",
    }, "whatsapp");
    return `Done. Cargo request ${made.cargo_no} has been sent to the fleet office. They will confirm it with you. You can follow it in the app.`;
  },
};
