// Monthly odometer collection, admin side. Every function checks the permission first (CLAUDE.md rule 3).
// Drivers without a login answer through links created here (see link.ts and ADR-006).
import type { Driver } from "@/lib/db/types";
import { authorized, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { routeToken } from "@/lib/orgs";
import { LINK_HOURS, hashToken, newToken } from "./link";

const PERM = "odometer.review";

function friendly(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (/odometer_cycles_period_key/.test(msg)) throw new UserError("A cycle for this month already exists.");
  const hit = msg.match(/(submission [0-9a-f-]+ is not (open for input|awaiting review)|a rejection note is required|reading is flagged \([a-z_]+\): a review note is required to accept it|cycle is not open|reading out of range)/);
  if (hit) {
    const t = hit[0];
    throw new UserError(
      /not open for input/.test(t) ? "This reading can no longer be entered (the cycle is closed or it was already sent)."
      : /not awaiting review/.test(t) ? "This reading is not waiting for review."
      : /rejection note/.test(t) ? "Write a note of at least 5 characters to reject a reading."
      : /flagged/.test(t) ? `This reading looks wrong (${t.match(/\(([a-z_]+)\)/)![1].replace(/_/g, " ")}). Write a note of at least 5 characters to accept it.`
      : /cycle is not open/.test(t) ? "This cycle is already closed." : "That reading is out of range.");
  }
  throw e;
}

export type CycleRow = { id: string; period: string; due_on: string; status: string; total: number; pending: number; submitted: number; approved: number };

export function listCycles(driver: Driver, m: Membership): Promise<CycleRow[]> {
  return authorized(driver, m, PERM, async (q) =>
    (await q.query<CycleRow>(
      `select c.id, c.period::text, c.due_on::text, c.status, count(s.id)::int total,
              count(*) filter (where s.status in ('pending','rejected'))::int pending,
              count(*) filter (where s.status = 'submitted')::int submitted,
              count(*) filter (where s.status = 'approved')::int approved
         from odometer_cycles c left join odometer_submissions s on s.cycle_id = c.id
        group by c.id order by c.period desc limit 24`)).rows);
}

export function openCycle(driver: Driver, m: Membership, period: string, dueOn: string): Promise<string> {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new UserError("Choose the month.", { period: "Choose the month" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) throw new UserError("Choose the due date.", { due_on: "Choose the due date" });
  return authorized(driver, m, PERM, async (q) => {
    try { return (await q.query<{ id: string }>("select open_odometer_cycle($1::date, $2::date, $3) as id", [`${period}-01`, dueOn, m.userId])).rows[0].id; }
    catch (e) { return friendly(e); }
  });
}

export function closeCycle(driver: Driver, m: Membership, cycleId: string): Promise<void> {
  return authorized(driver, m, PERM, async (q) => {
    try {
      await q.query("select close_odometer_cycle($1)", [cycleId]);
      await q.query(`update public.odometer_links set revoked_at = now() where tenant_id = $1 and used_at is null and revoked_at is null
                       and submission_id in (select id from odometer_submissions where cycle_id = $2)`, [m.tenantId, cycleId]);
    } catch (e) { friendly(e); }
  });
}

export type Verdict = "normal" | "lower" | "too_fast";
export type SubmissionRow = {
  id: string; vehicle_id: string; registration_no: string; make: string | null; model: string | null; year: number | null;
  holder_name: string | null; holder_phone: string | null;
  /** when the monthly WhatsApp request was sent for this vehicle (ADR-050), if it was */ wa_sent_at: string | null;
  status: string; reading_km: string | null; /** hour meter sent with the reading, for a vehicle that tracks hours */ reading_hours: string | null; note: string | null; submitted_at: string | null; review_note: string | null; reviewed_at: string | null;
  last_km: string; last_read_at: string | null; stale_days: number | null; link_expires_at: string | null; last_link_at: string | null;
  /** only for readings waiting for review: how the reading compares with what is on file */
  change_km: number | null; km_per_day: number | null; days_between: number | null; verdict: Verdict | null;
};
export type CycleDetail = {
  cycle: Pick<CycleRow, "id" | "period" | "due_on" | "status"> & { opened_at: string; days_left: number };
  rows: SubmissionRow[];
  counts: { approved: number; review: number; held: number; pending: number; total: number };
  rules: { maxKmPerDay: number; staleDays: number };
};

/**
 * One cycle with every vehicle's state. A reading is "held" when it is below the last one or implies more km a day
 * than the limit: the same two rules the database applies when it is approved, shown here before the reviewer decides.
 */
export function getCycle(driver: Driver, m: Membership, cycleId: string): Promise<CycleDetail | null> {
  return authorized(driver, m, PERM, async (q) => {
    const cycle = (await q.query<CycleDetail["cycle"]>(
      "select id, period::text, due_on::text, status, opened_at::text, (due_on - current_date)::int as days_left from odometer_cycles where id = $1", [cycleId])).rows[0];
    if (!cycle) return null;
    const maxKmPerDay = Number((await q.query<{ v: string }>("select setting_num('odometer_max_km_per_day', 800)::text v")).rows[0].v);
    const staleDays = Number((await q.query<{ v: string }>("select setting_num('odometer_stale_days', 45)::text v")).rows[0].v);
    const raw = (await q.query<Omit<SubmissionRow, "change_km" | "km_per_day" | "days_between" | "verdict">>(
      `select s.id, s.vehicle_id, v.registration_no, v.make, v.model, v.year, e.full_name as holder_name, e.phone as holder_phone, s.status, s.reading_km::text, s.reading_hours::text, s.note,
              s.submitted_at::text, s.review_note, s.reviewed_at::text, v.odometer_km::text as last_km, v.odometer_updated_at::text as last_read_at,
              (current_date - v.odometer_updated_at::date)::int as stale_days,
              (select max(l.expires_at)::text from public.odometer_links l
                where l.tenant_id = $2 and l.submission_id = s.id and l.used_at is null and l.revoked_at is null and l.expires_at > now()) as link_expires_at,
              (select max(l.created_at)::text from public.odometer_links l where l.tenant_id = $2 and l.submission_id = s.id) as last_link_at,
              (select min(w.sent_at)::text from odometer_wa_messages w where w.submission_id = s.id) as wa_sent_at
         from odometer_submissions s join vehicles v on v.id = s.vehicle_id left join employees e on e.id = s.assigned_to
        where s.cycle_id = $1 order by v.registration_no`, [cycleId, m.tenantId])).rows;
    const rows: SubmissionRow[] = raw.map((r) => {
      if (r.status !== "submitted" || r.reading_km === null) return { ...r, change_km: null, km_per_day: null, days_between: null, verdict: null };
      const change = Number(r.reading_km) - Number(r.last_km);
      const days = r.last_read_at ? Math.max(1, Math.ceil((Date.now() - new Date(r.last_read_at).getTime()) / 864e5)) : 1;
      const perDay = change > 0 ? Math.round((change / days) * 10) / 10 : 0;
      const verdict: Verdict = change < 0 ? "lower" : perDay > maxKmPerDay ? "too_fast" : "normal";
      return { ...r, change_km: change, km_per_day: perDay, days_between: days, verdict };
    });
    const counts = {
      approved: rows.filter((r) => r.status === "approved").length,
      review: rows.filter((r) => r.status === "submitted").length,
      held: rows.filter((r) => r.verdict && r.verdict !== "normal").length,
      pending: rows.filter((r) => ["pending", "rejected"].includes(r.status)).length,
      total: rows.length,
    };
    return { cycle, rows, counts, rules: { maxKmPerDay, staleDays } };
  });
}

/** Approves every waiting reading that is not held. Held readings need a person to look and write a note; a submission that carries hours is looked at by a person too. */
export function approveNormalReadings(driver: Driver, m: Membership, cycleId: string): Promise<number> {
  return authorized(driver, m, PERM, async (q) => {
    const open = (await q.query("select 1 from odometer_cycles where id = $1 and status = 'open'", [cycleId])).rows.length > 0;
    if (!open) throw new UserError("This cycle is closed.");
    const maxKmPerDay = Number((await q.query<{ v: string }>("select setting_num('odometer_max_km_per_day', 800)::text v")).rows[0].v);
    const ok = (await q.query<{ id: string }>(
      `select s.id from odometer_submissions s join vehicles v on v.id = s.vehicle_id
        where s.cycle_id = $1 and s.status = 'submitted' and s.reading_km >= v.odometer_km and s.reading_hours is null
          and (s.reading_km - v.odometer_km) / greatest(1, ceil(extract(epoch from (now() - coalesce(v.odometer_updated_at, now() - interval '1 day'))) / 86400.0)) <= $2
        order by s.id`, [cycleId, maxKmPerDay])).rows;
    for (const r of ok) {
      try { await q.query("select approve_odometer_submission($1, $2, null)", [r.id, m.userId]); } catch (e) { friendly(e); }
    }
    return ok.length;
  });
}

export type NewLink = { submission_id: string; plate: string; holder_name: string | null; holder_phone: string | null; token: string; expires_at: string };

/**
 * One link per vehicle that still needs a reading. Earlier live links for the same vehicle stop working. The raw
 * token is returned once and never stored.
 */
export async function createLinks(driver: Driver, m: Membership, cycleId: string, only?: string[]): Promise<NewLink[]> {
  const links = await createLinksInOrg(driver, m, cycleId, only);
  // The control plane learns which organization each new link belongs to; without that a link would not open.
  try { await Promise.all(links.map((l) => routeToken(driver, "odometer", m.tenantId, hashToken(l.token), l.expires_at))); }
  catch { await Promise.all(links.map((l) => revokeLinks(driver, m, l.submission_id).catch(() => undefined))); throw new UserError("The links could not be created. Try again."); }
  return links;
}

function createLinksInOrg(driver: Driver, m: Membership, cycleId: string, only?: string[]): Promise<NewLink[]> {
  return authorized(driver, m, PERM, async (q) => {
    const open = (await q.query("select 1 from odometer_cycles where id = $1 and status = 'open'", [cycleId])).rows.length > 0;
    if (!open) throw new UserError("This cycle is closed.");
    const subs = (await q.query<{ id: string; registration_no: string; holder_name: string | null; holder_phone: string | null }>(
      `select s.id, v.registration_no, e.full_name as holder_name, e.phone as holder_phone
         from odometer_submissions s join vehicles v on v.id = s.vehicle_id left join employees e on e.id = s.assigned_to
        where s.cycle_id = $1 and s.status in ('pending','rejected') ${only?.length ? "and s.id = any($2::uuid[])" : ""}
        order by v.registration_no`, only?.length ? [cycleId, only] : [cycleId])).rows;
    if (subs.length === 0) throw new UserError("Nothing is waiting for a reading.");
    const out: NewLink[] = [];
    for (const s of subs) {
      await q.query("update public.odometer_links set revoked_at = now() where tenant_id = $1 and submission_id = $2 and used_at is null and revoked_at is null", [m.tenantId, s.id]);
      const token = newToken();
      const exp = (await q.query<{ e: string }>(
        `insert into public.odometer_links(token_hash, tenant_id, submission_id, created_by, expires_at)
         values ($1, $2, $3, $4, now() + ($5 || ' hours')::interval) returning expires_at::text as e`,
        [hashToken(token), m.tenantId, s.id, m.userId, String(LINK_HOURS)])).rows[0].e;
      out.push({ submission_id: s.id, plate: s.registration_no, holder_name: s.holder_name, holder_phone: s.holder_phone, token, expires_at: exp });
    }
    return out;
  });
}

export function revokeLinks(driver: Driver, m: Membership, submissionId: string): Promise<void> {
  return authorized(driver, m, PERM, async (q) => {
    await q.query("update public.odometer_links set revoked_at = now() where tenant_id = $1 and submission_id = $2 and used_at is null and revoked_at is null", [m.tenantId, submissionId]);
  });
}

/** The admin types a reading the driver phoned in. It still goes through review like any other. */
export function enterReading(driver: Driver, m: Membership, submissionId: string, reading: string, note?: string): Promise<void> {
  const text = reading.trim().replace(/,/g, "");
  if (!/^\d{1,7}(\.\d)?$/.test(text)) throw new UserError("Enter the odometer as a number, like 48210.", { reading: "Enter a number" });
  return authorized(driver, m, PERM, async (q) => {
    try {
      await q.query("select submit_odometer($1, $2, $3, $4)", [submissionId, Number(text), m.userId, note?.trim() || "Entered by an admin"]);
      await q.query("update public.odometer_links set revoked_at = now() where tenant_id = $1 and submission_id = $2 and used_at is null and revoked_at is null", [m.tenantId, submissionId]);
    } catch (e) { friendly(e); }
  });
}

export function reviewReading(driver: Driver, m: Membership, submissionId: string, decision: "approve" | "reject", note?: string): Promise<void> {
  return authorized(driver, m, PERM, async (q) => {
    try {
      if (decision === "approve") await q.query("select approve_odometer_submission($1, $2, $3)", [submissionId, m.userId, note?.trim() || null]);
      else await q.query("select reject_odometer_submission($1, $2, $3)", [submissionId, m.userId, note ?? null]);
    } catch (e) { friendly(e); }
  });
}

/**
 * A reading a person sends on their own, outside the monthly request (the WhatsApp menu, ADR-079). It lands in the same table through the same checks: a reading below the last one,
 * or an impossible jump, is kept but flagged for the fleet office to review, and only accepted readings move the vehicle's odometer. The person must be allowed to enter
 * readings and to use that vehicle.
 */
export function recordOwnReading(driver: Driver, m: Membership, vehicleId: string, km: number): Promise<{ status: string; flag_reason: string | null; last_km: string | null; registration_no: string }> {
  return authorized(driver, m, "odometer.submit", async (q) => {
    const v = (await q.query<{ registration_no: string }>(
      `select v.registration_no from vehicles v where v.id = $1 and dept_ok(v.id)
          and ($3::boolean = false or exists (select 1 from vehicle_custody c join employees e on e.id = c.employee_id where c.vehicle_id = v.id and c.to_date is null and e.user_id = $2))`,
      [vehicleId, m.userId, m.vehicleScope === "own"])).rows[0];
    if (!v) throw new UserError("That vehicle is not one you can send a reading for.");
    const last = (await q.query<{ reading_km: string }>("select reading_km::text from odometer_readings where vehicle_id = $1 and status = 'accepted' order by read_at desc, created_at desc limit 1", [vehicleId])).rows[0];
    const r = (await q.query<{ status: string; flag_reason: string | null }>(
      "insert into odometer_readings(vehicle_id, reading_km, source, entered_by) values ($1, $2, 'manual', $3) returning status, flag_reason", [vehicleId, km, m.userId])).rows[0];
    return { status: r.status, flag_reason: r.flag_reason, last_km: last?.reading_km ?? null, registration_no: v.registration_no };
  });
}
