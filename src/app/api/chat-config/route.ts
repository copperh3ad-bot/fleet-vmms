// The address the support chat button asks for the widget code (ADR-037). The code is public by nature: any site that uses a chat widget puts it in its page source. It is
// read here, not in the root layout, so the public pages stay built ahead of time. It returns only the checked code and one of Zoho's own addresses (src/lib/chat.ts), or nothing,
// and the answer may be cached for a few minutes.
import { getDriver } from "@/lib/db";
import { loadPlatformSettings } from "@/lib/billing/settings";
import { chatConfig } from "@/lib/chat";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

const reply = (body: Record<string, string>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": status === 200 ? "public, max-age=300, s-maxage=300" : "no-store" } });

export async function GET() {
  const driver = getDriver();
  if (!(await allowShared(driver, `chat-config-ip:${await clientIp()}`, 120, 600))) return reply({}, 429);
  const cfg = chatConfig(await loadPlatformSettings(driver).catch(() => ({} as Record<string, string>)));
  return reply(cfg ? { code: cfg.code, host: cfg.host } : {});
}
