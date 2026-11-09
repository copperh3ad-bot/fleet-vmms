// Switching the WhatsApp menu on for an organization (ADR-079). The administrator decides, which records who and when; the Pro plan is also needed.
import type { Driver } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";
import { authorized, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { tenantPlan } from "@/lib/billing/plans";

export async function waMenuState(driver: Driver, m: Membership): Promise<{ on: boolean; pro: boolean }> {
  const on = await withPlatform(driver, async (q) => (await q.query<{ on: boolean }>("select wa_menu_enabled as on from public.tenants where id = $1", [m.tenantId])).rows[0]?.on === true);
  return { on, pro: (await tenantPlan(driver, m.tenantId)).whatsappMenu };
}

export async function setWaMenu(driver: Driver, m: Membership, on: boolean): Promise<void> {
  await authorized(driver, m, "admin.users", async () => undefined);
  if (on && !(await tenantPlan(driver, m.tenantId)).whatsappMenu) throw new UserError("The WhatsApp menu is part of the Pro plan.");
  await withPlatform(driver, async (q) => {
    await q.query("update public.tenants set wa_menu_enabled = $2, wa_menu_by = case when $2 then $3::uuid else null end, wa_menu_at = case when $2 then now() else null end where id = $1", [m.tenantId, on, m.userId]);
  });
}
