// A daily cap on the messages one phone number may send to the Fleet OTG WhatsApp number (ADR-081). Every message that gets past the cap can start work
// (a menu question, a photo stored, an AI reading), so one number cannot run up cost or flood the line.
//
// Two caps, both the owner's settings on Admin > Settings: people registered in a company's Logistics department (an active employee with a login whose role is tied to
// the Logistics department, ADR-048) may send `wa_daily_messages` a day (empty: 100); everyone else, including a number nobody has registered, `wa_daily_messages_other`
// (empty: 10). The day is the UTC day (the rate-limit buckets of ADR-006 are UTC), which ends at 05:00 in Pakistan.
// Reading a setting or looking the sender up must never break the webhook: if either fails, the lower cap applies (the safe side).
import type { Driver } from "@/lib/db/types";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { allowShared } from "@/lib/rate-limit";

export const WA_DAILY_KEY = "wa_daily_messages";                 // people in the Logistics department
export const WA_DAILY_OTHER_KEY = "wa_daily_messages_other";     // everyone else
export const WA_DAILY_DEFAULT = 100;
export const WA_DAILY_OTHER_DEFAULT = 10;
const DAY = 86_400;

async function setting(driver: Driver, key: string, fallback: number): Promise<number> {
  try {
    const v = await withPlatform(driver, async (q) => (await q.query<{ value: string }>("select value from public.platform_settings where key = $1", [key])).rows[0]?.value);
    const n = Number((v ?? "").trim());
    return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : fallback;
  } catch { return fallback; }
}
export const waDailyLimit = (driver: Driver) => setting(driver, WA_DAILY_KEY, WA_DAILY_DEFAULT);
export const waDailyOtherLimit = (driver: Driver) => setting(driver, WA_DAILY_OTHER_KEY, WA_DAILY_OTHER_DEFAULT);

/**
 * Is this number registered in a Logistics department? True when, in any active company, an active employee with a login has this number (last ten digits) and the
 * login's active role is tied to the Logistics department. Department names compare after trimming and ignoring case, as everywhere (ADR-048).
 */
export async function isLogisticsSender(driver: Driver, from: string): Promise<boolean> {
  const digits = from.replace(/\D/g, "").slice(-10);
  if (digits.length < 7) return false;
  try {
    const tenants = await withPlatform(driver, async (q) =>
      (await q.query<{ id: string; schema_name: string }>("select id, schema_name from public.tenants where status = 'active' and provision_state = 'ready' order by created_at limit 200")).rows);
    for (const t of tenants) {
      const users = await withTenant(driver, { schema: t.schema_name, userId: "00000000-0000-0000-0000-000000000000", role: "system" }, async (q) =>
        (await q.query<{ user_id: string }>(
          "select user_id from employees where active and user_id is not null and right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $1 limit 10", [digits])).rows.map((r) => r.user_id));
      if (users.length === 0) continue;
      const roles = await withPlatform(driver, async (q) =>
        (await q.query<{ role: string }>("select role from public.tenant_memberships where tenant_id = $1 and status = 'active' and user_id = any($2::uuid[])", [t.id, users])).rows.map((r) => r.role));
      if (roles.length === 0) continue;
      const hit = await withTenant(driver, { schema: t.schema_name, userId: "00000000-0000-0000-0000-000000000000", role: "system" }, async (q) =>
        (await q.query("select 1 from role_departments where role_key = any($1::text[]) and lower(trim(department)) = 'logistics' limit 1", [roles])).rows.length > 0);
      if (hit) return true;
    }
  } catch { /* the lower cap applies */ }
  return false;
}

/**
 * Counts one message from this number. `ok` is false once the cap is passed; `tellOnce` is true for exactly one message a day (the first refused), so the sender is
 * told once and later messages are ignored without a reply. `limits` lets a caller fix the caps (tests).
 */
export async function countWhatsAppMessage(driver: Driver, from: string): Promise<{ ok: boolean; tellOnce: boolean; limit: number; logistics: boolean }> {
  const logistics = await isLogisticsSender(driver, from);
  const cap = logistics ? await waDailyLimit(driver) : await waDailyOtherLimit(driver);
  const ok = await allowShared(driver, `inbound-wa-day:${from}`, cap, DAY);
  if (ok) return { ok, tellOnce: false, limit: cap, logistics };
  return { ok, tellOnce: await allowShared(driver, `inbound-wa-day-told:${from}`, 1, DAY), limit: cap, logistics };
}
