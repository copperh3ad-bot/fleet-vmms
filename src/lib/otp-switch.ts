// The beta-testing switch for the WhatsApp one-time codes (ADR-076). The operator sets `otp_checks` to `off` on Admin > Settings to stop asking for the code when someone
// opens an invitation or joins with a company code; empty or `on` asks for it, as always. It is a stored setting, not an environment value, so it changes at once and
// changes back with no deploy. Reading it must never break a page: if the setting cannot be read, the codes stay on (the safe side).
import type { Driver } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";

export const OTP_CHECKS_KEY = "otp_checks";

/** True when the value asks for the codes to be skipped. Only the word "off" does. */
export const otpOffValue = (value: string | null | undefined) => (value ?? "").trim().toLowerCase() === "off";

/** Are one-time codes asked for right now? */
export async function otpChecksOn(driver: Driver): Promise<boolean> {
  try {
    const v = await withPlatform(driver, async (q) => (await q.query<{ value: string }>("select value from public.platform_settings where key = $1", [OTP_CHECKS_KEY])).rows[0]?.value);
    return !otpOffValue(v);
  } catch { return true; }
}
