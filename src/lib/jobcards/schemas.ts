import { z } from "zod";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const num = (min = 0) => z.preprocess(blank, z.coerce.number().min(min).max(99_999_999).optional());

export const CATEGORIES = ["corrective", "preventive", "accident", "inspection"] as const;
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const LINE_KINDS = ["part", "labour", "service", "other"] as const;

export const lineSchema = z.object({
  kind: z.enum(LINE_KINDS).default("service"),
  description: z.string().trim().min(1, "Describe the line").max(200),
  qty: z.preprocess(blank, z.coerce.number().gt(0, "Quantity must be above 0").max(1_000_000).default(1)),
  unit_cost: z.preprocess(blank, z.coerce.number().min(0, "Cost cannot be negative").max(99_999_999).default(0)),
  service_type_key: z.preprocess(blank, z.string().trim().max(60).optional()),
});

export const jobCardSchema = z.object({
  vehicle_id: z.uuid("Choose a vehicle"),
  requested_by: z.preprocess(blank, z.uuid().optional()),
  category: z.enum(CATEGORIES).default("corrective"),
  reason_code_id: z.uuid("Choose a reason"),
  cause_text: z.string().trim().min(10, "Say what went wrong, at least 10 characters").max(2000),
  description: z.preprocess(blank, z.string().trim().max(4000).optional()),
  priority: z.enum(PRIORITIES).default("normal"),
  needed_by: z.preprocess(blank, z.iso.date().optional()),
  odometer_km: num(),
  engine_hours: z.preprocess(blank, z.coerce.number().min(0).max(9_999_999).optional()),
  lines: z.array(lineSchema).max(50).default([]),
});
/** Untrusted form values; jobCardSchema is what makes them safe. */
export type JobCardInput = Record<string, unknown>;
export type JobCardData = z.output<typeof jobCardSchema>;

/** Targets a person can ask for through the screens, and the one permission each needs. Phase 4 adds the vendor steps. */
export const TRANSITION_PERMISSION: Record<string, string> = {
  submitted: "jobcard.create",
  cancelled: "jobcard.create",
  approved: "jobcard.approve",
  rejected: "jobcard.approve",
  returned_for_edit: "jobcard.approve",
  vendor_assigned: "jobcard.assign_vendor",
  closed: "invoice.verify",   // after the invoice is verified
  // quotation_received, quotation_approved, in_progress, completed, invoiced and invoice_verified are not asked for
  // directly: they happen inside submit_quotation, approve_quotation, vendor_*_work, submit_invoice and verify_invoice.
};

/** Who can pay for repeat work (ADR-094). Shared by the server and the review form. */
export const REPEAT_PAYERS: Record<string, string> = { company: "The company", workshop: "The workshop, under its guarantee", driver: "The driver" };
