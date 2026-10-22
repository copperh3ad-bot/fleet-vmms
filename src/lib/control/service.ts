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

// ============================ Settings ============================

export type SettingView = SettingDef & { value: string; editable: boolean };

export function getSettings(driver: Driver, m: Membership): Promise<SettingView[]> {
  return authorizedAny(driver, m, [...SETTING_PERMISSIONS, "report.view"], async (q, held) => {
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
  key: string; label: string; is_preventive: boolean; interval_months: number | null; interval_km: string | null; active: boolean; applies_to_classes: string[] | null;
};

export function listServiceRules(driver: Driver, m: Membership): Promise<ServiceRule[]> {
  return authorizedAny(driver, m, ["service.manage", "report.view"], async (q) =>
    (await q.query<ServiceRule>("select key, label, is_preventive, interval_months, interval_km::text, active, applies_to_classes from service_types order by active desc, label")).rows);
}

export const serviceRuleSchema = z.object({
  key: z.preprocess(blank, z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).optional()),
  label: z.string().trim().min(2, "Enter the name").max(60),
  is_preventive: z.boolean(),
  interval_months: z.preprocess(blank, z.coerce.number().int("Whole months").min(1, "At least 1").max(120).optional()),
  interval_km: z.preprocess(blank, z.coerce.number().min(1, "At least 1").max(1_000_000).optional()),
  active: z.boolean(),
  applies_to_classes: z.array(z.enum(VEHICLE_CLASSES)).optional(),
}).refine((r) => r.interval_months != null || r.interval_km != null, { path: ["interval_months"], message: "Set a time interval, a distance interval, or both" });

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
        "update service_types set label = $2, is_preventive = $3, interval_months = $4, interval_km = $5, active = $6, applies_to_classes = $7 where key = $1 returning key",
        [s.key, s.label, s.is_preventive, s.interval_months ?? null, s.interval_km ?? null, s.active, classes]);
      if (done.rows.length === 0) throw new UserError("Service rule not found.");
      return s.key;
    }
    const key = slug(s.label);
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(key)) throw new UserError("Use letters in the name.", { label: "Use letters" });
    if ((await q.query("select 1 from service_types where key = $1", [key])).rows.length) throw new UserError("A rule with this name already exists.", { label: "Already exists" });
    await q.query("insert into service_types(key, label, is_preventive, interval_months, interval_km, active, applies_to_classes) values ($1, $2, $3, $4, $5, $6, $7)",
      [key, s.label, s.is_preventive, s.interval_months ?? null, s.interval_km ?? null, s.active, classes]);
    return key;
  });
}
