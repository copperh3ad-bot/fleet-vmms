// "Submit a Job Card" (ADR-079 phase B): the questions behind the app's new job card form, plus up to three photos. It ends in createJobCard with the sender's own role, as Requested,
// so approval, vehicle scope, licence and department rules are the app's. The AI free-text draft (ADR-061) is separate and stays as it is.
import { can } from "@/lib/auth/can";
import { withTenant } from "@/lib/db/tenant";
import { createJobCard } from "@/lib/jobcards/service";
import { UserError } from "@/lib/master/service";
import type { Flow } from "../types";
import { bad, good, listChoices, parseDate, parseNumber, parseText, pickChoice, showDate, type Choice } from "../text";
import { findVehicleByRegistration, heldVehicles } from "../vehicles";
import type { StoredPhoto } from "../photos";

// The kinds of work a job card by WhatsApp can be for (owner decision, 2026-11-09). Only "Others" is explained in words (up to 100). Each kind sets the job card's category and
// its reason; the fleet manager can change the reason when approving.
type Kind = Choice & { category: string; reason: string };
const KINDS: Kind[] = [
  { id: "periodic", label: "Periodic maintenance", category: "preventive", reason: "scheduled_service" },
  { id: "brakes", label: "Brake work", category: "corrective", reason: "wear_and_tear" },
  { id: "suspension", label: "Suspension work", category: "corrective", reason: "wear_and_tear" },
  { id: "battery", label: "Battery replacement", category: "corrective", reason: "wear_and_tear" },
  { id: "body", label: "Body work", category: "corrective", reason: "other" },
  { id: "lights", label: "Lights repair or replacement", category: "corrective", reason: "defect" },
  { id: "tyres", label: "Tyre replacement", category: "corrective", reason: "wear_and_tear" },
  { id: "alignment", label: "Wheel balancing and alignment", category: "corrective", reason: "wear_and_tear" },
  { id: "ac", label: "AC works", category: "corrective", reason: "defect" },
  { id: "others", label: "Others (explain the problem)", category: "corrective", reason: "other" },
];
const MAX_WORDS = 100;
const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const kindOf = (a: Record<string, unknown>) => KINDS.find((k) => k.id === (a.work as Choice | undefined)?.id);
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
  short: "Submit a Job Card",
  allowed: (driver, m) => withTenant(driver, m, (q) => can(q, m.role, "jobcard.create")),
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
        return found ? good(found, found.label) : bad("I could not find that vehicle among the ones you can raise a job card for. Please check the registration number.");
      },
    },
    { key: "work", choices: () => KINDS, ask: async () => `What kind of work is it?\n${listChoices(KINDS)}`, parse: pick(KINDS, "the kind of work") },
    {
      key: "what",
      skip: (c) => kindOf(c.answers)?.id !== "others",
      ask: async () => `Please explain the problem or the work needed, in up to ${MAX_WORDS} words.`,
      parse: async (raw) => {
        const r = parseText(raw, 10, 1500, "what is wrong or what is needed, in a sentence");
        if (!r.ok) return r;
        return wordCount(r.value) > MAX_WORDS ? bad(`That is ${wordCount(r.value)} words. Please keep it to ${MAX_WORDS} words or fewer.`) : r;
      },
    },
    {
      key: "km",
      ask: async (c) => `What does the odometer show on ${(c.answers.vehicle as Choice).label.split(" (")[0]} now? Send the kilometres.`,
      parse: async (raw) => parseNumber(raw, { min: 0, max: 5_000_000, what: "the odometer reading" }),
    },
    { key: "priority", choices: () => URGENCY, ask: async () => `How urgent is it?\n${listChoices(URGENCY)}`, parse: pick(URGENCY, "how urgent it is") },
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
      "Job card:", (a.vehicle as Choice).label, kindOf(a)?.id === "others" ? `Others: ${String(a.what)}` : (a.work as Choice).label,
      `Odometer: ${Number(a.km).toLocaleString("en-US")} km. Priority: ${(a.priority as Choice).label.split(":")[0]}.`,
      a.needed_by ? `Needed by ${showDate(String(a.needed_by))}` : null,
      photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"} attached.` : "No photos.",
    ].filter(Boolean).join("\n");
  },
  async submit(c) {
    const a = c.answers;
    const photos = (a.photos as StoredPhoto[] | null | undefined) ?? [];
    const kind = kindOf(a)!;
    const reason = (await withTenant(c.driver, c.m, async (q) =>
      (await q.query<{ id: string }>("select id from reason_codes where active and category = $1 order by code limit 1", [kind.reason])).rows[0]
        ?? (await q.query<{ id: string }>("select id from reason_codes where active order by (category = 'other') desc, code limit 1")).rows[0]));
    if (!reason) throw new UserError("this company has no reasons set up yet");
    const made = await createJobCard(c.driver, c.m, {
      vehicle_id: (a.vehicle as Choice).id, requested_by: c.me.employeeId, category: kind.category, reason_code_id: reason.id, cause_text: kind.id === "others" ? String(a.what) : `Requested work: ${kind.label}.`,
      priority: (a.priority as Choice).id, needed_by: a.needed_by ?? "", odometer_km: String(a.km),
    }, true);
    await withTenant(c.driver, c.m, async (q) => {
      await q.query("update job_cards set source = 'whatsapp' where id = $1", [made.id]);
      for (const f of photos) await q.query("insert into attachments(entity_type, entity_id, storage_path, file_name, mime_type, uploaded_by) values ('job_card', $1, $2, $3, $4, $5)", [made.id, f.path, f.name, f.mime, c.m.userId]);
    });
    return `Done. Job card ${made.job_no} has been raised for ${(a.vehicle as Choice).label.split(" (")[0]} and sent for approval. You can follow it in the app.`;
  },
};
