// Master data: vehicles, employees, vendors, custody, CSV import. Every function checks the permission first
// (CLAUDE.md rule 3) and reaches tenant data only through authorized() -> withTenant().
import { trialCapFor, trialFullMessage, trialRoomMessage } from "@/lib/billing/trial";
import type { Driver, Queryable } from "@/lib/db/types";
import { assertCan, authorized, authorizedAny, can, type Membership } from "@/lib/auth/can";
import {
  vehicleSchema, employeeSchema, vendorSchema, custodySchema, plateKey, fieldErrors,
  type VehicleInput, type EmployeeInput, type VendorInput,
} from "./schemas";
import { csvToObjects } from "./csv";
import { assertPhoneFree, phoneInOtherOrganization } from "@/lib/phone-owner";
import { normalizePhone } from "@/lib/phone";

/** A problem the user can fix. Its message is safe to show. */
export class UserError extends Error {
  constructor(message: string, public fields?: Record<string, string>) { super(message); }
}

const MAX_IMPORT_ROWS = 500;
const MAX_IMPORT_BYTES = 1_000_000;

/** Postgres rejections that mean "you typed something that clashes", turned into plain sentences. */
export function friendly(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("vehicles_reg_norm_uq") || msg.includes("vehicles_registration_no_key")) throw new UserError("A vehicle with this registration number already exists.", { registration_no: "Already registered" });
  if (msg.includes("employees_no_uq")) throw new UserError("Another employee already has this employee number.", { employee_no: "Already used" });
  if (msg.includes("employees_email") ) throw new UserError("Another employee already has this email.", { email: "Already used" });
  if (msg.includes("vendors_name_uq")) throw new UserError("A vendor with this name already exists.", { name: "Already exists" });
  const dept = msg.match(/(this vehicle belongs to another department|pool cars belong to the [A-Za-z ]+ department|this car is held by someone outside[^"]*|a pool car can only be held by[^"]*)/);
  if (dept) throw new UserError(dept[0].replace(/^./, (c) => c.toUpperCase()) + (dept[0].endsWith(".") ? "" : "."));
  if (msg.includes("vehicle_custody_one_open")) throw new UserError("This vehicle already has a current holder. Use change custody.");
  if (/violates check constraint|invalid input syntax|22023|employee already holds|new custody must start|employee is not active|no current holder|end date is before/.test(msg)) {
    const m = msg.match(/(employee already holds[^"]*|new custody must start[^"]*|employee is not active|vehicle has no current holder|end date is before[^"]*)/);
    throw new UserError(m ? m[0] : "One of the values is not allowed.");
  }
  // A required value the screen did not ask for or fill in: a plain message naming it, not a server error page. The activity log keeps the message, so the gap can still be found and closed.
  const empty = msg.match(/null value in column "(\w+)"/);
  if (empty) throw new UserError(`${empty[1].replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())} is needed to save this. Fill it in and try again.`);
  const plan = msg.match(/plan limit: (users|vehicles) \((\d+)\)/);
  if (plan) throw new UserError(`Your plan allows ${plan[2]} ${plan[1]}. Dispose of vehicles you no longer use, or ask for a bigger plan.`);
  throw e;
}

// ---------- Vehicles ----------

export type VehicleRow = {
  id: string; registration_no: string; make: string | null; model: string | null; year: number | null;
  vehicle_class: string | null; fuel_type: string | null; status: string; odometer_km: string;
  base_location: string | null; department: string | null; holder_id: string | null; holder_name: string | null; pm_worst: string | null;
};

/** Vehicles the member may see: everything, or (scope "own") only those whose current holder is their own employee record. */
export function listVehicles(driver: Driver, m: Membership, opts: { search?: string; status?: string } = {}): Promise<VehicleRow[]> {
  return authorized(driver, m, "vehicle.read", async (q) => {
    const where: string[] = ["dept_ok(v.id)"], params: unknown[] = [];
    if (m.vehicleScope === "own") { params.push(m.userId); where.push(`h.user_id = $${params.length}`); }
    if (opts.status) { params.push(opts.status); where.push(`v.status = $${params.length}`); }
    if (opts.search) {
      params.push(`%${opts.search.replace(/[%_\\]/g, "\\$&")}%`);
      where.push(`(v.registration_no ilike $${params.length} or v.make ilike $${params.length} or v.model ilike $${params.length} or h.full_name ilike $${params.length})`);
    }
    return (await q.query<VehicleRow>(
      `select v.id, v.registration_no, v.make, v.model, v.year, v.vehicle_class, v.fuel_type, v.status, v.odometer_km::text,
              v.base_location, v.department, h.id as holder_id, h.full_name as holder_name,
              (select case min(case p.pm_status when 'overdue' then 0 when 'due_soon' then 1 when 'no_history' then 2 when 'scheduled' then 3 else 4 end)
                       when 0 then 'overdue' when 1 then 'due_soon' when 2 then 'no_history' when 3 then 'scheduled' when 4 then 'ok' end
                 from v_pm_status p where p.vehicle_id = v.id) as pm_worst
         from vehicles v
         left join vehicle_custody c on c.vehicle_id = v.id and c.to_date is null
         left join employees h on h.id = c.employee_id
        ${where.length ? "where " + where.join(" and ") : ""}
        order by v.registration_no limit 500`, params)).rows;
  });
}

export type CustodyRow = { id: string; employee_id: string; full_name: string; from_date: string; to_date: string | null };
export type VehicleDetail = VehicleRow & { vin: string | null; engine_no: string | null; colour: string | null; custody: CustodyRow[]; pm: { label: string; status: string; due_on: string | null }[] };

export function getVehicle(driver: Driver, m: Membership, id: string): Promise<VehicleDetail | null> {
  return authorized(driver, m, "vehicle.read", async (q) => {
    const v = (await q.query<VehicleDetail>(
      `select v.*, v.odometer_km::text as odometer_km, h.id as holder_id, h.full_name as holder_name
         from vehicles v
         left join vehicle_custody c on c.vehicle_id = v.id and c.to_date is null
         left join employees h on h.id = c.employee_id
        where v.id = $1 and dept_ok(v.id) ${m.vehicleScope === "own" ? "and h.user_id = $2" : ""}`,
      m.vehicleScope === "own" ? [id, m.userId] : [id])).rows[0];
    if (!v) return null;
    v.custody = (await q.query<CustodyRow>(
      `select c.id, c.employee_id, e.full_name, c.from_date::text, c.to_date::text
         from vehicle_custody c join employees e on e.id = c.employee_id where c.vehicle_id = $1 order by c.from_date desc`, [id])).rows;
    v.pm = (await q.query<VehicleDetail["pm"][number]>("select label, pm_status as status, due_on::text from v_pm_status where vehicle_id = $1 order by label", [id])).rows;
    return v;
  });
}

function toDbVehicle(v: VehicleInput) {
  return JSON.stringify(Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== undefined && k !== "department" && k !== "load_volume_m3")));          // the department is set after the vehicle exists
}

/** The "Add a vehicle" save: one transaction through onboard_vehicle(). */
/** `afterCreate` runs inside the same transaction once the vehicle exists (the hand-over of a bought vehicle, ADR-091); if it throws, the vehicle is not saved. */
export async function addVehicle(driver: Driver, m: Membership, raw: unknown, opts: { afterCreate?: (q: Queryable, vehicleId: string, plate: string) => Promise<void> } = {}): Promise<{ id: string }> {
  const parsed = vehicleSchema.safeParse(raw);
  const trialCap = await trialCapFor(driver, m);                    // a free trial allows a small fleet (ADR-038); read before the transaction opens
  // Check the permission before revealing anything about the input.
  return authorized(driver, m, "vehicle.write", async (q) => {
    if (!parsed.success) throw new UserError("Fix the highlighted fields.", fieldErrors(parsed.error));
    if (trialCap !== null && (await countLiveVehicles(q)) >= trialCap) throw new UserError(trialFullMessage(trialCap));
    try {
      const r = await q.query<{ id: string }>("select onboard_vehicle($1::jsonb, $2::uuid) as id", [toDbVehicle(parsed.data), m.userId]);
      if (parsed.data.load_volume_m3) await q.query("update vehicles set load_volume_m3 = $2 where id = $1", [r.rows[0].id, parsed.data.load_volume_m3]);
      if (parsed.data.department) await setDepartmentIn(q, r.rows[0].id, parsed.data.department.replace(/\s+/g, " "));
      if (opts.afterCreate) await opts.afterCreate(q, r.rows[0].id, parsed.data.registration_no.trim().toUpperCase());
      return { id: r.rows[0].id };
    } catch (e) { friendly(e); }
  });
}

export function updateVehicleStatus(driver: Driver, m: Membership, id: string, status: string): Promise<void> {
  return authorized(driver, m, "vehicle.write", async (q) => {
    if (!["active", "in_workshop", "inactive", "disposed"].includes(status)) throw new UserError("Unknown status.");
    const r = await q.query("update vehicles set status = $2 where id = $1 returning id", [id, status]);
    if (r.rows.length === 0) throw new UserError("Vehicle not found.");
  });
}

/** Service types for the "last done" boxes on the Add a vehicle form. */
export function listServiceTypes(driver: Driver, m: Membership): Promise<{ key: string; label: string }[]> {
  return authorized(driver, m, "vehicle.write", async (q) => (await q.query<{ key: string; label: string }>(
    "select key, label from service_types order by label")).rows);
}

// ---------- Custody ----------

export function changeCustody(driver: Driver, m: Membership, raw: unknown): Promise<void> {
  return authorizedAny(driver, m, ["vehicle.write", "trip.dispatch"], async (q) => {
    const p = custodySchema.safeParse(raw);
    if (!p.success) throw new UserError("Choose a vehicle and a person.", fieldErrors(p.error));
    try { await q.query("select change_custody($1, $2, coalesce($3::date, current_date))", [p.data.vehicle_id, p.data.employee_id, p.data.from ?? null]); }
    catch (e) { friendly(e); }
  });
}

export function endCustody(driver: Driver, m: Membership, vehicleId: string, on?: string): Promise<void> {
  return authorizedAny(driver, m, ["vehicle.write", "trip.dispatch"], async (q) => {
    try { await q.query("select end_custody($1, coalesce($2::date, current_date))", [vehicleId, on ?? null]); }
    catch (e) { friendly(e); }
  });
}

// ---------- Employees ----------

export type EmployeeRow = { id: string; full_name: string; employee_no: string | null; department: string | null; email: string | null; phone: string | null; active: boolean; has_login: boolean; vehicles: number };

export function listEmployees(driver: Driver, m: Membership): Promise<EmployeeRow[]> {
  return authorized(driver, m, "employee.manage", async (q) => (await q.query<EmployeeRow>(
    `select e.id, e.full_name, e.employee_no, e.department, e.email, e.phone, e.active, (e.user_id is not null) as has_login,
            (select count(*)::int from vehicle_custody c where c.employee_id = e.id and c.to_date is null) as vehicles
       from employees e order by e.full_name`)).rows);
}

/** Names only, for the custodian picker on vehicle forms. Contact details stay behind employee.manage. */
export function listEmployeeOptions(driver: Driver, m: Membership): Promise<{ id: string; full_name: string; employee_no: string | null; department: string | null }[]> {
  return authorizedAny(driver, m, ["vehicle.write", "trip.dispatch"], async (q) => (await q.query<{ id: string; full_name: string; employee_no: string | null; department: string | null }>(
    "select id, full_name, employee_no, department from employees where active order by full_name")).rows);
}

export async function saveEmployee(driver: Driver, m: Membership, raw: unknown, id?: string): Promise<{ id: string }> {
  // One number belongs to one organization at a time (ADR-082). Checked after the permission, so a person without it learns nothing about other companies' numbers.
  const given = employeeSchema.safeParse(raw);
  if (given.success && given.data.phone && given.data.active !== false) {
    await authorized(driver, m, "employee.manage", async () => undefined);
    await assertPhoneFree(driver, m.tenantId, given.data.phone);
  }
  return authorized(driver, m, "employee.manage", async (q) => {
    const p = employeeSchema.safeParse(raw);
    if (!p.success) throw new UserError("Fix the highlighted fields.", fieldErrors(p.error));
    const e: EmployeeInput = p.data;
    try {
      if (id) {
        const r = await q.query<{ id: string }>(
          `update employees set full_name=$2, employee_no=$3, department=$4, email=$5, phone=$6, active=coalesce($7, active) where id=$1 returning id`,
          [id, e.full_name, e.employee_no ?? null, e.department ?? null, e.email ?? null, e.phone ?? null, e.active ?? null]);
        if (r.rows.length === 0) throw new UserError("Employee not found.");
        return { id };
      }
      const r = await q.query<{ id: string }>(
        `insert into employees(full_name, employee_no, department, email, phone) values ($1,$2,$3,$4,$5) returning id`,
        [e.full_name, e.employee_no ?? null, e.department ?? null, e.email ?? null, e.phone ?? null]);
      return { id: r.rows[0].id };
    } catch (err) { if (err instanceof UserError) throw err; friendly(err); }
  });
}

// ---------- Vendors ----------

export type VendorRow = { id: string; name: string; kind: string; categories: string[]; contact: string | null; phone: string | null; email: string | null; status: string };

export function listVendors(driver: Driver, m: Membership): Promise<VendorRow[]> {
  return authorized(driver, m, "vendor.manage", async (q) => (await q.query<VendorRow>(
    "select id, name, kind, categories, contact, phone, email, status from vendors order by name")).rows);
}

export function saveVendor(driver: Driver, m: Membership, raw: unknown, id?: string): Promise<{ id: string }> {
  return authorized(driver, m, "vendor.manage", async (q) => {
    const p = vendorSchema.safeParse(raw);
    if (!p.success) throw new UserError("Fix the highlighted fields.", fieldErrors(p.error));
    const v: VendorInput = p.data;
    try {
      if (id) {
        const r = await q.query<{ id: string }>(
          "update vendors set name=$2, categories=$3, contact=$4, phone=$5, email=$6, kind=$7 where id=$1 returning id",
          [id, v.name, v.categories ?? [], v.contact ?? null, v.phone ?? null, v.email ?? null, v.kind]);
        if (r.rows.length === 0) throw new UserError("Vendor not found.");
        return { id };
      }
      const r = await q.query<{ id: string }>(
        "insert into vendors(name, categories, contact, phone, email, kind) values ($1,$2,$3,$4,$5,$6) returning id",
        [v.name, v.categories ?? [], v.contact ?? null, v.phone ?? null, v.email ?? null, v.kind]);
      return { id: r.rows[0].id };
    } catch (err) { if (err instanceof UserError) throw err; friendly(err); }
  });
}

export function setVendorStatus(driver: Driver, m: Membership, id: string, status: "active" | "blocked"): Promise<void> {
  return authorized(driver, m, "vendor.manage", async (q) => {
    if (status !== "active" && status !== "blocked") throw new UserError("Unknown status.");
    const r = await q.query("update vendors set status=$2 where id=$1 returning id", [id, status]);
    if (r.rows.length === 0) throw new UserError("Vendor not found.");
  });
}

// ---------- Bulk CSV import (vehicles) ----------

export const VEHICLE_CSV_COLUMNS = [
  "registration_no", "make", "model", "year", "vehicle_class", "fuel_type", "vin", "engine_no", "colour", "base_location",
  "odometer_km", "employee_no", "holding_since", "last_oil_change", "last_oil_change_km", "department",
  // a person who does not exist yet: made, and invited, together with the vehicle they hold (the licence is asked for at joining if it is not given here)
  "employee_name", "employee_phone", "employee_email", "licence_no", "licence_class", "licence_expires_on",
] as const;
const NOT_VEHICLE_COLUMNS = ["employee_no", "last_oil_change", "last_oil_change_km", "department", "employee_name", "employee_phone", "employee_email", "licence_no", "licence_class", "licence_expires_on"];

/** A person the sheet creates: the holder of one or more vehicles who is not an employee yet. */
export type ImportPerson = { key: string; employee_no: string; full_name: string; phone: string; email: string | null; department: string | null; licence: { no: string; class: string | null; expires_on: string } | null; firstRow: number };
export type ImportRowResult = { row: number; plate: string; errors: string[]; input?: VehicleInput; /** the new person who holds this vehicle (key into the people list) */ personKey?: string; /** the operating department to set once the vehicle exists (ADR-048) */ department?: string };
export type ImportPreview = { /** the people the sheet creates, and how many of them can be invited (they have an email) */ people: { list: Pick<ImportPerson, "employee_no" | "full_name" | "email" | "phone">[]; invitable: number; linked: number }; /** the importer may invite people (user management) */ canInvite: boolean; total: number; ok: number; failed: number; unknownColumns: string[]; rows: ImportRowResult[]; /** set while a free trial limits the fleet: what is allowed and what is already there */ trial?: { cap: number; existing: number; room: number; note: string | null } };

/** Vehicles that count towards a limit: everything except those disposed of. */
async function countLiveVehicles(q: Queryable): Promise<number> {
  return (await q.query<{ c: number }>("select count(*)::int c from vehicles where status <> 'disposed'")).rows[0].c;
}

async function validateImport(q: Queryable, text: string, phoneTaken: (e164: string) => Promise<boolean> = async () => false): Promise<ImportPreview & { newPeople: ImportPerson[] }> {
  if (text.length > MAX_IMPORT_BYTES) throw new UserError("The file is larger than 1 MB. Split it into smaller files.");
  let parsed;
  try { parsed = csvToObjects(text); } catch (e) { throw new UserError((e as Error).message); }
  if (!parsed.headers.includes("registration_no")) throw new UserError('The first row must be column names, and one must be "registration_no".');
  if (parsed.rows.length === 0) throw new UserError("The file has column names but no vehicles.");
  if (parsed.rows.length > MAX_IMPORT_ROWS) throw new UserError(`The file has ${parsed.rows.length} rows. The limit is ${MAX_IMPORT_ROWS} per import.`);

  const known = new Set<string>(VEHICLE_CSV_COLUMNS);
  const existing = new Set((await q.query<{ registration_no: string }>("select registration_no from vehicles")).rows.map((r) => plateKey(r.registration_no)));
  const emps = new Map((await q.query<{ id: string; employee_no: string; active: boolean }>(
    "select id, employee_no, active from employees where employee_no is not null")).rows.map((e) => [e.employee_no.toLowerCase(), e]));
  const takenEmails = new Set((await q.query<{ email: string }>("select lower(email) as email from employees where email is not null")).rows.map((r) => r.email));
  const takenPhones = new Set((await q.query<{ phone: string }>("select phone from employees where phone is not null")).rows.map((r) => r.phone));
  const people = new Map<string, ImportPerson>();
  const emailOwner = new Map<string, string>(), phoneOwner = new Map<string, string>();
  const phoneCache = new Map<string, boolean>();
  let linked = 0;
  const oil = (await q.query("select 1 from service_types where key = 'oil_change'")).rows.length > 0;

  const seen = new Map<string, number>();
    const today = new Date().toISOString().slice(0, 10);
  /** Checks the person columns of one row; the first row of a person defines them, later rows must say the same. Returns the person's key. */
  const newPerson = async (values: Record<string, string>, line: number, errors: string[]): Promise<string | undefined> => {
    const no = values.employee_no.trim(), key = no.toLowerCase(), name = (values.employee_name ?? "").trim().replace(/\s+/g, " ");
    const email = (values.employee_email ?? "").trim().toLowerCase();
    const bad = (m: string) => errors.push(m);
    if (!/^[A-Za-z0-9][A-Za-z0-9._/ -]{0,29}$/.test(no)) bad("employee_no: use letters, numbers and - . / only (up to 30)");
    if (name.length < 2 || name.length > 120) bad("employee_name: enter the full name");
    const ph = normalizePhone(values.employee_phone ?? "");
    if (!ph.ok) bad(`employee_phone: ${ph.message}`);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad("employee_email: not a valid email");
    const lno = (values.licence_no ?? "").trim(), lexp = (values.licence_expires_on ?? "").trim();
    if (lno || lexp) {
      if (lno.length < 3) bad("licence_no: enter the licence number, or leave both licence columns empty (the person enters it when joining)");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(lexp)) bad("licence_expires_on: use the date as YYYY-MM-DD");
      else if (lexp < today) bad("licence_expires_on: that driving licence has expired. A valid licence is needed");
    }
    const first = people.get(key);
    if (first) {
      if (first.full_name.toLowerCase() !== name.toLowerCase() || (ph.ok && first.phone !== ph.e164)) bad(`employee_no "${no}": row ${first.firstRow} has other details for this number`);
      return errors.length ? undefined : key;
    }
    if (email) {
      if (takenEmails.has(email)) bad(`employee_email: another employee already has ${email}`);
      else if (emailOwner.has(email)) bad(`employee_email: ${email} is also on the person at row ${emailOwner.get(email)}`);
    }
    if (ph.ok) {
      if (takenPhones.has(ph.e164)) bad("employee_phone: another employee already has this number");
      else if (phoneOwner.has(ph.e164)) bad(`employee_phone: this number is also on the person at row ${phoneOwner.get(ph.e164)}`);
      else {
        if (!phoneCache.has(ph.e164)) phoneCache.set(ph.e164, await phoneTaken(ph.e164));
        if (phoneCache.get(ph.e164)) bad("employee_phone: this number is registered with another organization");
      }
    }
    if (errors.length) return undefined;
    const dep = (values.department ?? "").trim().replace(/\s+/g, " ");
    people.set(key, { key, employee_no: no, full_name: name, phone: ph.ok ? ph.e164 : "", email: email || null, department: dep || null, licence: lno ? { no: lno, class: (values.licence_class ?? "").trim() || null, expires_on: lexp } : null, firstRow: line });
    if (email) emailOwner.set(email, String(line));
    if (ph.ok) phoneOwner.set(ph.e164, String(line));
    return key;
  };
  const rows: ImportRowResult[] = [];
  for (const { line, values } of parsed.rows) {
    const errors: string[] = [];
    const plate = values.registration_no ?? "";
    const raw: Record<string, unknown> = {};
    for (const k of VEHICLE_CSV_COLUMNS) if (values[k] !== undefined && !NOT_VEHICLE_COLUMNS.includes(k)) raw[k] = values[k];
    let personKey: string | undefined;

    if (values.employee_no) {
      const e = emps.get(values.employee_no.toLowerCase());
      const name = (values.employee_name ?? "").trim();
      if (!e && !name) errors.push(`employee_no "${values.employee_no}": no employee has this number. To add the person, fill employee_name and employee_phone on this row`);
      else if (!e) personKey = await newPerson(values, line, errors);
      else if (!e.active) errors.push(`employee_no "${values.employee_no}": employee is not active`);
      else { raw.employee_id = e.id; linked++; }
    } else if ((values.employee_name ?? "").trim() || (values.employee_phone ?? "").trim()) errors.push("employee_no: fill the employee number of the person who holds this vehicle");
    if (values.last_oil_change) {
      if (!oil) errors.push("last_oil_change: this workspace has no oil change service type");
      else raw.baselines = [{ service_type_key: "oil_change", last_done_on: values.last_oil_change, last_odometer_km: values.last_oil_change_km || undefined }];
    }
    const department = (values.department ?? "").trim().replace(/\s+/g, " ");
    if (department.length > 60) errors.push("department: keep the name under 60 letters");
    const p = vehicleSchema.safeParse(raw);
    if (!p.success) for (const i of p.error.issues) errors.push(`${String(i.path[0] ?? "row").replace("baselines", "last_oil_change")}: ${i.message}`);

    if (plate) {
      const key = plateKey(plate);
      if (existing.has(key)) errors.push("registration_no: a vehicle with this plate already exists");
      const first = seen.get(key);
      if (first !== undefined) errors.push(`registration_no: same plate as row ${first} in this file`);
      else seen.set(key, line);
    }
    rows.push({ row: line, plate, errors, input: errors.length === 0 && p.success ? p.data : undefined, department: department || undefined, personKey: errors.length === 0 ? personKey : undefined });
  }
  const failed = rows.filter((r) => r.errors.length).length;
  const list = [...people.values()];
  return {
    total: rows.length, ok: rows.length - failed, failed, unknownColumns: parsed.headers.filter((h) => h && !known.has(h)), rows, newPeople: list,
    people: { list: list.map((x) => ({ employee_no: x.employee_no, full_name: x.full_name, email: x.email, phone: x.phone })), invitable: list.filter((x) => x.email).length, linked }, canInvite: false,
  };
}

/** Dry run: nothing is saved. Every row gets either "ok" or the reasons it would fail. */
export async function previewVehicleImport(driver: Driver, m: Membership, text: string): Promise<ImportPreview> {
  const trialCap = await trialCapFor(driver, m);
  return authorized(driver, m, "vehicle.write", async (q) => {
    const { newPeople: _people, ...pre } = await validateImport(q, text, (e164) => phoneInOtherOrganization(driver, m.tenantId, e164));
    pre.canInvite = await can(q, m.role, "admin.users");
    if (trialCap !== null) {
      const existing = await countLiveVehicles(q), room = Math.max(0, trialCap - existing);
      pre.trial = { cap: trialCap, existing, room, note: pre.ok > room ? trialRoomMessage(trialCap, existing, pre.ok) : null };
    }
    return pre;
  });
}

/** A person the import has just made, for whoever invites them. */
export type CreatedPerson = { id: string; employee_no: string; full_name: string; email: string | null; phone: string };
export type ImportCommitOptions = {
  /** Called inside the same transaction once the people and vehicles exist, so a problem (a plan limit, say) undoes the whole import. Only given when the importer chose to invite. */
  invite?: (q: Queryable, people: CreatedPerson[]) => Promise<void>;
};

/** All or nothing: if any row has an error, nothing is saved, so a half-loaded fleet never happens. People named on the sheet are made first, then the vehicles they hold. */
export async function commitVehicleImport(driver: Driver, m: Membership, text: string, opts: ImportCommitOptions = {}): Promise<{ imported: number; people: number }> {
  const trialCap = await trialCapFor(driver, m);
  return authorized(driver, m, "vehicle.write", async (q) => {
    const pre = await validateImport(q, text, (e164) => phoneInOtherOrganization(driver, m.tenantId, e164));
    if (trialCap !== null) {
      const existing = await countLiveVehicles(q);
      if (existing + pre.ok > trialCap) throw new UserError(trialRoomMessage(trialCap, existing, pre.ok));        // nothing is saved
    }
    if (pre.failed) throw new UserError(`${pre.failed} row(s) have errors. Fix them and upload again; nothing was imported.`);
    const made = new Map<string, CreatedPerson>();
    if (pre.newPeople.length) await assertCan(q, m.role, "employee.manage");
    for (const p of pre.newPeople) {
      try {
        const id = (await q.query<{ id: string }>("insert into employees(full_name, employee_no, department, email, phone) values ($1,$2,$3,$4,$5) returning id", [p.full_name, p.employee_no, p.department, p.email, p.phone])).rows[0].id;
        if (p.licence) await q.query("insert into driver_licences(employee_id, licence_no, licence_class, expires_on, licence_type) values ($1,$2,$3,$4,'full')", [id, p.licence.no, p.licence.class, p.licence.expires_on]);
        made.set(p.key, { id, employee_no: p.employee_no, full_name: p.full_name, email: p.email, phone: p.phone });
      } catch (e) { friendly(e); }
    }
    for (const r of pre.rows) {
      try {
        const input = r.personKey ? { ...r.input!, employee_id: made.get(r.personKey)!.id } : r.input!;
        const id = (await q.query<{ id: string }>("select onboard_vehicle($1::jsonb, $2::uuid) as id", [toDbVehicle(input), m.userId])).rows[0].id;
        if (r.department) await setDepartmentIn(q, id, r.department);
      } catch (e) { friendly(e); }
    }
    if (opts.invite && made.size) await opts.invite(q, [...made.values()]);
    return { imported: pre.rows.length, people: made.size };
  });
}

// ---------- Operating departments (ADR-048) ----------

/** The names of departments in use, for the vehicle form: those on vehicles, and those a role is tied to. */
export function listDepartments(driver: Driver, m: Membership): Promise<string[]> {
  return authorizedAny(driver, m, ["vehicle.read", "vehicle.write"], async (q) =>
    (await q.query<{ d: string }>(
      `select distinct on (lower(btrim(d))) btrim(d) as d from (select department as d from vehicles union all select department from role_departments) x
        where d is not null and btrim(d) <> '' order by lower(btrim(d)), btrim(d)`)).rows.map((r) => r.d));
}

/** What the vehicle can carry: weight in kilograms and space in cubic metres. Either may be left empty to clear it. Needs vehicle.write. */
export function setVehicleCapacity(driver: Driver, m: Membership, vehicleId: string, raw: { load_capacity_kg?: string; load_volume_m3?: string }): Promise<void> {
  const one = (v: string | undefined, label: string, max: number) => {
    const t = (v ?? "").replace(/,/g, "").trim();
    if (t === "") return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0 || n > max) throw new UserError(`Enter ${label}, above 0.`, { [label.includes("kilo") ? "load_capacity_kg" : "load_volume_m3"]: `Enter ${label}` });
    return n;
  };
  let kg: number | null, m3: number | null;
  try { kg = one(raw.load_capacity_kg, "the load capacity in kilograms", 1_000_000); m3 = one(raw.load_volume_m3, "the load space in cubic metres", 100_000); } catch (e) { return Promise.reject(e); }
  return authorized(driver, m, "vehicle.write", async (q) => {
    const r = await q.query("update vehicles set load_capacity_kg = $2, load_volume_m3 = $3 where id = $1 returning id", [vehicleId, kg, m3]);
    if (r.rows.length === 0) throw new UserError("Vehicle not found.");
  });
}

/** Sets or clears the operating department of one vehicle. Needs vehicle.write, so a department user (who has none) cannot move vehicles. */
export function setVehicleDepartment(driver: Driver, m: Membership, vehicleId: string, department: string): Promise<void> {
  const name = department.trim().replace(/\s+/g, " ");
  if (name.length > 60) return Promise.reject(new UserError("Keep the department name under 60 letters.", { department: "Too long" }));
  return authorized(driver, m, "vehicle.write", async (q) => {
    try { await setDepartmentIn(q, vehicleId, name); } catch (e) { friendly(e); }
  });
}

/** A name already in use keeps its spelling, so "logistics" and "Logistics" stay one department, in a form and in an import alike. */
async function setDepartmentIn(q: Queryable, vehicleId: string, name: string): Promise<void> {
  const known = name ? (await q.query<{ d: string }>("select d from (select department as d from vehicles union all select department from role_departments) x where lower(btrim(d)) = lower($1) limit 1", [name])).rows[0]?.d : undefined;
  const r = await q.query("update vehicles set department = $2 where id = $1 returning id", [vehicleId, known ?? (name || null)]);
  if (r.rows.length === 0) throw new UserError("Vehicle not found.");
}
