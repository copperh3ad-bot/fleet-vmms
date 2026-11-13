import { z } from "zod";

/** Form fields arrive as strings; an empty box means "not given". */
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const text = (max = 120) => z.preprocess(blank, z.string().trim().max(max).optional());
const date = z.preprocess(blank, z.iso.date().optional());
const num = (min = 0) => z.preprocess(blank, z.coerce.number().min(min).max(99_999_999).optional());

/** What is kept for a detail the database requires but the person did not give. It can be corrected later on the vehicle. */
export const NOT_RECORDED = "Not recorded yet";

export const FUEL_TYPES = ["petrol", "diesel", "cng", "lpg", "hybrid", "electric"] as const;
export const VEHICLE_CLASSES = ["car", "pickup", "van", "truck", "bus", "motorcycle", "forklift", "other"] as const;

/** Plates are compared with case, spaces and hyphens removed, the same rule as the database index. */
export const plateKey = (s: string) => s.toUpperCase().replace(/[\s-]/g, "");

export const vehicleSchema = z.object({
  registration_no: z.string().trim().min(3, "Enter the registration number").max(20).regex(/^[A-Za-z0-9][A-Za-z0-9 -]*$/, "Letters, numbers, spaces and hyphens only"),
  make: text(), model: text(),
  year: z.preprocess(blank, z.coerce.number().int().min(1950).max(new Date().getFullYear() + 1).optional()),
  fuel_type: z.preprocess((v) => (typeof v === "string" ? blank(v.trim().toLowerCase()) : v), z.enum(FUEL_TYPES).optional()),
  vehicle_class: z.preprocess((v) => (typeof v === "string" ? blank(v.trim().toLowerCase()) : v), z.enum(VEHICLE_CLASSES).optional()),
  vin: text(40), engine_no: text(40), colour: text(40), base_location: text(),
  /** D2: seats and the load the vehicle may carry, used to match pool vehicles and cargo */
  seats: z.preprocess(blank, z.coerce.number().int().min(1, "At least 1 seat").max(200).optional()),
  load_capacity_kg: num(),
  load_volume_m3: z.preprocess(blank, z.coerce.number('Enter the volume in cubic metres').positive('Enter the volume in cubic metres').max(100_000).optional()),   // saved after the vehicle exists
  /** the operating department that runs the vehicle (ADR-048); saved after the vehicle, with one spelling per name */
  department: text(60),
  odometer_km: num(),
  employee_id: z.preprocess(blank, z.uuid().optional()),
  holding_since: date,
  baselines: z.array(z.object({
    service_type_key: z.string().trim().min(1),
    last_done_on: z.iso.date(),
    last_odometer_km: num(),
  })).optional(),
  insurance: z.object({
    insurer: z.string().trim().min(1), policy_no: z.preprocess(blank, z.string().trim().max(120).default(NOT_RECORDED)), valid_from: z.iso.date(), valid_to: z.iso.date(), premium: num(),
  }).refine((i) => i.valid_to >= i.valid_from, "Insurance end is before its start").optional(),
  documents: z.array(z.object({
    doc_type: z.string().trim().min(1), reference: text(), expires_on: z.iso.date(), issued_by: text(),
  })).optional(),
  budget_amount: num(),
  budget_from: date, budget_to: date,
}).refine((v) => v.budget_amount == null || (v.budget_from && v.budget_to && v.budget_to >= v.budget_from), {
  message: "A budget needs a start and an end date", path: ["budget_amount"],
});
export type VehicleInput = z.infer<typeof vehicleSchema>;

export const employeeSchema = z.object({
  full_name: z.string().trim().min(2, "Enter the full name").max(120),
  employee_no: text(40), department: text(), phone: text(30),
  email: z.preprocess(blank, z.email("Enter a valid email").optional()),
  active: z.boolean().optional(),
});
export type EmployeeInput = z.infer<typeof employeeSchema>;

export const vendorSchema = z.object({
  name: z.string().trim().min(2, "Enter the vendor name").max(120),
  kind: z.enum(["workshop", "logistics"]).default("workshop"),
  categories: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  contact: text(), phone: text(30),
  email: z.preprocess(blank, z.email("Enter a valid email").optional()),
});
export type VendorInput = z.infer<typeof vendorSchema>;

export const custodySchema = z.object({
  vehicle_id: z.uuid(),
  employee_id: z.uuid(),
  from: z.preprocess(blank, z.iso.date().optional()),
});

/** Field-by-field messages for a form: { registration_no: "Enter the registration number" }. */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[i.path.join(".") || "_"] ??= i.message;
  return out;
}
