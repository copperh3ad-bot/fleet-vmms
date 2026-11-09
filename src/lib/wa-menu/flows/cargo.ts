// "Schedule Cargo Pick-up and Delivery" (ADR-079 phase C): everything the fleet manager needs to act on a cargo request, asked one question at a time. It ends in createCargoRequest with the
// sender's own role; the fleet manager or Logistics accepts it in the app and may turn it into a trip.
import { can } from "@/lib/auth/can";
import { withTenant } from "@/lib/db/tenant";
import { createCargoRequest, HANDLING } from "@/lib/cargo/service";
import { normalizePhone } from "@/lib/phone";
import type { Flow } from "../types";
import { bad, good, listChoices, parseDateTime, parseText, pickChoice, showDateTime, type Choice } from "../text";

const HANDLE: Choice[] = [...Object.entries(HANDLING).map(([id, label]) => ({ id, label })), { id: "none", label: "None of these" }];
const phoneStep = (key: string, who: string) => ({
  key,
  ask: async () => `The ${who} contact's mobile number, for example 0300 1234567.`,
  parse: async (raw: string) => { const n = normalizePhone(raw); return n.ok ? good(n.e164, n.display) : bad("That does not look like a mobile number a message can reach. Please send it like 0300 1234567."); },
});

export const cargoFlow: Flow = {
  id: "cargo",
  label: "Schedule Cargo Pick-up and Delivery",
  short: "Cargo Pick-up, Delivery",
  allowed: (driver, m) => withTenant(driver, m, (q) => can(q, m.role, "cargo.request")),
  steps: [
    { key: "description", ask: async () => "What needs to be moved? For example: boxes of sample fabric.", parse: async (raw) => parseText(raw, 3, 300, "what needs to be moved") },
    { key: "quantity_text", ask: async () => "How much? For example: 12 cartons, about 300 kg.", parse: async (raw) => parseText(raw, 1, 120, "how much there is") },
    { key: "pickup_place", ask: async () => "Where should it be collected? The address or place.", parse: async (raw) => parseText(raw, 2, 200, "the pick-up place") },
    { key: "pickup_contact", ask: async () => "Who is the contact person at the pick-up?", parse: async (raw) => parseText(raw, 2, 100, "the contact person's name") },
    phoneStep("pickup_phone", "pick-up"),
    {
      key: "pickup_at",
      ask: async () => "When should it be collected? Write the date and time, like 12/11/2026 9:00 or tomorrow 10am.",
      parse: async (raw, c) => parseDateTime(raw, c.now, { mustBeFuture: true }),
    },
    { key: "drop_place", ask: async () => "Where should it be delivered? The address or place.", parse: async (raw) => parseText(raw, 2, 200, "the delivery place") },
    { key: "drop_contact", ask: async () => "Who is the contact person at the delivery?", parse: async (raw) => parseText(raw, 2, 100, "the contact person's name") },
    phoneStep("drop_phone", "delivery"),
    {
      key: "deliver_by",
      ask: async () => "By when must it be delivered? Write the date and time.",
      parse: async (raw, c) => {
        const r = parseDateTime(raw, c.now, { mustBeFuture: true });
        if (r.ok && Date.parse(r.value) <= Date.parse(String(c.answers.pickup_at))) return bad("Delivery must be after the pick-up. Please send a later time.");
        return r;
      },
    },
    {
      key: "handling",
      optional: true,
      choices: () => HANDLE,
      ask: async () => `Does it need special handling? Reply with a number, or SKIP.\n${listChoices(HANDLE)}`,
      parse: async (raw) => { const r = pickChoice(raw, HANDLE, "the handling"); return r.ok && r.value.id === "none" ? good(null) : r; },
    },
    { key: "department", optional: true, ask: async () => "Which department or cost centre is it for? Or reply SKIP.", parse: async (raw) => parseText(raw, 2, 80, "the department") },
  ],
  summary: (a) => [
    "Cargo request:", `${a.description} (${a.quantity_text})`,
    `Collect: ${a.pickup_place}, ${showDateTime(String(a.pickup_at))}. Contact: ${a.pickup_contact}, ${a.pickup_phone}`,
    `Deliver: ${a.drop_place}, by ${showDateTime(String(a.deliver_by))}. Contact: ${a.drop_contact}, ${a.drop_phone}`,
    a.handling ? `Handling: ${(a.handling as Choice).label}` : "No special handling",
    a.department ? `For: ${a.department}` : null,
  ].filter(Boolean).join("\n"),
  async submit(c) {
    const a = c.answers;
    const made = await createCargoRequest(c.driver, c.m, {
      description: a.description, quantity_text: a.quantity_text, pickup_place: a.pickup_place, pickup_contact: a.pickup_contact, pickup_phone: a.pickup_phone, pickup_at: a.pickup_at,
      drop_place: a.drop_place, drop_contact: a.drop_contact, drop_phone: a.drop_phone, deliver_by: a.deliver_by,
      handling: (a.handling as Choice | null)?.label ?? "", department: a.department ?? "",
    }, "whatsapp");
    return `Done. Cargo request ${made.cargo_no} has been sent to the fleet office. They will confirm it with you. You can follow it in the app.`;
  },
};
