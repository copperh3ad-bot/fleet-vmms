// What the company's policy settings mean in numbers right now: vehicles past the replacement age, accidents the driver
// bears, and each driver's share of repair costs. Reading needs policy.read; the money figures need report.view or
// policy.manage. Changing the settings themselves is control/service.saveSettings, which needs policy.manage.
import type { Driver } from "@/lib/db/types";
import { authorizedAny, ForbiddenError, type Membership } from "@/lib/auth/can";
import { listAccidents } from "@/lib/compliance/service";
import { accidentCover } from "@/lib/compliance/cover";

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
          `select coalesce(e.full_name, 'No driver assigned') as driver, count(*)::int as jobs, sum(c.cost)::text as cost
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

// ============================ The policy as it applies to one job card (ADR-095) ============================

export type PolicyLine = { rule: string; text: string; amount: number | null; applies: boolean };
const NO_DRIVER_SHARE = new Set(["scheduled_service", "wear_and_tear", "accident_damage"]);

/**
 * The company's policy rules that touch this job card, read-only, for the approval and invoice screens: the driver's share of the repair, who bears an accident repair, and
 * whether the vehicle is due for replacement. Each line says the rule, whether it applies to this card and, where there is one, the amount that applies. The base for the
 * driver's share is the invoice (payable amount, else invoiced), else the approved quotation, else the estimate. Nothing is changed or blocked by this.
 */
export function getPolicyForJob(driver: Driver, m: Membership, jobId: string): Promise<PolicyLine[]> {
  return authorizedAny(driver, m, ["jobcard.read_all", "invoice.read", "invoice.verify"], async (q) => {
    const val = new Map((await q.query<{ key: string; value: string }>("select key, value from settings where key like 'policy\\_%'")).rows.map((r) => [r.key, Number(r.value)]));
    const sharePct = val.get("policy_driver_share_pct") ?? 0, free = val.get("policy_free_accidents") ?? 0, gap = val.get("policy_accident_gap_months") ?? 12, replaceYears = val.get("policy_replace_years") ?? 0;
    const jc = (await q.query<{ vehicle_id: string; category: string; reason: string; estimate: string | null; base: string | null; driver: string | null }>(
      `select jc.vehicle_id, rc.category, rc.label as reason, jc.estimated_cost::text as estimate, e.full_name as driver,
              coalesce((select coalesce(i.payable_amount, i.amount) from invoices i join work_orders wo on wo.id = i.work_order_id where wo.job_card_id = jc.id and i.status <> 'disputed' order by i.invoice_date desc, i.id desc limit 1),
                       (select wo.approved_amount from work_orders wo where wo.job_card_id = jc.id limit 1))::text as base
         from job_cards jc join reason_codes rc on rc.id = jc.reason_code_id left join employees e on e.id = jc.custodian_id where jc.id = $1`, [jobId])).rows[0];
    if (!jc) return [];
    const lines: PolicyLine[] = [];
    const base = Number(jc.base ?? jc.estimate ?? 0);
    if (sharePct > 0) {
      const applies = !NO_DRIVER_SHARE.has(jc.category);
      lines.push({ rule: "Driver's share of repairs", applies, amount: applies && base > 0 ? Math.round(base * sharePct) / 100 : null,
        text: applies ? `The driver bears ${sharePct}% of a repair; the company the rest. Routine service, wear items and accident repairs are not counted.${jc.driver ? ` Driver: ${jc.driver}.` : ""}`
                      : `Does not apply: ${jc.reason.toLowerCase()} is routine service, a wear item or an accident repair.` });
    }
    if (free > 0 && jc.category === "accident_damage") {
      const acc = (await q.query<{ id: string; employee_id: string | null; occurred_at: string }>("select id, employee_id, occurred_at::text from accidents where employee_id is not null")).rows;
      const linked = (await q.query<{ id: string }>("select id from accidents where job_card_id = $1 limit 1", [jobId])).rows[0];
      const cover = linked ? accidentCover(acc, free, gap).get(linked.id) : undefined;
      lines.push({ rule: "Accidents", applies: true, amount: null,
        text: cover ? (cover.cover === "covered" ? `Accident number ${cover.nth} for this driver: covered by the company (the first ${free}, at least ${gap} months apart).` : `Accident number ${cover.nth} for this driver: not covered. The driver bears the depreciation.`)
                    : `The company covers a driver's first ${free} accidents, at least ${gap} months apart; after that the driver bears the depreciation. Link the accident under Accidents to see which applies.` });
    }
    if (replaceYears > 0) {
      const due = (await q.query<{ detail: string }>("select detail from v_vehicle_flags where vehicle_id = $1 and flag = 'replacement_due'", [jc.vehicle_id])).rows[0];
      if (due) lines.push({ rule: "Replacement", applies: true, amount: null, text: `This vehicle is due for replacement (policy: after ${replaceYears} years). ${due.detail}` });
    }
    return lines;
  });
}
