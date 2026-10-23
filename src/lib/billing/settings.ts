// Settings the operator edits on the operator screen: where customers send payments, who the invoices are from, the
// PKR rate. They are business details, not secrets, and they live in the control database, not in the repository.
import type { Driver } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";
import { UserError } from "@/lib/master/service";

export type SettingDef = { key: string; label: string; hint: string; multiline?: boolean; max: number; numeric?: boolean };

export const PLATFORM_SETTINGS: SettingDef[] = [
  { key: "bank_details", label: "Bank account for payments", hint: "Shown to customers on their billing page: bank, account title, account number or IBAN, branch. One item per line.", multiline: true, max: 800 },
  { key: "payment_note", label: "Payment instructions", hint: "Anything customers should know when they pay, for example how long a confirmation takes.", multiline: true, max: 600 },
  { key: "pkr_per_usd", label: "PKR per USD", hint: "Used to show the amount to send in rupees next to the dollar price. Leave empty to show dollars only.", max: 12, numeric: true },
  { key: "company_details", label: "Seller details on invoices", hint: "Your company name, address and tax number as they should appear on an invoice. One item per line.", multiline: true, max: 600 },
  { key: "support_email", label: "Support email", hint: "Shown to customers who need help with billing.", max: 120 },
];

export type PlatformSettings = Record<string, string>;

export function loadPlatformSettings(driver: Driver): Promise<PlatformSettings> {
  return withPlatform(driver, async (q) => Object.fromEntries((await q.query<{ key: string; value: string }>("select key, value from public.platform_settings")).rows.map((r) => [r.key, r.value])));
}

/** Checks one setting. Empty clears it. Numbers must be plain positive numbers. */
export function checkPlatformSetting(key: string, raw: string): string {
  const def = PLATFORM_SETTINGS.find((d) => d.key === key);
  if (!def) throw new UserError("Unknown setting.");
  const v = raw.replace(/\r\n/g, "\n").trim();
  if (v.length > def.max) throw new UserError(`${def.label} is too long (at most ${def.max} characters).`, { [key]: "Too long" });
  if (def.numeric && v !== "") {
    if (!/^\d{1,6}(\.\d{1,4})?$/.test(v) || Number(v) <= 0 || Number(v) > 100000) throw new UserError("Enter a number like 280.5.", { [key]: "Enter a number like 280.5" });
  }
  if (key === "support_email" && v !== "" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new UserError("Enter a valid email address.", { [key]: "Enter a valid email address" });
  return v;
}

/** Saved by an operator only (the caller checks); the actor is recorded for the audit log. */
export function savePlatformSetting(driver: Driver, operatorId: string, key: string, raw: string): Promise<void> {
  const value = checkPlatformSetting(key, raw);
  return withPlatform(driver, async (q) => {
    await q.query("select set_config('app.user_id', $1, true)", [operatorId]);
    if (value === "") await q.query("delete from public.platform_settings where key = $1", [key]);
    else await q.query(
      `insert into public.platform_settings(key, value, updated_by) values ($1, $2, $3)
       on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`, [key, value, operatorId]);
  });
}
