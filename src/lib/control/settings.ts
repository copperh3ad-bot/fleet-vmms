// The settings the screens may change. The database accepts only these keys and valid values (settings_guard);
// this table says who may change which one and how to describe it.
export type SettingGroup = "service" | "alerts" | "general" | "policy";

export type SettingDef = { key: string; label: string; hint: string; group: SettingGroup; permission: string; kind: "number" | "list"; unit?: string; min?: number; max?: number; /** may be left empty, which means "not set" */ optional?: boolean };

export const SETTINGS: SettingDef[] = [
  { key: "pm_warning_days", label: "Service due warning (days)", hint: "Show a service as due soon this many days before its date.", group: "service", permission: "service.manage", kind: "number", unit: "days", min: 0, max: 365 },
  { key: "pm_warning_km", label: "Service due warning (km)", hint: "Show a service as due soon this many km before its distance.", group: "service", permission: "service.manage", kind: "number", unit: "km", min: 0, max: 100000 },
  { key: "pm_warning_hours", label: "Service due warning (engine hours)", hint: "Show an hours-based service as due soon this many hours before it is due.", group: "service", permission: "service.manage", kind: "number", unit: "hours", min: 0, max: 10000 },
  { key: "budget_warn_pct", label: "Budget warning at", hint: "Flag a budget as near its limit at this percent used.", group: "alerts", permission: "budget.manage", kind: "number", unit: "%", min: 1, max: 1000 },
  { key: "budget_flag_pct", label: "Budget over limit at", hint: "Flag a budget as over at this percent used.", group: "alerts", permission: "budget.manage", kind: "number", unit: "%", min: 1, max: 1000 },
  { key: "flag_jobs_90d", label: "Too many jobs", hint: "Flag a vehicle with this many job cards or more in 90 days.", group: "alerts", permission: "budget.manage", kind: "number", unit: "jobs", min: 1, max: 100 },
  { key: "flag_repeat_days", label: "Repeat repair window", hint: "The same fault on the same vehicle within this many days counts as a repeat. Routine service never does.", group: "alerts", permission: "budget.manage", kind: "number", unit: "days", min: 1, max: 730 },
  { key: "flag_cost_multiple", label: "Cost compared with similar vehicles", hint: "Flag a vehicle whose 12-month cost is this many times the median of the same make and model (needs 3 or more of them).", group: "alerts", permission: "budget.manage", kind: "number", unit: "times", min: 1, max: 100 },
  { key: "doc_reminder_days", label: "Document reminders", hint: "Days before expiry to remind, separated by commas, for example 60,30,14. An expiry notice is always sent.", group: "general", permission: "admin.settings", kind: "list" },
  { key: "odometer_due_day", label: "Odometer due day", hint: "Day of the month readings are due.", group: "general", permission: "admin.settings", kind: "number", min: 1, max: 31 },
  { key: "allow_learner_licence", label: "Accept learner driving licences", hint: "1 lets people with a learner's permit be invited or join. 0 (the default) accepts full licences only. Everyone needs a licence that has not expired.", group: "general", permission: "admin.settings", kind: "number", min: 0, max: 1 },
  { key: "odometer_whatsapp", label: "Ask for odometer readings on WhatsApp", hint: "1 sends each holder a WhatsApp message every month and takes their reply as the reading. 0 switches it off. Vehicles with an hour meter are left out.", group: "general", permission: "admin.settings", kind: "number", min: 0, max: 1 },
  { key: "odometer_send_day", label: "WhatsApp request day", hint: "Day of the month (1 to 28) the request is sent.", group: "general", permission: "admin.settings", kind: "number", min: 1, max: 28 },
  { key: "odometer_max_km_per_day", label: "Most km a vehicle can do in a day", hint: "A reading implying more than this is flagged for review.", group: "general", permission: "admin.settings", kind: "number", unit: "km", min: 1, max: 5000 },
  { key: "odometer_stale_days", label: "Odometer is old after", hint: "Distance-based service dates are marked unreliable when the last reading is older than this.", group: "general", permission: "admin.settings", kind: "number", unit: "days", min: 1, max: 365 },
  { key: "module_trips", label: "Trips and vehicle requests", hint: "1 switches on trip requests, approval and the Trips menu. 0 switches them off; nothing is deleted.", group: "general", permission: "admin.settings", kind: "number", min: 0, max: 1 },
  { key: "dept_approval_limit", label: "Most a department may approve itself", hint: "The most a job card estimate or a quotation can be for the logistics department to approve it on its own vehicles. Above it a fleet manager must approve. Leave empty for no limit; 0 means logistics approves nothing itself. In your company currency.", group: "general", permission: "admin.settings", kind: "number", unit: "amount", min: 0, max: 1000000000, optional: true },
  { key: "policy_replace_years", label: "Replace a vehicle after", hint: "Flag a vehicle as due for replacement when its model year is this many years back or more. 0 switches the rule off.", group: "policy", permission: "policy.manage", kind: "number", unit: "years", min: 0, max: 40 },
  { key: "policy_free_accidents", label: "Accidents the company absorbs per driver", hint: "A driver's first accidents up to this number are covered by the company. After that the driver bears the depreciation. 0 switches the rule off.", group: "policy", permission: "policy.manage", kind: "number", unit: "accidents", min: 0, max: 20 },
  { key: "policy_accident_gap_months", label: "Months between covered accidents", hint: "An accident is covered only if at least this many months passed since the driver's previous accident.", group: "policy", permission: "policy.manage", kind: "number", unit: "months", min: 0, max: 120 },
  { key: "policy_driver_share_pct", label: "Driver's share of repairs", hint: "Percent of a repair the driver bears. Routine service, wear items (brake pads, tyres) and accident repairs are not counted. 0 switches the rule off.", group: "policy", permission: "policy.manage", kind: "number", unit: "%", min: 0, max: 100 },
];

export const SETTING_PERMISSIONS = [...new Set(SETTINGS.map((s) => s.permission))];

/** Checks a typed value against its definition and returns the cleaned text, or a message to show. */
export function checkSetting(def: SettingDef, raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const v = raw.trim().replace(/\s+/g, "");
  if (def.optional && v === "") return { ok: true, value: "" };
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
