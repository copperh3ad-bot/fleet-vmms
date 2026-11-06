// Budgets, settings and service rules. Every function checks the permission first (CLAUDE.md rule 3).
// The database enforces the rest: budgets cannot overlap, an amount change needs a new reason, and settings accept
// only known keys with valid values.
import { z } from "zod";
import type { Driver } from "@/lib/db/types";
import { authorized, authorizedAny, ForbiddenError, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { fieldErrors, VEHICLE_CLASSES } from "@/lib/master/schemas";
import { SETTINGS, SETTING_PERMISSIONS, checkSetting, type SettingDef } from "./settings";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

// ============================ Budgets ============================

export type BudgetRow = {
  id: string; vehicle_id: string | null; registration_no: string | null; period_start: string; period_end: string; amount: string; reason: string | null;
  spent: string; pct_used: string | null; over_budget: boolean; when: "current" | "past" | "future";
};

export function listBudgets(driver: Driver, m: Membership): Promise<BudgetRow[]> {
  return authorizedAny(driver, m, ["budget.manage", "report.view"], async (q) =>
    (await q.query<BudgetRow>(
      `select b.id, b.vehicle_id, v.registration_no, b.period_start::text, b.period_end::text, b.amount::text, b.reason,
              u.spent::text, u.pct_used::text, u.over_budget,
              case when current_date < b.period_start then 'future' when current_date > b.period_end then 'past' else 'current' end as "when"
         from budgets b join v_budget_utilisation u on u.budget_id = b.id left join vehicles v on v.id = b.vehicle_id
        order by (b.vehicle_id is not null), v.registration_no, b.period_start desc limit 500`)).rows);
}

export const budgetSchema = z.object({
  id: z.preprocess(blank, z.uuid().optional()),
  vehicle_id: z.preprocess(blank, z.uuid().optional()),
  period_start: z.iso.date("Enter the start date"),
  period_end: z.iso.date("Enter the end date"),
  amount: z.coerce.number("Enter the amount").min(0, "Amount cannot be negative").max(999_999_999_999),
  reason: z.preprocess(blank, z.string().trim().max(300).optional()),
}).refine((b) => b.period_end >= b.period_start, { path: ["period_end"], message: "The end is before the start" });

export async function saveBudget(driver: Driver, m: Membership, input: Record<string, unknown>): Promise<string> {
  const r = budgetSchema.safeParse(input);
  if (!r.success) throw new UserError("Fix the highlighted fields.", fieldErrors(r.error));
  const b = r.data;
  return authorized(driver, m, "budget.manage", async (q) => {
    try {
      if (b.id) {
        const old = (await q.query<{ amount: string }>("select amount::text from budgets where id = $1", [b.id])).rows[0];
        if (!old) throw new UserError("Budget not found.");
        if (Number(old.amount) !== b.amount && (!b.reason || b.reason.trim().length < 5))
          throw new UserError("Say why the amount changes (at least 5 characters).", { reason: "Say why the amount changes" });
        await q.query("update budgets set period_start = $2, period_end = $3, amount = $4, reason = coalesce($5, reason) where id = $1", [b.id, b.period_start, b.period_end, b.amount, b.reason ?? null]);
        return b.id;
      }
      if (b.vehicle_id && (await q.query("select 1 from vehicles where id = $1", [b.vehicle_id])).rows.length === 0)
        throw new UserError("Vehicle not found.", { vehicle_id: "Choose a vehicle" });
      return (await q.query<{ id: string }>(
        "insert into budgets(vehicle_id, period_start, period_end, amount, reason, created_by) values ($1, $2, $3, $4, $5, $6) returning id",
        [b.vehicle_id ?? null, b.period_start, b.period_end, b.amount, b.reason ?? null, m.userId])).rows[0].id;
    } catch (e) {
      if (e instanceof UserError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/overlaps an existing budget/.test(msg)) throw new UserError("This period overlaps another budget for the same vehicle (or the whole fleet).", { period_start: "Overlaps another budget" });
      if (/changing a budget amount needs a new reason/.test(msg)) throw new UserError("Say why the amount changes, and use a different reason from last time.", { reason: "Write a new reason" });
      throw e;
    }
  });
}

// ---------- The designed Budgets screen ----------

export type BudgetStatus = "over" | "near" | "ok";
export type BudgetVehicleRow = { budget_id: string; vehicle_id: string; registration_no: string; make: string | null; model: string | null; amount: number; spent: number; pct: number; status: BudgetStatus };
export type BudgetBoard = {
  year: number;
  fleet: { budget_id: string; amount: number; spent: number; left: number; pct: number; period_start: string; period_end: string; yearGonePct: number; projected: number; projectedPct: number } | null;
  rows: BudgetVehicleRow[]; total: number;
  warnPct: number; flagPct: number;
};

/** Fleet position, projection at today's pace, and each vehicle's budget with over / near / on-track status. */
export function getBudgetBoard(driver: Driver, m: Membership, opts: { filter?: "attention" | "all"; year?: number } = {}): Promise<BudgetBoard> {
  return authorizedAny(driver, m, ["budget.manage", "report.view"], async (q) => {
    const year = opts.year ?? new Date().getUTCFullYear();
    const warn = Number((await q.query<{ v: string }>("select setting_num('budget_warn_pct', 80)::text v")).rows[0].v);
    const flag = Number((await q.query<{ v: string }>("select setting_num('budget_flag_pct', 100)::text v")).rows[0].v);
    const f = (await q.query<{ budget_id: string; budget: string; spent: string; period_start: string; period_end: string; gone: string }>(
      `select u.budget_id, u.budget::text, u.spent::text, u.period_start::text, u.period_end::text,
              least(1, greatest(0, (current_date - u.period_start + 1)::numeric / nullif(u.period_end - u.period_start + 1, 0)))::text as gone
         from v_budget_utilisation u
        where u.vehicle_id is null and extract(year from u.period_start) <= $1 and extract(year from u.period_end) >= $1
        order by u.period_start desc limit 1`, [year])).rows[0];
    let fleet: BudgetBoard["fleet"] = null;
    if (f) {
      const amount = Number(f.budget), spent = Number(f.spent), gone = Number(f.gone);
      const projected = gone > 0 ? spent / gone : spent;
      fleet = { budget_id: f.budget_id, amount, spent, left: amount - spent, pct: amount ? Math.round((spent / amount) * 100) : 0, period_start: f.period_start, period_end: f.period_end,
        yearGonePct: Math.round(gone * 100), projected: Math.round(projected), projectedPct: amount ? Math.round((projected / amount) * 100) : 0 };
    }
    const all = (await q.query<{ budget_id: string; vehicle_id: string; registration_no: string; make: string | null; model: string | null; budget: string; spent: string }>(
      `select u.budget_id, u.vehicle_id, v.registration_no, v.make, v.model, u.budget::text, u.spent::text
         from v_budget_utilisation u join vehicles v on v.id = u.vehicle_id
        where extract(year from u.period_start) <= $1 and extract(year from u.period_end) >= $1`, [year])).rows
      .map((r) => {
        const amount = Number(r.budget), spent = Number(r.spent), pct = amount ? Math.round((spent / amount) * 100) : 0;
        const status: BudgetStatus = pct >= flag ? "over" : pct >= warn ? "near" : "ok";
        return { budget_id: r.budget_id, vehicle_id: r.vehicle_id, registration_no: r.registration_no, make: r.make, model: r.model, amount, spent, pct, status };
      })
      .sort((a, b) => b.pct - a.pct || a.registration_no.localeCompare(b.registration_no));
    const rows = (opts.filter === "all" ? all : all.filter((r) => r.status !== "ok")).slice(0, 100);
    return { year, fleet, rows, total: all.length, warnPct: warn, flagPct: flag };
  });
}

/**
 * Copies last year's budgets to this year with the same amounts. A budget is skipped if the same vehicle (or the
 * fleet) already has one overlapping the new period. Returns how many were created and how many were skipped.
 */
export function copyBudgetsForward(driver: Driver, m: Membership, fromYear: number): Promise<{ created: number; skipped: number }> {
  if (!Number.isInteger(fromYear) || fromYear < 2000 || fromYear > 2200) return Promise.reject(new UserError("Choose a valid year."));
  return authorized(driver, m, "budget.manage", async (q) => {
    const src = (await q.query<{ vehicle_id: string | null; period_start: string; period_end: string; amount: string }>(
      "select vehicle_id, period_start::text, period_end::text, amount::text from budgets where extract(year from period_start) = $1 and extract(year from period_end) = $1 order by period_start", [fromYear])).rows;
    let created = 0, skipped = 0;
    for (const b of src) {
      const start = `${fromYear + 1}${b.period_start.slice(4)}`, end = `${fromYear + 1}${b.period_end.slice(4)}`;
      const clash = await q.query(
        `select 1 from budgets where vehicle_id is not distinct from $1::uuid and daterange(period_start, period_end, '[]') && daterange($2::date, $3::date, '[]')`, [b.vehicle_id, start, end]);
      if (clash.rows.length) { skipped++; continue; }
      await q.query("insert into budgets(vehicle_id, period_start, period_end, amount, reason, created_by) values ($1, $2, $3, $4, $5, $6)",
        [b.vehicle_id, start, end, b.amount, `Copied from ${fromYear}`, m.userId]);
      created++;
    }
    return { created, skipped };
  });
}

// ============================ Settings ============================

export type SettingView = SettingDef & { value: string; editable: boolean };

export function getSettings(driver: Driver, m: Membership): Promise<SettingView[]> {
  return authorizedAny(driver, m, [...SETTING_PERMISSIONS, "report.view", "policy.read"], async (q, held) => {
    const rows = (await q.query<{ key: string; value: string }>("select key, value from settings")).rows;
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    return SETTINGS.map((s) => ({ ...s, value: byKey.get(s.key) ?? "", editable: held.has(s.permission) }));
  });
}

/** Saves only keys that changed. Each key needs its own permission, so a mixed form cannot be used to reach one you lack. */
export async function saveSettings(driver: Driver, m: Membership, values: Record<string, string>): Promise<number> {
  const errors: Record<string, string> = {};
  const clean: Record<string, string> = {};
  for (const [key, raw] of Object.entries(values)) {
    const def = SETTINGS.find((s) => s.key === key);
    if (!def) throw new UserError("Unknown setting.");
    const c = checkSetting(def, raw);
    if (c.ok) clean[key] = c.value; else errors[key] = c.message;
  }
  if (Object.keys(errors).length) return Promise.reject(new UserError("Fix the highlighted fields.", errors));
  return authorizedAny(driver, m, SETTING_PERMISSIONS, async (q, held) => {
    const current = new Map((await q.query<{ key: string; value: string }>("select key, value from settings")).rows.map((r) => [r.key, r.value]));
    const changed = Object.entries(clean).filter(([k, v]) => current.get(k) !== v);
    for (const [k] of changed) if (!held.has(SETTINGS.find((s) => s.key === k)!.permission)) throw new ForbiddenError(SETTINGS.find((s) => s.key === k)!.permission);
    const next = (k: string) => Number(clean[k] ?? current.get(k));
    if (next("budget_warn_pct") > next("budget_flag_pct")) throw new UserError("The warning level must not be above the over-limit level.", { budget_warn_pct: "Must not be above the over-limit level" });
    for (const [k, v] of changed) await q.query("insert into settings(key, value) values ($1, $2) on conflict (key) do update set value = excluded.value", [k, v]);
    return changed.length;
  });
}

// ============================ Service rules ============================

export type ServiceRule = {
  key: string; label: string; is_preventive: boolean; interval_months: number | null; interval_km: string | null; interval_hours: string | null; active: boolean; applies_to_classes: string[] | null;
};

export function listServiceRules(driver: Driver, m: Membership): Promise<ServiceRule[]> {
  return authorizedAny(driver, m, ["service.manage", "report.view"], async (q) =>
    (await q.query<ServiceRule>("select key, label, is_preventive, interval_months, interval_km::text, interval_hours::text, active, applies_to_classes from service_types order by active desc, label")).rows);
}

export const serviceRuleSchema = z.object({
  key: z.preprocess(blank, z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).optional()),
  label: z.string().trim().min(2, "Enter the name").max(60),
  is_preventive: z.boolean(),
  interval_months: z.preprocess(blank, z.coerce.number().int("Whole months").min(1, "At least 1").max(120).optional()),
  interval_km: z.preprocess(blank, z.coerce.number().min(1, "At least 1").max(1_000_000).optional()),
  interval_hours: z.preprocess(blank, z.coerce.number().min(1, "At least 1").max(100_000).optional()),
  active: z.boolean(),
  applies_to_classes: z.array(z.enum(VEHICLE_CLASSES)).optional(),
}).refine((r) => r.interval_months != null || r.interval_km != null || r.interval_hours != null, { path: ["interval_months"], message: "Set a time, distance or hours interval, or any of them" });

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

/** New rules get their key from the name. The key never changes afterwards, because job card lines refer to it. */
export async function saveServiceRule(driver: Driver, m: Membership, input: Record<string, unknown>): Promise<string> {
  const r = serviceRuleSchema.safeParse(input);
  if (!r.success) throw new UserError("Fix the highlighted fields.", fieldErrors(r.error));
  const s = r.data;
  return authorized(driver, m, "service.manage", async (q) => {
    const classes = s.applies_to_classes?.length ? s.applies_to_classes : null;
    if (s.key) {
      const done = await q.query(
        "update service_types set label = $2, is_preventive = $3, interval_months = $4, interval_km = $5, active = $6, applies_to_classes = $7, interval_hours = $8 where key = $1 returning key",
        [s.key, s.label, s.is_preventive, s.interval_months ?? null, s.interval_km ?? null, s.active, classes, s.interval_hours ?? null]);
      if (done.rows.length === 0) throw new UserError("Service rule not found.");
      return s.key;
    }
    const key = slug(s.label);
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(key)) throw new UserError("Use letters in the name.", { label: "Use letters" });
    if ((await q.query("select 1 from service_types where key = $1", [key])).rows.length) throw new UserError("A rule with this name already exists.", { label: "Already exists" });
    await q.query("insert into service_types(key, label, is_preventive, interval_months, interval_km, active, applies_to_classes, interval_hours) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [key, s.label, s.is_preventive, s.interval_months ?? null, s.interval_km ?? null, s.active, classes, s.interval_hours ?? null]);
    return key;
  });
}

/** Turns one rule on or off without touching anything else about it. */
export function setServiceRuleActive(driver: Driver, m: Membership, key: string, active: boolean): Promise<void> {
  return authorized(driver, m, "service.manage", async (q) => {
    const r = await q.query("update service_types set active = $2 where key = $1 returning key", [key, active]);
    if (r.rows.length === 0) throw new UserError("Service rule not found.");
  });
}

export type RulesImpact = { label: string; due: number; noHistory: number; vehicles: number } | null;

/**
 * "What the manager sees": with the rules as they are now, how many vehicles are due or overdue for the main routine
 * service, and how many have no history for it. The main service is the oil change if there is one in use, otherwise the
 * first routine rule in use. Computed from the same view the vehicle list uses, so it moves when a rule changes.
 */
export function rulesImpact(driver: Driver, m: Membership): Promise<RulesImpact> {
  return authorizedAny(driver, m, ["service.manage", "report.view"], async (q) => {
    const rule = (await q.query<{ key: string; label: string }>(
      `select key, label from service_types where active and is_preventive order by (key = 'oil_change') desc, label limit 1`)).rows[0];
    if (!rule) return null;
    const c = (await q.query<{ due: number; no_history: number; vehicles: number }>(
      `select count(distinct p.vehicle_id) filter (where p.pm_status in ('overdue','due_soon'))::int as due,
              count(distinct p.vehicle_id) filter (where p.pm_status = 'no_history')::int as no_history,
              (select count(*)::int from vehicles where status in ('active','in_workshop')) as vehicles
         from v_pm_status p join vehicles v on v.id = p.vehicle_id and v.status in ('active','in_workshop')
        where p.service_type_key = $1`, [rule.key])).rows[0];
    return { label: rule.label, due: c.due, noHistory: c.no_history, vehicles: c.vehicles };
  });
}
