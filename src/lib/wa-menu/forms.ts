// WhatsApp forms for the menu (ADR-084): Meta's "Flows". One form with dropdowns and a date picker replaces a dozen questions and answers, so a request costs the sender about one
// message instead of ten. This file builds each form's Flow JSON (the file the owner uploads in WhatsApp Manager), and holds the option lists and the small readers the menu uses to
// turn a form's answers back into the same values the question-by-question chat produces. The form is only a nicer way to ask: every answer is checked again on our side, and the
// request is made by the same function, with the sender's own role, as before.
//
// Limits Meta sets and the tests enforce: a screen title up to 30 characters; a label up to 20; helper text up to 80; a dropdown option title up to 30; a footer label up to 35.
import { bad, good, parseDateTime, type Parsed } from "./text";

export type Option = { id: string; title: string };

export const VEHICLE_TYPES: Option[] = [
  { id: "pickup", title: "Pickup / small van" }, { id: "van", title: "Van" }, { id: "mini_truck", title: "Mini truck (to 3 tonnes)" }, { id: "truck", title: "Truck (to 10 tonnes)" },
  { id: "big_truck", title: "Truck (over 10 tonnes)" }, { id: "container", title: "Container / trailer" }, { id: "other", title: "Other (say in instructions)" },
];
export const UNITS: Option[] = [
  { id: "kg", title: "kg" }, { id: "lbs", title: "lbs" }, { id: "tonnes", title: "tonnes" }, { id: "cartons", title: "cartons" }, { id: "bags", title: "bags" },
  { id: "pieces", title: "pieces" }, { id: "pallets", title: "pallets" }, { id: "litres", title: "litres" },
  { id: "metres", title: "metres" }, { id: "feet", title: "feet" }, { id: "yards", title: "yards" },
];
/** Units that are a weight, with how many kilograms one is: a quantity in these gives the cargo weight without asking again (ADR-092). */
export const WEIGHT_UNIT_KG: Record<string, number> = { kg: 1, lbs: 0.45359237, tonnes: 1000 };
export const WORK_KINDS: Option[] = [
  { id: "periodic", title: "Periodic maintenance" }, { id: "brakes", title: "Brake work" }, { id: "suspension", title: "Suspension work" }, { id: "battery", title: "Battery replacement" },
  { id: "body", title: "Body work" }, { id: "lights", title: "Lights repair or replacement" }, { id: "tyres", title: "Tyre replacement" },
  { id: "alignment", title: "Wheel balancing and alignment" }, { id: "ac", title: "AC works" }, { id: "others", title: "Others (explain the problem)" },
];
export const URGENCIES: Option[] = [
  { id: "low", title: "Low: can wait" }, { id: "normal", title: "Normal" }, { id: "high", title: "High: needed soon" }, { id: "urgent", title: "Urgent: cannot be used" },
];
/** Half-hour times from 05:00 to 22:30: a dropdown, because a form has a date picker but no reliable time picker. */
export const TIMES: Option[] = Array.from({ length: 36 }, (_, i) => { const m = 5 * 60 + i * 30; const t = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; return { id: t, title: t }; });

// ---------------------------------------------------------------- building the Flow JSON
type Field = Record<string, unknown>;
export const text = (name: string, label: string, o: { required?: boolean; type?: "text" | "number" | "phone"; help?: string } = {}): Field =>
  ({ type: "TextInput", name, label, "input-type": o.type ?? "text", required: o.required ?? true, ...(o.help ? { "helper-text": o.help } : {}) });
export const area = (name: string, label: string, o: { required?: boolean; help?: string } = {}): Field => ({ type: "TextArea", name, label, required: o.required ?? false, ...(o.help ? { "helper-text": o.help } : {}) });
export const pick = (name: string, label: string, options: Option[], required = true): Field => ({ type: "Dropdown", name, label, required, "data-source": options });
export const day = (name: string, label: string, required = true, help?: string): Field => ({ type: "DatePicker", name, label, required, ...(help ? { "helper-text": help } : {}) });

const ref = (names: string[], from: "form" | "data") => Object.fromEntries(names.map((n) => [n, `\${${from}.${n}}`]));
const decl = (names: string[]) => Object.fromEntries(names.map((n) => [n, { type: "string", __example__: "example" }]));
const names = (fields: Field[]) => fields.map((f) => String(f.name));

type ScreenSpec = { id: string; title: string; fields: Field[]; button: string; carry?: string[] };

/** A form of one or more screens. Each screen but the last passes its answers to the next; the last sends everything. */
export function flowJson(specs: ScreenSpec[]) {
  const screens = specs.map((s, i) => {
    const last = i === specs.length - 1;
    const carried = specs.slice(0, i).flatMap((p) => names(p.fields));
    const footer = {
      type: "Footer", label: s.button,
      "on-click-action": last
        ? { name: "complete", payload: { ...ref(carried, "data"), ...ref(names(s.fields), "form") } }
        : { name: "navigate", next: { type: "screen", name: specs[i + 1].id }, payload: { ...ref(carried, "data"), ...ref(names(s.fields), "form") } },
    };
    return {
      id: s.id, title: s.title, ...(last ? { terminal: true, success: true } : {}), ...(carried.length ? { data: decl(carried) } : {}),
      layout: { type: "SingleColumnLayout", children: [{ type: "Form", name: "form", children: [...s.fields, footer] }] },
    };
  });
  return { version: "6.3", screens };
}

export const CARGO_SCREEN = "WHEN_WHERE";
export const cargoFormJson = () => flowJson([
  {
    id: CARGO_SCREEN, title: "Cargo request", button: "Next", fields: [
      text("department", "Department"), day("date", "Date needed"), pick("time", "Time needed", TIMES), text("pickup", "Pick-up location"), text("drop", "Destination"),
      pick("vehicle", "Vehicle type", VEHICLE_TYPES),
    ],
  },
  {
    id: "LOAD", title: "Load and contact", button: "Send request", fields: [
      text("material", "Material / load", { help: "What is being moved" }), text("quantity", "Quantity", { type: "number" }), pick("unit", "Unit", UNITS), text("weight", "Total weight in kg", { type: "number", required: false, help: "Optional if the unit above is kg, lbs or tonnes" }), text("volume", "Volume in cubic m", { type: "number", required: false, help: "Optional: length x width x height of the load, in metres" }),
      text("contact", "Contact and phone", { help: "Name and phone number, for example Ali 0300 1234567" }), area("instructions", "Instructions", { help: "Optional: anything the driver should know" }),
    ],
  },
]);

export const TRIP_SCREEN = "TRIP";
export const tripFormJson = () => flowJson([{
  id: TRIP_SCREEN, title: "Reserve a trip", button: "Send request", fields: [
    text("purpose", "Purpose", { help: "What the trip is for" }), text("from", "From"), text("to", "To"),
    day("start_date", "Leaves on"), pick("start_time", "Leaves at", TIMES), day("end_date", "Back on"), pick("end_time", "Back at", TIMES),
    text("passengers", "Passengers", { type: "number", required: false, help: "Optional" }),
  ],
}]);

export const JOBCARD_SCREEN = "JOB";
export const jobCardFormJson = () => flowJson([{
  id: JOBCARD_SCREEN, title: "Job card", button: "Next", fields: [
    text("vehicle", "Registration no.", { help: "For example LHR-1001" }), pick("work", "Kind of work", WORK_KINDS),
    area("explain", "Problem (Others)", { help: "Only for Others: explain in up to 100 words" }), text("km", "Odometer (km)", { type: "number" }),
    pick("urgency", "How urgent", URGENCIES), day("needed_by", "Needed by", false, "Optional"),
  ],
}]);

// ---------------------------------------------------------------- reading a form's answers
const byId = (list: Option[], id: string | undefined) => list.find((o) => o.id === id);
export const optionOf = (list: Option[], id: string | undefined, what: string): Parsed<Option> => { const o = byId(list, id); return o ? good(o) : bad(`Please choose ${what} in the form.`); };

/** A date from a form: "2026-11-12", or the day as milliseconds (some versions send that). Returns "YYYY-MM-DD". */
export function formDate(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{12,13}$/.test(s)) return new Date(Number(s) + 5 * 3600_000).toISOString().slice(0, 10);
  return null;
}
/** A date and a time from a form, as the same ISO time with the Pakistan offset the typed questions give. */
export function formDateTime(date: string | undefined, time: string | undefined, now: Date, what: string, mustBeFuture = true): Parsed<string> {
  const d = formDate(date);
  if (!d) return bad(`Please choose ${what} date in the form.`);
  if (!/^\d{2}:\d{2}$/.test((time ?? "").trim())) return bad(`Please choose ${what} time in the form.`);
  return parseDateTime(`${d} ${time!.trim()}`, now, { mustBeFuture });
}
