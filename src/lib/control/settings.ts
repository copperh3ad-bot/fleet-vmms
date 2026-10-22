// The settings the screens may change. The database accepts only these keys and valid values (settings_guard);
// this table says who may change which one and how to describe it.
export type SettingGroup = "service" | "alerts" | "general";

export type SettingDef = { key: string; label: string; hint: string; group: SettingGroup; permission: string; kind: "number" | "list"; unit?: string; min?: number; max?: number };

export const SETTINGS: SettingDef[] = [
  { key: "pm_warning_days", label: "Service due warning (days)", hint: "Show a service as due soon this many days before its date.", group: "service", permission: "service.manage", kind: "number", unit: "days", min: 0, max: 365 },
  { key: "pm_warning_km", label: "Service due warning (km)", hint: "Show a service as due soon this many km before its distance.", group: "service", permission: "service.manage", kind: "number", unit: "km", min: 0, max: 100000 },
  { key: "budget_warn_pct", label: "Budget warning at", hint: "Flag a budget as near its limit at this percent used.", group: "alerts", permission: "budget.manage", kind: "number", unit: "%", min: 1, max: 1000 },
  { key: "budget_flag_pct", label: "Budget over limit at", hint: "Flag a budget as over at this percent used.", group: "alerts", permission: "budget.manage", kind: "number", unit: "%", min: 1, max: 1000 },
  { key: "flag_jobs_90d", label: "Too many jobs", hint: "Flag a vehicle with this many job cards or more in 90 days.", group: "alerts", permission: "budget.manage", kind: "number", unit: "jobs", min: 1, max: 100 },
  { key: "flag_repeat_days", label: "Repeat repair window", hint: "The same fault on the same vehicle within this many days counts as a repeat. Routine service never does.", group: "alerts", permission: "budget.manage", kind: "number", unit: "days", min: 1, max: 730 },
  { key: "flag_cost_multiple", label: "Cost compared with similar vehicles", hint: "Flag a vehicle whose 12-month cost is this many times the median of the same make and model (needs 3 or more of them).", group: "alerts", permission: "budget.manage", kind: "number", unit: "times", min: 1, max: 100 },
  { key: "doc_reminder_days", label: "Document reminders", hint: "Days before expiry to remind, separated by commas, for example 60,30,14. An expiry notice is always sent.", group: "general", permission: "admin.settings", kind: "list" },
  { key: "odometer_due_day", label: "Odometer due day", hint: "Day of the month readings are due.", group: "general", permission: "admin.settings", kind: "number", min: 1, max: 31 },
  { key: "odometer_max_km_per_day", label: "Most km a vehicle can do in a day", hint: "A reading implying more than this is flagged for review.", group: "general", permission: "admin.settings", kind: "number", unit: "km", min: 1, max: 5000 },
  { key: "odometer_stale_days", label: "Odometer is old after", hint: "Distance-based service dates are marked unreliable when the last reading is older than this.", group: "general", permission: "admin.settings", kind: "number", unit: "days", min: 1, max: 365 },
];

export const SETTING_PERMISSIONS = [...new Set(SETTINGS.map((s) => s.permission))];

/** Checks a typed value against its definition and returns the cleaned text, or a message to show. */
export function checkSetting(def: SettingDef, raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const v = raw.trim().replace(/\s+/g, "");
  if (def.kind === "list") {
    if (!/^\d+(,\d+)*$/.test(v)) return { ok: false, message: "Use numbers separated by commas, like 60,30,14" };
    const nums = [...new Set(v.split(",").map(Number))];
    if (nums.some((n) => n < 1 || n > 730)) return { ok: false, message: "Each number must be between 1 and 730" };
    return { ok: true, value: nums.sort((a, b) => b - a).join(",") };
  }
  if (!/^\d+(\.\d+)?$/.test(v)) return { ok: false, message: "Enter a number" };
  const n = Number(v);
  if (def.min !== undefined && n < def.min) return { ok: false, message: `Must be at least ${def.min}` };
  if (def.max !== undefined && n > def.max) return { ok: false, message: `Must be at most ${def.max}` };
  return { ok: true, value: String(n) };
}
