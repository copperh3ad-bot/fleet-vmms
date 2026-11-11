// The company's own activity log (owner decision I2). Read-only, for the administrator and the auditor. It reads the company's audit_log: who added, changed or
// removed what, and every export. It shows the field NAMES that changed, never their old or new values.
import type { Driver } from "@/lib/db/types";
import { authorized, type Membership } from "@/lib/auth/can";

export type ActivityRow = { id: string; at: string; table_name: string; action: string; row_id: string | null; actor_name: string | null; changed: string[] | null };

export const ACTIVITY_PAGE = 200;
export const ACTIVITY_DAYS = [1, 7, 30, 90, 365] as const;

/** A table name as a person would say it: "job_cards" becomes "Job cards"; an export row "export:cargo" becomes "Export: cargo". */
export const tableLabel = (t: string) => {
  const s = t.replace(/^export:/, "export: ").replace(/_/g, " ");
  return s[0].toUpperCase() + s.slice(1);
};

export function listCompanyActivity(driver: Driver, m: Membership, opts: { table?: string; days?: number } = {}): Promise<{ rows: ActivityRow[]; tables: string[] }> {
  const days = (ACTIVITY_DAYS as readonly number[]).includes(opts.days ?? 0) ? (opts.days as number) : 30;
  return authorized(driver, m, "activity.read", async (q) => {
    const p: unknown[] = [days];
    let where = "a.at >= now() - ($1 || ' days')::interval";
    if (opts.table) { p.push(opts.table.slice(0, 80)); where += ` and a.table_name = $${p.length}`; }
    const rows = (await q.query<ActivityRow>(
      `select a.id::text, a.at::text, a.table_name, a.action, a.row_id, e.full_name as actor_name,
              case when a.action = 'UPDATE' then (select array_agg(k order by k) from jsonb_object_keys(a.new_data) k
                                                   where a.new_data -> k is distinct from a.old_data -> k and k not in ('updated_at')) end as changed
         from audit_log a left join employees e on e.user_id::text = a.actor_id
        where ${where} order by a.at desc, a.id desc limit ${ACTIVITY_PAGE}`, p)).rows;
    const tables = (await q.query<{ table_name: string }>("select distinct table_name from audit_log order by 1")).rows.map((r) => r.table_name);
    return { rows, tables };
  });
}
