// Compliance: documents (with renewals), accidents, challans, and their files. Every function checks the permission
// first (CLAUDE.md rule 3). Reminders are in reminders.ts and run from a script, not from the web.
import type { Driver, Queryable } from "@/lib/db/types";
import { accidentCover, type Cover } from "./cover";
import { authorized, authorizedAny, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";
import { deleteAttachment, listAttachments, saveAttachment, type AttachmentRow, type BlobStore, type EntityType } from "@/lib/jobcards/attachments";
import { accidentSchema, challanSchema, documentSchema, type AccidentInput, type ChallanInput, type DocumentInput } from "./schemas";
import type { z } from "zod";

const MANAGE = "compliance.manage";
const READ = [MANAGE, "report.view"];

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new UserError("Fix the highlighted fields.", fieldErrors(r.error));
  return r.data;
}

// ============================ Documents ============================

export type DocumentRow = {
  entity_type: "insurance_policy" | "compliance_doc"; entity_id: string; vehicle_id: string; registration_no: string; make: string | null; model: string | null; doc_type: string;
  reference: string | null; issued_by: string | null; expires_on: string; days_left: number; doc_status: "expired" | "due_30" | "due_90" | "ok";
};

export function listDocuments(driver: Driver, m: Membership, opts: { status?: string; type?: string; search?: string } = {}): Promise<DocumentRow[]> {
  return authorizedAny(driver, m, READ, async (q) => {
    const where: string[] = [], params: unknown[] = [];
    if (opts.status) { params.push(opts.status); where.push(`d.doc_status = $${params.length}`); }
    if (opts.type) { params.push(opts.type); where.push(`d.doc_type = $${params.length}`); }
    if (opts.search) { params.push(`%${opts.search.replace(/[%_\\]/g, "\\$&")}%`); where.push(`(v.registration_no ilike $${params.length} or d.reference ilike $${params.length})`); }
    return (await q.query<DocumentRow>(
      `select d.entity_type, d.entity_id, d.vehicle_id, v.registration_no, v.make, v.model, d.doc_type, d.reference, d.issued_by, d.expires_on::text, d.days_left::int, d.doc_status
         from v_documents_status d join vehicles v on v.id = d.vehicle_id
        where v.status in ('active','in_workshop') ${where.length ? "and " + where.join(" and ") : ""}
        order by d.expires_on, v.registration_no limit 500`, params)).rows;
  });
}

/** Active vehicles that have no current document of a type, for the "missing" view. */
export function listMissingDocuments(driver: Driver, m: Membership, types: string[]): Promise<{ vehicle_id: string; registration_no: string; doc_type: string }[]> {
  return authorizedAny(driver, m, READ, async (q) =>
    (await q.query<{ vehicle_id: string; registration_no: string; doc_type: string }>(
      `select v.id as vehicle_id, v.registration_no, t as doc_type
         from vehicles v cross join unnest($1::text[]) as t
        where v.status in ('active','in_workshop')
          and not exists (select 1 from v_documents_expiring e where e.vehicle_id = v.id and e.doc_type = t)
        order by v.registration_no, t`, [types])).rows);
}

/** Insurance goes to insurance_policies, everything else to compliance_docs. A renewal is simply a newer row. */
export async function addDocument(driver: Driver, m: Membership, input: DocumentInput): Promise<{ entity_type: "insurance_policy" | "compliance_doc"; id: string }> {
  const d = parse(documentSchema, input);
  return authorized(driver, m, MANAGE, async (q) => {
    const v = (await q.query("select 1 from vehicles where id = $1", [d.vehicle_id])).rows;
    if (v.length === 0) throw new UserError("Vehicle not found.", { vehicle_id: "Choose a vehicle" });
    if (d.doc_type === "insurance") {
      const id = (await q.query<{ id: string }>(
        "insert into insurance_policies(vehicle_id, insurer, policy_no, valid_from, valid_to, premium) values ($1, $2, $3, $4, $5, $6) returning id",
        [d.vehicle_id, d.issued_by, d.reference, d.valid_from, d.expires_on, d.amount ?? null])).rows[0].id;
      return { entity_type: "insurance_policy" as const, id };
    }
    const id = (await q.query<{ id: string }>(
      "insert into compliance_docs(vehicle_id, doc_type, reference, expires_on, valid_from, issued_by, cost) values ($1, $2, $3, $4, $5, $6, $7) returning id",
      [d.vehicle_id, d.doc_type, d.reference ?? null, d.expires_on, d.valid_from ?? null, d.issued_by ?? null, d.amount ?? null])).rows[0].id;
    return { entity_type: "compliance_doc" as const, id };
  });
}

export type DocumentDetail = {
  entity_type: "insurance_policy" | "compliance_doc"; id: string; vehicle_id: string; registration_no: string; doc_type: string; reference: string | null;
  issued_by: string | null; valid_from: string | null; expires_on: string; amount: string | null; current: boolean;
  history: { entity_type: string; id: string; reference: string | null; valid_from: string | null; expires_on: string }[];
};

export function getDocument(driver: Driver, m: Membership, entityType: string, id: string): Promise<DocumentDetail | null> {
  return authorizedAny(driver, m, READ, async (q) => {
    const one = entityType === "insurance_policy"
      ? (await q.query<Omit<DocumentDetail, "history" | "current">>(
          `select 'insurance_policy' as entity_type, p.id, p.vehicle_id, v.registration_no, 'insurance' as doc_type, p.policy_no as reference, p.insurer as issued_by,
                  p.valid_from::text, p.valid_to::text as expires_on, p.premium::text as amount
             from insurance_policies p join vehicles v on v.id = p.vehicle_id where p.id = $1`, [id])).rows[0]
      : entityType === "compliance_doc"
        ? (await q.query<Omit<DocumentDetail, "history" | "current">>(
            `select 'compliance_doc' as entity_type, d.id, d.vehicle_id, v.registration_no, d.doc_type, d.reference, d.issued_by, d.valid_from::text, d.expires_on::text, d.cost::text as amount
               from compliance_docs d join vehicles v on v.id = d.vehicle_id where d.id = $1`, [id])).rows[0]
        : undefined;
    if (!one) return null;
    const all = (await q.query<DocumentDetail["history"][number]>(
      `select 'insurance_policy' as entity_type, id, policy_no as reference, valid_from::text, valid_to::text as expires_on
         from insurance_policies where vehicle_id = $1 and $2 = 'insurance'
       union all
       select 'compliance_doc', id, reference, valid_from::text, expires_on::text from compliance_docs where vehicle_id = $1 and doc_type = $2
       order by 5 desc`, [one.vehicle_id, one.doc_type])).rows;
    return { ...one, current: all[0]?.id === one.id, history: all };
  });
}

// ============================ Accidents ============================

export type AccidentRow = {
  id: string; vehicle_id: string; registration_no: string; occurred_at: string; location: string | null; severity: string; fault: string | null;
  insurance_claim: boolean; claim_ref: string | null; driver_name: string | null; job_card_id: string | null; job_no: string | null; description: string;
  /** worked out in the database so pages need no clock */
  last_12_months: boolean; this_year: boolean;
  /** the company's accident rule (policy settings); null when the rule is off or the accident has no driver */
  cover: (Cover & { free: number }) | null;
};

/** Adds the company's accident rule to rows already read. Reads the driver's whole accident history, not just these rows. */
async function withCover(q: Queryable, rows: Omit<AccidentRow, "cover">[]): Promise<AccidentRow[]> {
  const set = new Map((await q.query<{ key: string; value: string }>("select key, value from settings where key in ('policy_free_accidents','policy_accident_gap_months')")).rows.map((r) => [r.key, Number(r.value)]));
  const free = set.get("policy_free_accidents") ?? 0;
  if (!(free > 0) || rows.length === 0) return rows.map((r) => ({ ...r, cover: null }));
  const history = (await q.query<{ id: string; employee_id: string | null; occurred_at: string }>("select id, employee_id, occurred_at::text from accidents where employee_id is not null")).rows;
  const cover = accidentCover(history, free, set.get("policy_accident_gap_months") ?? 12);
  return rows.map((r) => ({ ...r, cover: cover.has(r.id) ? { ...cover.get(r.id)!, free } : null }));
}

export function listAccidents(driver: Driver, m: Membership): Promise<AccidentRow[]> {
  return authorizedAny(driver, m, READ, async (q) =>
    withCover(q, (await q.query<Omit<AccidentRow, "cover">>(
      `select a.id, a.vehicle_id, v.registration_no, a.occurred_at::text, a.location, a.severity, a.fault, a.insurance_claim, a.claim_ref, e.full_name as driver_name,
              a.job_card_id, jc.job_no, a.description,
              (a.occurred_at >= now() - interval '1 year') as last_12_months, (extract(year from a.occurred_at) = extract(year from now())) as this_year
         from accidents a join vehicles v on v.id = a.vehicle_id left join employees e on e.id = a.employee_id left join job_cards jc on jc.id = a.job_card_id
        order by a.occurred_at desc limit 300`)).rows));
}

export function getAccident(driver: Driver, m: Membership, id: string): Promise<AccidentRow | null> {
  return authorizedAny(driver, m, READ, async (q) => {
    const row = (await q.query<Omit<AccidentRow, "cover">>(
      `select a.id, a.vehicle_id, v.registration_no, a.occurred_at::text, a.location, a.severity, a.fault, a.insurance_claim, a.claim_ref, e.full_name as driver_name,
              a.job_card_id, jc.job_no, a.description,
              (a.occurred_at >= now() - interval '1 year') as last_12_months, (extract(year from a.occurred_at) = extract(year from now())) as this_year
         from accidents a join vehicles v on v.id = a.vehicle_id left join employees e on e.id = a.employee_id left join job_cards jc on jc.id = a.job_card_id
        where a.id = $1`, [id])).rows[0];
    return row ? (await withCover(q, [row]))[0] : null;
  });
}

/** The driver defaults to whoever held the vehicle at that time (database trigger). */
export async function addAccident(driver: Driver, m: Membership, input: AccidentInput): Promise<string> {
  const a = parse(accidentSchema, input);
  return authorized(driver, m, MANAGE, async (q) => {
    if (a.job_card_id && (await q.query("select 1 from job_cards where id = $1 and vehicle_id = $2", [a.job_card_id, a.vehicle_id])).rows.length === 0)
      throw new UserError("That job card is not for this vehicle.", { job_card_id: "Not for this vehicle" });
    if (a.insurance_claim === false && a.claim_ref) throw new UserError("Tick 'insurance claim' to record a claim reference.", { claim_ref: "Tick insurance claim first" });
    try {
      return (await q.query<{ id: string }>(
        `insert into accidents(vehicle_id, employee_id, occurred_at, location, description, severity, fault, insurance_claim, claim_ref, job_card_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
        [a.vehicle_id, a.employee_id ?? null, a.occurred_at, a.location ?? null, a.description, a.severity, a.fault ?? null, a.insurance_claim, a.claim_ref ?? null, a.job_card_id ?? null])).rows[0].id;
    } catch (e) {
      if (e instanceof Error && /violates foreign key/.test(e.message)) throw new UserError("Choose a valid vehicle and driver.");
      throw e;
    }
  });
}

/** Who held the vehicle at that moment, from the custody record. Used to show the driver before an accident is saved. */
export function driverOnDate(driver: Driver, m: Membership, vehicleId: string, at: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(vehicleId) || Number.isNaN(Date.parse(at))) return Promise.resolve(null);
  return authorizedAny(driver, m, READ, async (q) =>
    (await q.query<{ full_name: string }>(
      `select e.full_name from vehicle_custody c join employees e on e.id = c.employee_id
        where c.vehicle_id = $1 and c.from_date <= $2::timestamptz::date and (c.to_date is null or c.to_date >= $2::timestamptz::date)
        order by c.from_date desc limit 1`, [vehicleId, at])).rows[0]?.full_name ?? null);
}

/** Attaches a repair job card that was raised from the accident screen. */
export function linkAccidentJobCard(driver: Driver, m: Membership, accidentId: string, jobCardId: string): Promise<void> {
  return authorized(driver, m, MANAGE, async (q) => {
    const r = await q.query("update accidents set job_card_id = $2 where id = $1 and job_card_id is null and exists (select 1 from job_cards j where j.id = $2 and j.vehicle_id = accidents.vehicle_id) returning id", [accidentId, jobCardId]);
    if (r.rows.length === 0) throw new UserError("Could not link that job card to the accident.");
  });
}

// ============================ Challans ============================

export type ChallanRow = {
  id: string; vehicle_id: string; registration_no: string; issued_on: string; reference: string | null; violation: string | null;
  amount: string; status: string; paid_on: string | null; driver_name: string | null;
};

export function listChallans(driver: Driver, m: Membership, opts: { status?: string } = {}): Promise<ChallanRow[]> {
  return authorizedAny(driver, m, READ, async (q) =>
    (await q.query<ChallanRow>(
      `select c.id, c.vehicle_id, v.registration_no, c.issued_on::text, c.reference, c.violation, c.amount::text, c.status, c.paid_on::text, e.full_name as driver_name
         from challans c join vehicles v on v.id = c.vehicle_id left join employees e on e.id = c.employee_id
        ${opts.status ? "where c.status = $1" : ""} order by c.issued_on desc, c.id limit 300`, opts.status ? [opts.status] : [])).rows);
}

export async function addChallan(driver: Driver, m: Membership, input: ChallanInput): Promise<string> {
  const c = parse(challanSchema, input);
  return authorized(driver, m, MANAGE, async (q) => {
    try {
      return (await q.query<{ id: string }>(
        "insert into challans(vehicle_id, employee_id, issued_on, reference, violation, amount) values ($1, $2, $3, $4, $5, $6) returning id",
        [c.vehicle_id, c.employee_id ?? null, c.issued_on, c.reference ?? null, c.violation ?? null, c.amount])).rows[0].id;
    } catch (e) {
      if (e instanceof Error && /violates foreign key/.test(e.message)) throw new UserError("Choose a valid vehicle and driver.");
      throw e;
    }
  });
}

export async function setChallanStatus(driver: Driver, m: Membership, id: string, status: "open" | "paid" | "disputed"): Promise<void> {
  if (!["open", "paid", "disputed"].includes(status)) throw new UserError("Unknown status.");
  return authorized(driver, m, MANAGE, async (q) => {
    const r = await q.query(
      `update challans set status = $2, paid_on = case when $2 = 'paid' then coalesce(paid_on, current_date) else null end where id = $1 returning id`, [id, status]);
    if (r.rows.length === 0) throw new UserError("Challan not found.");
  });
}

// ============================ Files ============================

const FILE_TYPES: EntityType[] = ["compliance_doc", "insurance_policy", "accident", "challan"];
const assertType = (t: string): EntityType => {
  if (!FILE_TYPES.includes(t as EntityType)) throw new UserError("Files cannot be attached to that.");
  return t as EntityType;
};
const TABLE: Record<string, string> = { compliance_doc: "compliance_docs", insurance_policy: "insurance_policies", accident: "accidents", challan: "challans" };

export async function addComplianceFile(driver: Driver, store: BlobStore, m: Membership, entityType: string, entityId: string, file: { name: string; bytes: Uint8Array }): Promise<void> {
  const type = assertType(entityType);
  return authorized(driver, m, MANAGE, async (q) => {
    if ((await q.query(`select 1 from ${TABLE[type]} where id = $1`, [entityId])).rows.length === 0) throw new UserError("Record not found.");
    await saveAttachment(q, store, m, type, entityId, file);
  });
}

export async function listComplianceFiles(driver: Driver, store: BlobStore, m: Membership, entityType: string, entityId: string): Promise<AttachmentRow[]> {
  const type = assertType(entityType);
  return authorizedAny(driver, m, READ, (q) => listAttachments(q, store, m, type, entityId));
}

export function removeComplianceFile(driver: Driver, store: BlobStore, m: Membership, attachmentId: string): Promise<void> {
  return authorized(driver, m, MANAGE, async (q) => {
    const row = (await q.query<{ entity_type: string }>("select entity_type from attachments where id = $1", [attachmentId])).rows[0];
    if (!row || !FILE_TYPES.includes(row.entity_type as EntityType)) throw new UserError("File not found.");   // job card files are removed by their requester only
    await deleteAttachment(q, store, m, attachmentId);
  });
}
