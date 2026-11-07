// Driving licences (ADR-044). One licence per employee, changed in place. The licence number is personal data: the full number is
// read only by people who manage employees or compliance, the expiring list shows only its last four characters, and the audit
// trail (see migration 0027) never keeps it whole.
import { z } from "zod";
import type { Driver } from "@/lib/db/types";
import type { Queryable } from "@/lib/db/types";
import { authorizedAny, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const text = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());

export type LicenceKind = "full" | "learner";

/** Whether this company accepts a learner's permit (setting `allow_learner_licence`, off unless the company switches it on). */
export async function learnerAllowed(q: Queryable): Promise<boolean> {
  return (await q.query<{ value: string }>("select value from settings where key = 'allow_learner_licence'")).rows[0]?.value === "1";
}

/**
 * The rules for a licence given when someone is invited or asks to join (ADR-054, ADR-055): it must not have expired, and a learner's permit counts only if the company accepts them.
 * Returns the box to mark and the words, or null when the licence is acceptable.
 */
export function licenceProblem(l: { type: string; expires_on: string }, allowLearner: boolean, today = new Date().toISOString().slice(0, 10)): { field: string; message: string } | null {
  if (l.type !== "full" && l.type !== "learner") return { field: "licence_type", message: "Choose the type of licence" };
  if (l.expires_on < today) return { field: "licence_expires_on", message: "That driving licence has expired. A valid licence is needed." };
  if (l.type === "learner" && !allowLearner) return { field: "licence_type", message: "This company accepts full driving licences only" };
  return null;
}

export const licenceSchema = z.object({
  licence_type: z.preprocess(blank, z.enum(["full", "learner"]).default("full")),
  licence_no: z.string().trim().min(3, "Enter the licence number").max(40),
  licence_class: text(40),
  issued_on: z.preprocess(blank, z.iso.date().optional()),
  expires_on: z.iso.date("Enter the expiry date"),
  emergency_contact_name: text(120),
  emergency_contact_phone: text(30),
}).superRefine((v, ctx) => {
  if (v.issued_on && v.expires_on < v.issued_on) ctx.addIssue({ code: "custom", path: ["expires_on"], message: "Expiry is before the issue date" });
});

/** Does this company accept learner's permits? Asked by the screens that offer the choice. */
export function getLearnerAllowed(driver: Driver, m: Membership): Promise<boolean> {
  return authorizedAny(driver, m, [...PERMS, "admin.users"], (q) => learnerAllowed(q));
}

/** Who may read or change a licence: those who manage employees, or compliance. */
const PERMS = ["employee.manage", "compliance.manage"];

export type Licence = {
  employee_id: string; licence_type: LicenceKind; licence_no: string; licence_class: string | null; issued_on: string | null; expires_on: string;
  emergency_contact_name: string | null; emergency_contact_phone: string | null;
};

/** "…1234": enough to tell two licences apart on a list, not enough to use. */
export const maskLicence = (no: string) => (no.length <= 4 ? "…" + no : "…" + no.slice(-4));

const COLS = `employee_id, licence_type, licence_no, licence_class, issued_on::text, expires_on::text, emergency_contact_name, emergency_contact_phone`;

/** Every saved licence with its full number, for the employees page. */
export function listLicences(driver: Driver, m: Membership): Promise<Licence[]> {
  return authorizedAny(driver, m, PERMS, async (q) => (await q.query<Licence>(`select ${COLS} from driver_licences`)).rows);
}

export function saveLicence(driver: Driver, m: Membership, employeeId: string, raw: unknown): Promise<void> {
  return authorizedAny(driver, m, PERMS, async (q) => {
    const p = licenceSchema.safeParse(raw);
    if (!p.success) throw new UserError("Fix the highlighted fields.", Object.fromEntries(p.error.issues.map((i) => [String(i.path[0] ?? "form"), i.message])));
    const l = p.data;
    const emp = await q.query("select 1 from employees where id = $1", [employeeId]);
    if (emp.rows.length === 0) throw new UserError("Employee not found.");
    await q.query(
      `insert into driver_licences(employee_id, licence_no, licence_class, issued_on, expires_on, emergency_contact_name, emergency_contact_phone, licence_type)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (employee_id) do update set licence_type = excluded.licence_type, licence_no = excluded.licence_no, licence_class = excluded.licence_class, issued_on = excluded.issued_on,
         expires_on = excluded.expires_on, emergency_contact_name = excluded.emergency_contact_name, emergency_contact_phone = excluded.emergency_contact_phone, updated_at = now()`,
      [employeeId, l.licence_no, l.licence_class ?? null, l.issued_on ?? null, l.expires_on, l.emergency_contact_name ?? null, l.emergency_contact_phone ?? null, l.licence_type]);
  });
}

export function removeLicence(driver: Driver, m: Membership, employeeId: string): Promise<void> {
  return authorizedAny(driver, m, PERMS, async (q) => { await q.query("delete from driver_licences where employee_id = $1", [employeeId]); });
}

export type ExpiringLicence = { employee_id: string; full_name: string; employee_no: string | null; licence_masked: string; licence_class: string | null; expires_on: string; days_left: number; status: "expired" | "due_30" | "due_90" };

/** Licences of active employees that have expired or expire within 90 days, soonest first. The number is masked. */
export function listExpiringLicences(driver: Driver, m: Membership): Promise<ExpiringLicence[]> {
  return authorizedAny(driver, m, PERMS, async (q) => {
    const rows = (await q.query<{ employee_id: string; full_name: string; employee_no: string | null; licence_no: string; licence_class: string | null; expires_on: string; days_left: number }>(
      `select l.employee_id, e.full_name, e.employee_no, l.licence_no, l.licence_class, l.expires_on::text, (l.expires_on - current_date)::int as days_left
         from driver_licences l join employees e on e.id = l.employee_id
        where e.active and l.expires_on <= current_date + 90 order by l.expires_on, e.full_name`)).rows;
    return rows.map((r) => ({
      employee_id: r.employee_id, full_name: r.full_name, employee_no: r.employee_no, licence_masked: maskLicence(r.licence_no), licence_class: r.licence_class,
      expires_on: r.expires_on, days_left: r.days_left, status: r.days_left < 0 ? "expired" : r.days_left <= 30 ? "due_30" : "due_90",
    }));
  });
}
