// The workspace home. One transaction, and each block is read only if the member's role holds the permission that
// block needs (CLAUDE.md rule 3); a role sees exactly the blocks it could open on their own screens.
import type { Driver } from "@/lib/db/types";
import { adminMayDecideOwn, authorizedAny, ForbiddenError, type Membership } from "@/lib/auth/can";

export type Sample = { text: string; href: string };
export type ActionItem = { key: string; label: string; count: number; href: string; samples: Sample[] };
export type Health = {
  vehicles: Record<string, number>;
  service: { overdue: number; due_soon: number };
  documents: { expired: number; due_30: number };
  flags: { high: number; medium: number };
  monthSpend: number;
  fleetBudget: { budget: number; spent: number; pct: number } | null;
  pipeline: { status: string; count: number }[];
};
export type MyVehicle = { id: string; registration_no: string; label: string; pm_worst: string | null; docs_expired: number; docs_due: number };
/** What the vehicles a person holds have cost, for someone limited to their own vehicle. Only job cards raised while they were the
 *  holder count, the same rule that decides which cards they may open. Money is in the workspace currency. */
export type MyExpenses = {
  currency: string; monthSpend: number; yearSpend: number; totalSpend: number; openCards: number;
  byVehicle: { vehicle_id: string; registration_no: string; label: string; month: number; year: number; total: number; jobs: number }[];
  recent: { id: string; job_no: string; registration_no: string; status: string; created_at: string; cost: number }[];
};
export type Dashboard = { actions: ActionItem[]; health: Health | null; myVehicles: MyVehicle[]; expenses: MyExpenses | null };

const ALL = ["jobcard.approve", "quotation.approve", "jobcard.assign_vendor", "invoice.verify", "odometer.review", "jobcard.create",
  "compliance.manage", "report.view", "vehicle.read", "jobcard.read_all", "jobcard.read_own"];

export async function getDashboard(driver: Driver, m: Membership): Promise<Dashboard> {
  // the administrator sees a card they raised as waiting for them only while nobody else could decide it (ADR-072)
  const [selfCards, selfQuotes] = m.role === "tenant_admin" ? await Promise.all([adminMayDecideOwn(driver, m, "jobcard.approve"), adminMayDecideOwn(driver, m, "quotation.approve")]) : [false, false];
  return authorizedAny(driver, m, ALL, async (q, held) => {
    const actions: ActionItem[] = [];
    const cards = async (key: string, label: string, where: string, hrefStatus: string, params: unknown[] = []) => {
      const rows = (await q.query<{ id: string; job_no: string; registration_no: string; priority: string }>(
        `select jc.id, jc.job_no, v.registration_no, jc.priority from job_cards jc join vehicles v on v.id = jc.vehicle_id
          where (${where}) and dept_ok(jc.vehicle_id) order by case jc.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, jc.created_at limit 5`, params)).rows;
      const count = (await q.query<{ c: number }>(`select count(*)::int c from job_cards jc where (${where}) and dept_ok(jc.vehicle_id)`, params)).rows[0].c;
      if (count > 0) actions.push({ key, label, count, href: `job-cards?status=${hrefStatus}`, samples: rows.map((r) => ({ text: `${r.job_no} · ${r.registration_no}${r.priority === "urgent" || r.priority === "high" ? ` · ${r.priority}` : ""}`, href: `job-cards/${r.id}` })) });
    };
    // a card the member raised cannot be decided by them, so it is not "waiting for you"
    // (the administrator may approve a card they raised themselves only while nobody else could, so then every submitted card is waiting for them)
    const notMine = (self: boolean) => (self ? "true and $1::text is not null" : "jc.requested_by is distinct from actor_employee($1)");

    if (held.has("jobcard.approve")) await cards("approve", "Job cards waiting for your approval", `jc.status = 'submitted' and ${notMine(selfCards)} and not dept_over_limit(jc.estimated_cost)`, "submitted", [m.userId]);
    if (held.has("quotation.approve")) await cards("quotes", "Quotations to decide", `jc.status = 'quotation_received' and ${notMine(selfQuotes)}`, "quotation_received", [m.userId]);
    if (held.has("jobcard.assign_vendor")) await cards("assign", "Approved, no workshop chosen yet", `jc.status = 'approved' and jc.vendor_id is null`, "approved");
    if (held.has("invoice.verify")) {
      const inv = (await q.query<{ id: string; invoice_no: string; job_no: string }>(
        `select i.id, i.invoice_no, jc.job_no from invoices i join work_orders wo on wo.id = i.work_order_id join job_cards jc on jc.id = wo.job_card_id
          where i.status = 'submitted' order by i.invoice_date limit 5`)).rows;
      const n = (await q.query<{ c: number }>("select count(*)::int c from invoices where status = 'submitted'")).rows[0].c;
      if (n > 0) actions.push({ key: "invoices", label: "Invoices to check", count: n, href: "invoices?status=submitted", samples: inv.map((r) => ({ text: `${r.invoice_no} · ${r.job_no}`, href: `invoices/${r.id}` })) });
      await cards("close", "Checked, ready to close", `jc.status = 'invoice_verified'`, "invoice_verified");
    }
    if (held.has("odometer.review")) {
      const o = (await q.query<{ id: string; period: string; due_on: string; to_review: number; waiting: number }>(
        `select c.id, c.period::text, c.due_on::text,
                count(*) filter (where s.status = 'submitted')::int as to_review, count(*) filter (where s.status in ('pending','rejected'))::int as waiting
           from odometer_cycles c join odometer_submissions s on s.cycle_id = c.id where c.status = 'open' group by c.id order by c.period desc limit 1`)).rows[0];
      if (o && o.to_review > 0) actions.push({ key: "odo_review", label: "Odometer readings to review", count: o.to_review, href: `odometer/${o.id}`, samples: [] });
      if (o && o.waiting > 0) actions.push({ key: "odo_waiting", label: `Vehicles still to send a reading (due ${o.due_on})`, count: o.waiting, href: `odometer/${o.id}`, samples: [] });
    }
    if (held.has("jobcard.create")) {
      await cards("returned", "Sent back to you for changes", `jc.status = 'returned_for_edit' and job_card_is_mine(jc.id, $1)`, "returned_for_edit", [m.userId]);
      await cards("drafts", "Your drafts", `jc.status = 'draft' and job_card_is_mine(jc.id, $1)`, "draft", [m.userId]);
    }
    if (held.has("compliance.manage") || held.has("report.view")) {
      const d = (await q.query<{ expired: number; due: number }>(
        `select count(*) filter (where d.doc_status = 'expired')::int as expired, count(*) filter (where d.doc_status = 'due_30')::int as due
           from v_documents_status d join vehicles v on v.id = d.vehicle_id where v.status in ('active','in_workshop')`)).rows[0];
      if (d.expired > 0) actions.push({ key: "docs_expired", label: "Documents expired", count: d.expired, href: "compliance?status=expired", samples: [] });
      if (d.due > 0) actions.push({ key: "docs_due", label: "Documents expiring within 30 days", count: d.due, href: "compliance?status=due_30", samples: [] });
    }

    let health: Health | null = null;
    if (held.has("report.view")) {
      const one = async <T,>(sql: string) => (await q.query<T & Record<string, unknown>>(sql)).rows;
      const vehicles = Object.fromEntries((await one<{ status: string; c: number }>("select status, count(*)::int c from vehicles group by status")).map((r) => [r.status, r.c]));
      const svc = (await one<{ overdue: number; due_soon: number }>(
        `select count(distinct vehicle_id) filter (where pm_status = 'overdue')::int as overdue, count(distinct vehicle_id) filter (where pm_status = 'due_soon')::int as due_soon from v_pm_status`))[0];
      const docs = (await one<{ expired: number; due_30: number }>(
        `select count(*) filter (where d.doc_status = 'expired')::int as expired, count(*) filter (where d.doc_status = 'due_30')::int as due_30
           from v_documents_status d join vehicles v on v.id = d.vehicle_id where v.status in ('active','in_workshop')`))[0];
      const fl = (await one<{ high: number; medium: number }>("select count(*) filter (where severity = 'high')::int as high, count(*) filter (where severity = 'medium')::int as medium from v_vehicle_flags"))[0];
      const spend = (await one<{ s: string }>("select coalesce(sum(cost), 0)::text as s from v_vehicle_job_cost where created_at >= date_trunc('month', now())"))[0];
      const fb = (await one<{ budget: string; spent: string; pct: string }>(
        `select u.budget::text, u.spent::text, coalesce(u.pct_used, 0)::text as pct from v_budget_utilisation u
          where u.vehicle_id is null and current_date between u.period_start and u.period_end order by u.period_start desc limit 1`))[0];
      const pipe = await one<{ status: string; count: number }>(
        `select status, count(*)::int as count from job_cards where status not in ('draft','closed','cancelled','rejected') group by status order by count desc`);
      health = {
        vehicles, service: svc, documents: docs, flags: fl, monthSpend: Number(spend.s),
        fleetBudget: fb ? { budget: Number(fb.budget), spent: Number(fb.spent), pct: Number(fb.pct) } : null,
        pipeline: pipe,
      };
    }

    let myVehicles: MyVehicle[] = [];
    if (held.has("vehicle.read")) {
      myVehicles = (await q.query<MyVehicle>(
        `select v.id, v.registration_no, concat_ws(' ', v.make, v.model) as label,
                (select case min(case x.pm_status when 'overdue' then 0 when 'due_soon' then 1 when 'no_history' then 2 when 'scheduled' then 3 else 4 end)
                          when 0 then 'overdue' when 1 then 'due_soon' when 2 then 'no_history' when 3 then 'scheduled' when 4 then 'ok' end from v_pm_status x where x.vehicle_id = v.id) as pm_worst,
                (select count(*)::int from v_documents_status d where d.vehicle_id = v.id and d.doc_status = 'expired') as docs_expired,
                (select count(*)::int from v_documents_status d where d.vehicle_id = v.id and d.doc_status = 'due_30') as docs_due
           from vehicles v join vehicle_custody c on c.vehicle_id = v.id and c.to_date is null join employees e on e.id = c.employee_id
          where e.user_id = $1 and dept_ok(v.id) and v.status in ('active','in_workshop') order by v.registration_no limit 10`, [m.userId])).rows;
    }
    // Someone limited to their own vehicle also sees what it has cost them. Nobody else's figures reach this query: it filters on the
    // signed-in person's own employee record, not on anything the page sends.
    let expenses: MyExpenses | null = null;
    if (m.vehicleScope === "own") {
      const mine = "c.custodian_id = actor_employee($1)";
      const byVehicle = (await q.query<{ vehicle_id: string; registration_no: string; label: string; month: string; year: string; total: string; jobs: number }>(
        `select v.id as vehicle_id, v.registration_no, concat_ws(' ', v.make, v.model) as label,
                coalesce(sum(c.cost) filter (where c.created_at >= date_trunc('month', now())), 0)::text as month,
                coalesce(sum(c.cost) filter (where c.created_at >= date_trunc('year', now())), 0)::text as year,
                coalesce(sum(c.cost), 0)::text as total, count(*)::int as jobs
           from v_vehicle_job_cost c join vehicles v on v.id = c.vehicle_id where ${mine}
          group by v.id, v.registration_no, v.make, v.model order by v.registration_no`, [m.userId])).rows;
      const recent = (await q.query<{ id: string; job_no: string; registration_no: string; status: string; created_at: string; cost: string }>(
        `select jc.id, jc.job_no, v.registration_no, jc.status, jc.created_at::date::text as created_at, c.cost::text as cost
           from v_vehicle_job_cost c join job_cards jc on jc.id = c.job_card_id join vehicles v on v.id = c.vehicle_id
          where ${mine} order by jc.created_at desc limit 6`, [m.userId])).rows;
      const open = (await q.query<{ c: number }>(
        `select count(*)::int c from job_cards jc where jc.custodian_id = actor_employee($1) and jc.status not in ('draft','closed','cancelled','rejected')`, [m.userId])).rows[0].c;
      const currency = (await q.query<{ currency: string }>("select currency from public.tenants where id = $1", [m.tenantId])).rows[0]?.currency ?? "";
      expenses = {
        currency, monthSpend: byVehicle.reduce((a, r) => a + Number(r.month), 0), yearSpend: byVehicle.reduce((a, r) => a + Number(r.year), 0),
        totalSpend: byVehicle.reduce((a, r) => a + Number(r.total), 0), openCards: open,
        byVehicle: byVehicle.map((r) => ({ ...r, month: Number(r.month), year: Number(r.year), total: Number(r.total) })),
        recent: recent.map((r) => ({ ...r, cost: Number(r.cost) })),
      };
    }
    return { actions, health, myVehicles, expenses };
  });
}

/** The two numbers shown as badges in the sidebar. Zero for roles that cannot act on them. */
export async function getNavCounts(driver: Driver, m: Membership): Promise<{ approvals: number; odometer: number; joins: number }> {
  try {
    return await authorizedAny(driver, m, ["jobcard.approve", "odometer.review", "admin.users"], async (q, held) => {
      const approvals = held.has("jobcard.approve")
        ? (await q.query<{ c: number }>("select count(*)::int c from job_cards jc where jc.status = 'submitted' and jc.requested_by is distinct from actor_employee($1) and dept_ok(jc.vehicle_id) and not dept_over_limit(jc.estimated_cost)", [m.userId])).rows[0].c : 0
      const odometer = held.has("odometer.review")
        ? (await q.query<{ c: number }>(
            `select count(*)::int c from odometer_submissions s join odometer_cycles c on c.id = s.cycle_id where c.status = 'open' and s.status = 'submitted'`)).rows[0].c : 0;
      const joins = held.has("admin.users")
        ? (await q.query<{ c: number }>("select count(*)::int c from public.join_requests where tenant_id = $1 and status = 'pending'", [m.tenantId])).rows[0].c : 0;
      return { approvals, odometer, joins };
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return { approvals: 0, odometer: 0, joins: 0 };
    throw e;
  }
}
