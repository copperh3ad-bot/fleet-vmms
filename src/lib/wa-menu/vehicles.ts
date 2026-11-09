// Finding the vehicle a person means, only among the vehicles they may use (ADR-079). The same rules as the app: department scope, and for a person limited to their own
// vehicles, the ones they hold. The registration is matched in the database, never guessed.
import type { Queryable } from "@/lib/db/types";
import type { Choice } from "./text";

const bare = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const label = (v: { registration_no: string; make: string | null; model: string | null }) => `${v.registration_no}${v.make || v.model ? ` (${[v.make, v.model].filter(Boolean).join(" ")})` : ""}`;

/** The vehicles this person holds now, to offer as a short list. */
export async function heldVehicles(q: Queryable, employeeId: string, limit = 8): Promise<Choice[]> {
  const rows = (await q.query<{ id: string; registration_no: string; make: string | null; model: string | null }>(
    `select v.id, v.registration_no, v.make, v.model from vehicles v join vehicle_custody c on c.vehicle_id = v.id and c.to_date is null and c.employee_id = $1
      where v.status in ('active', 'in_workshop') and dept_ok(v.id) order by v.registration_no limit ${Math.min(limit, 20)}`, [employeeId])).rows;
  return rows.map((v) => ({ id: v.id, label: label(v) }));
}

/** Active vehicles a person may pick from for a trip (any in their scope), as a short list. */
export async function pickableVehicles(q: Queryable, employeeId: string, scopeOwn: boolean, limit = 8): Promise<Choice[]> {
  if (scopeOwn) return heldVehicles(q, employeeId, limit);
  const rows = (await q.query<{ id: string; registration_no: string; make: string | null; model: string | null }>(
    `select v.id, v.registration_no, v.make, v.model from vehicles v where v.status = 'active' and dept_ok(v.id) order by v.registration_no limit ${Math.min(limit, 20)}`)).rows;
  return rows.map((v) => ({ id: v.id, label: label(v) }));
}

/** The one vehicle whose registration the person typed, if they may use it. */
export async function findVehicleByRegistration(q: Queryable, employeeId: string, scopeOwn: boolean, typed: string): Promise<Choice | null> {
  if (bare(typed).length < 3) return null;
  const rows = (await q.query<{ id: string; registration_no: string; make: string | null; model: string | null }>(
    `select v.id, v.registration_no, v.make, v.model from vehicles v
      where upper(regexp_replace(v.registration_no, '[^A-Za-z0-9]', '', 'g')) = $1 and v.status in ('active', 'in_workshop') and dept_ok(v.id)
        and ($3::boolean = false or exists (select 1 from vehicle_custody c where c.vehicle_id = v.id and c.employee_id = $2 and c.to_date is null)) limit 2`, [bare(typed), employeeId, scopeOwn])).rows;
  return rows.length === 1 ? { id: rows[0].id, label: label(rows[0]) } : null;
}
