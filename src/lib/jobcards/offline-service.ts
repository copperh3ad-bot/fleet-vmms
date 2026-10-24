// The offline job card form (ADR-022) joined to the workspace: what the blank form offers a member (only the vehicles and
// reasons they may use), and what happens to a filled one. A filled form becomes a DRAFT job card made by the same function
// the on-screen form uses, so the permission, the vehicle scope and every rule are checked there, not here. Nothing is
// submitted for approval from a file; the person opens the draft, adds photos if they want, and submits it.
import type { Driver } from "@/lib/db/types";
import type { Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { listVehicles } from "@/lib/master/service";
import { createJobCard, listReasonCodes } from "./service";
import { readJobCardForm, type FormContext, type FormProblem } from "./offline-form";

export async function loadFormContext(driver: Driver, m: Membership): Promise<FormContext> {
  const [vehicles, reasons] = await Promise.all([listVehicles(driver, m), listReasonCodes(driver, m)]);
  return {
    company: m.tenantName ?? "",
    vehicles: vehicles.filter((v) => v.status !== "disposed" && v.status !== "inactive").map((v) => ({ id: v.id, registration_no: v.registration_no, make: v.make, model: v.model })),
    reasons: reasons.map((r) => ({ id: r.id, category: r.category, label: r.label })),
  };
}

export type ImportResult = { file: string; ok: boolean; jobNo?: string; jobId?: string; problems: FormProblem[] };

/** Field names the job card schema uses, as the form's own labels, so a refusal reads the way the form does. */
const LABEL: Record<string, string> = {
  vehicle_id: "Vehicle", category: "Type of job", reason_code_id: "Reason", cause_text: "What went wrong", description: "More detail",
  priority: "Priority", needed_by: "Needed by", odometer_km: "Odometer",
};

export async function importFilledForm(driver: Driver, m: Membership, ctx: FormContext, file: { name: string; bytes: Uint8Array }): Promise<ImportResult> {
  const read = await readJobCardForm(file.bytes, ctx);
  if (read.problems.length) return { file: file.name, ok: false, problems: read.problems };
  try {
    const made = await createJobCard(driver, m, read.input, false);
    return { file: file.name, ok: true, jobNo: made.job_no, jobId: made.id, problems: [] };
  } catch (e) {
    if (e instanceof UserError) {
      const fields = Object.entries(e.fields ?? {}).map(([k, message]) => ({ field: LABEL[k] ?? (k.startsWith("lines") ? "A line" : k), message }));
      return { file: file.name, ok: false, problems: fields.length ? fields : [{ field: "file", message: e.message }] };
    }
    throw e;
  }
}
