import { z } from "zod";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const text = (max = 200) => z.preprocess(blank, z.string().trim().max(max).optional());
const date = z.preprocess(blank, z.iso.date().optional());
const money = z.preprocess(blank, z.coerce.number().min(0).max(999_999_999).optional());

export const DOC_TYPES = ["insurance", "registration", "fitness", "token_tax", "route_permit", "other"] as const;
export const DOC_LABEL: Record<string, string> = {
  insurance: "Insurance", registration: "Registration", fitness: "Fitness certificate", token_tax: "Token tax", route_permit: "Route permit", other: "Other document",
};

/** A new document, or a renewal: the newest expiry per vehicle and type is the one that counts. */
export const documentSchema = z.object({
  vehicle_id: z.uuid("Choose a vehicle"),
  doc_type: z.enum(DOC_TYPES, "Choose the document type"),
  reference: text(80),
  issued_by: text(120),
  valid_from: date,
  expires_on: z.iso.date("Enter the expiry date"),
  amount: money,   // premium for insurance, cost for the others
}).superRefine((v, ctx) => {
  if (v.doc_type === "insurance") {
    if (!v.issued_by) ctx.addIssue({ code: "custom", path: ["issued_by"], message: "Enter the insurer" });
    if (!v.reference) ctx.addIssue({ code: "custom", path: ["reference"], message: "Enter the policy number" });
    if (!v.valid_from) ctx.addIssue({ code: "custom", path: ["valid_from"], message: "Enter the start date" });
  }
  if (v.valid_from && v.expires_on < v.valid_from) ctx.addIssue({ code: "custom", path: ["expires_on"], message: "Expiry is before the start date" });
});
/** Untrusted form values; the schema is what makes them safe. */
export type DocumentInput = Record<string, unknown>;

const today = () => new Date().toISOString().slice(0, 10);

export const accidentSchema = z.object({
  vehicle_id: z.uuid("Choose a vehicle"),
  employee_id: z.preprocess(blank, z.uuid().optional()),
  occurred_at: z.string().min(1, "Enter when it happened").refine((s) => !Number.isNaN(Date.parse(s)), "Enter a valid date and time")
    .refine((s) => Date.parse(s) <= Date.now() + 24 * 3600e3, "That is in the future"),
  location: text(200),
  description: z.string().trim().min(10, "Describe what happened, at least 10 characters").max(4000),
  severity: z.enum(["minor", "moderate", "major", "total_loss"], "Choose the severity"),
  fault: z.preprocess(blank, z.enum(["third_party", "our_driver", "shared", "unknown"]).optional()),
  insurance_claim: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  claim_ref: text(80),
  job_card_id: z.preprocess(blank, z.uuid().optional()),
});
export type AccidentInput = Record<string, unknown>;

export const challanSchema = z.object({
  vehicle_id: z.uuid("Choose a vehicle"),
  employee_id: z.preprocess(blank, z.uuid().optional()),
  issued_on: z.iso.date("Enter the date on the challan").refine((d) => d <= today(), "That date is in the future"),
  reference: text(80),
  violation: text(200),
  amount: z.coerce.number("Enter the amount").min(0, "Amount cannot be negative").max(999_999_999),
});
export type ChallanInput = Record<string, unknown>;
