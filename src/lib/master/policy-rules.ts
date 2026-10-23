// What the company's policy settings mean in numbers right now: vehicles past the replacement age, accidents the driver
// bears, and each driver's share of repair costs. Reading needs policy.read; the money figures need report.view or
// policy.manage. Changing the settings themselves is control/service.saveSettings, which needs policy.manage.
import type { Driver } from "@/lib/db/types";
import { authorizedAny, ForbiddenError, type Membership } from "@/lib/auth/can";
import { listAccidents } from "@/lib/compliance/service";

export type DriverShare = { driver: string; jobs: number; cost: number; share: number };
export type PolicyImpact = {
  replaceYears: number; replaceDue: { vehicle_id: string; registration_no: string; detail: string }[];
  freeAccidents: number; driverPaysLast12Months: number;
  sharePct: number; shares: DriverShare[] | null;                 // null: this person may not see the money
};

export function getPolicyImpact(driver: Driver, m: Membership): Promise<PolicyImpact> {
  return authorizedAny(driver, m, ["policy.read", "policy.manage"], async (q, held) => {
    const val = new Map((await q.query<{ key: string; value: string }>("select key, value from settings where key like 'policy\\_%'")).rows.map((r) => [r.key, Number(r.value)]));
    const replaceYears = val.get("policy_replace_years") ?? 0, freeAccidents = val.get("policy_free_accidents") ?? 0, sharePct = val.get("policy_driver_share_pct") ?? 0;
    const replaceDue = replaceYears > 0
      ? (await q.query<{ vehicle_id: string; registration_no: string; detail: string }>("select vehicle_id, registration_no, detail from v_vehicle_flags where flag = 'replacement_due' order by registration_no")).rows : [];
    const moneyOk = held.has("policy.manage") || (await q.query("select 1 from role_permissions where role_key = $1 and permission_key = 'report.view'", [m.role])).rows.length > 0;
    const shares = sharePct > 0 && moneyOk
      ? (await q.query<{ driver: string; jobs: number; cost: string }>(
          `select coalesce(e.full_name, 'Nobody held it') as driver, count(*)::int as jobs, sum(c.cost)::text as cost
             from v_vehicle_job_cost c join reason_codes rc on rc.id = c.reason_code_id left join employees e on e.id = c.custodian_id
            where rc.category not in ('scheduled_service','wear_and_tear','accident_damage') and c.created_at >= now() - interval '12 months'
            group by 1 order by sum(c.cost) desc`)).rows.map((r) => ({ driver: r.driver, jobs: r.jobs, cost: Number(r.cost), share: Math.round(Number(r.cost) * sharePct) / 100 }))
      : null;
    return { replaceYears, replaceDue, freeAccidents, driverPaysLast12Months: 0, sharePct, shares };
  }).then(async (impact) => {
    if (!(impact.freeAccidents > 0)) return impact;
    try { impact.driverPaysLast12Months = (await listAccidents(driver, m)).filter((a) => a.last_12_months && a.cover?.cover === "driver_pays").length; }
    catch (e) { if (!(e instanceof ForbiddenError)) throw e; }   // a role without accident access sees no count
    return impact;
  });
}
