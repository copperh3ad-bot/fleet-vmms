// "Submit a Job Card" (ADR-079 phase B): the questions behind the app's new job card form, plus up to three photos. It ends in createJobCard with the sender's own role, as Requested,
// so approval, vehicle scope, licence and department rules are the app's. The AI free-text draft (ADR-061) is separate and stays as it is.
import { can } from "@/lib/auth/can";
import { withTenant } from "@/lib/db/tenant";
import { createJobCard } from "@/lib/jobcards/service";
import { REASON_CATEGORY } from "@/lib/labels";
import { UserError } from "@/lib/master/service";
import type { Flow } from "../types";
import { bad, good, listChoices, parseDate, parseNumber, parseText, pickChoice, showDate, type Choice } from "../text";
import { findVehicleByRegistration, heldVehicles } from "../vehicles";
import type { StoredPhoto } from "../photos";

const WORK: Choice[] = [
  { id: "corrective", label: "A repair (something is wrong)" },
  { id: "preventive", label: "A scheduled service" },
  { id: "accident", label: "Accident damage" },
  { id: "inspection", label: "An inspection" },
];
const CAUSES: Choice[] = Object.entries(REASON_CATEGORY).map(([id, label]) => ({ id, label }));
const URGENCY: Choice[] = [
  { id: "low", label: "Low: can wait" },
  { id: "normal", label: "Normal" },
  { id: "high", label: "High: needed soon" },
  { id: "urgent", label: "Urgent: the vehicle cannot be used" },
];
const pick = (list: Choice[], what: string) => async (raw: string) => pickChoice(raw, list, what);

export const jobCardFlow: Flow = {
  id: "jobcard",
  label: "Submit a Job Card",
  allowed: (driver, m) => withTenant(driver, m, (q) => can(q, m.role, "jobcard.create")),
  steps: [
    {
      key: "vehicle",
      ask: async (c) => {
        const list = await withTenant(c.driver, c.m, (q) => heldVehicles(q, c.me.employeeId));
        c.answers._vehicle_choices = list;
        return list.length ? `Which vehicle? Reply with a number, or type a registration number.\n${listChoices(list)}` : "Which vehicle? Type its registration number, for example LHR-1001.";
      },
      parse: async (raw, c) => {
        const list = (c.answers._vehicle_choices as Choice[] | undefined) ?? [];
        if (list.length && /^\d{1,2}$/.test(raw.trim())) return pickChoice(raw, list, "a vehicle");
        const found = await withTenant(c.driver, c.m, (q) => findVehicleByRegistration(q, c.me.employeeId, c.m.vehicleScope === "own", raw));
        return found ? good(found, found.label) : bad("I could not find that vehicle among the ones you can raise a job card for. Please check the registration number.");
      },
    },
    { key: "work", ask: async () => `What kind of job is it?\n${listChoices(WORK)}`, parse: pick(WORK, "the kind of job") },
    { key: "cause", ask: async () => `What is the main cause?\n${listChoices(CAUSES)}`, parse: pick(CAUSES, "the cause") },
    {
      key: "what",
      ask: async () => "Describe the problem or the work needed, for example: front left brake grinds when stopping.",
      parse: async (raw) => parseText(raw, 10, 1000, "what is wrong or what is needed, in a sentence"),
    },
    {
      key: "km",
      ask: async (c) => `What does the odometer show on ${(c.answers.vehicle as Choice).label.split(" (")[0]} now? Send the kilometres.`,
      parse: async (raw) => parseNumber(raw, { min: 0, max: 5_000_000, what: "the odometer reading" }),
    },
    { key: "priority", ask: async () => `How urgent is it?\n${listChoices(URGENCY)}`, parse: pick(URGENCY, "how urgent it is") },
    {
      key: "needed_by",
      optional: true,
      ask: async () => "By when is it needed? Write a date, like 15/11/2026, or SKIP.",
      parse: async (raw, c) => parseDate(raw, c.now, { notPast: true }),
    },
    {
      key: "photos",
      optional: true,
      photos: true,
      ask: async () => "Send up to 3 photos of the problem, one after another, then reply DONE. Or reply SKIP.",
      parse: async () => bad("Please send a photo, or reply DONE or SKIP."),
    },
  ],
  summary: (a) => {
    const photos = (a.photos as StoredPhoto[] | null | undefined) ?? [];
    return [
      "Job card:", (a.vehicle as Choice).label, `${(a.work as Choice).label}. Cause: ${(a.cause as Choice).label}.`, String(a.what),
      `Odometer: ${Number(a.km).toLocaleString("en-US")} km. Priority: ${(a.priority as Choice).label.split(":")[0]}.`,
      a.needed_by ? `Needed by ${showDate(String(a.needed_by))}` : null,
      photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"} attached.` : "No photos.",
    ].filter(Boolean).join("\n");
  },
  async submit(c) {
    const a = c.answers;
    const photos = (a.photos as StoredPhoto[] | null | undefined) ?? [];
    const reason = (await withTenant(c.driver, c.m, async (q) =>
      (await q.query<{ id: string }>("select id from reason_codes where active and category = $1 order by code limit 1", [(a.cause as Choice).id])).rows[0]
        ?? (await q.query<{ id: string }>("select id from reason_codes where active order by (category = 'other') desc, code limit 1")).rows[0]));
    if (!reason) throw new UserError("this company has no reasons set up yet");
    const made = await createJobCard(c.driver, c.m, {
      vehicle_id: (a.vehicle as Choice).id, requested_by: c.me.employeeId, category: (a.work as Choice).id, reason_code_id: reason.id, cause_text: a.what,
      priority: (a.priority as Choice).id, needed_by: a.needed_by ?? "", odometer_km: String(a.km),
    }, true);
    await withTenant(c.driver, c.m, async (q) => {
      await q.query("update job_cards set source = 'whatsapp' where id = $1", [made.id]);
      for (const f of photos) await q.query("insert into attachments(entity_type, entity_id, storage_path, file_name, mime_type, uploaded_by) values ('job_card', $1, $2, $3, $4, $5)", [made.id, f.path, f.name, f.mime, c.m.userId]);
    });
    return `Done. Job card ${made.job_no} has been raised for ${(a.vehicle as Choice).label.split(" (")[0]} and sent for approval. You can follow it in the app.`;
  },
};
