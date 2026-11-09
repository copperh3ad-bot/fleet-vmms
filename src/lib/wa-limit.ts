// A daily cap on the messages one phone number may send to the Fleet OTG WhatsApp number (ADR-081). Every message that gets past the cap can start work
// (a menu question, a photo stored, an AI reading), so one number cannot run up cost or flood the line. The cap is the owner's setting `wa_daily_messages`
// on Admin > Settings; empty means DEFAULT. The day is the UTC day (the rate-limit buckets of ADR-006 are UTC), which ends at 05:00 in Pakistan.
// Reading the setting must never break the webhook: if it cannot be read, the default applies.
import type { Driver } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";
import { allowShared } from "@/lib/rate-limit";

export const WA_DAILY_KEY = "wa_daily_messages";
export const WA_DAILY_DEFAULT = 100;
const DAY = 86_400;

export async function waDailyLimit(driver: Driver): Promise<number> {
  try {
    const v = await withPlatform(driver, async (q) => (await q.query<{ value: string }>("select value from public.platform_settings where key = $1", [WA_DAILY_KEY])).rows[0]?.value);
    const n = Number((v ?? "").trim());
    return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : WA_DAILY_DEFAULT;
  } catch { return WA_DAILY_DEFAULT; }
}

/**
 * Counts one message from this number. `ok` is false once the cap is passed; `tellOnce` is true for exactly one message a day (the first refused), so the sender is
 * told once and later messages are ignored without a reply.
 */
export async function countWhatsAppMessage(driver: Driver, from: string, limit?: number): Promise<{ ok: boolean; tellOnce: boolean; limit: number }> {
  const cap = limit ?? (await waDailyLimit(driver));
  const ok = await allowShared(driver, `inbound-wa-day:${from}`, cap, DAY);
  if (ok) return { ok, tellOnce: false, limit: cap };
  return { ok, tellOnce: await allowShared(driver, `inbound-wa-day-told:${from}`, 1, DAY), limit: cap };
}
