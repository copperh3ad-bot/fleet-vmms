// One phone number belongs to one organization at a time (ADR-082). WhatsApp tells us only the number a message came from, so a number on the records of two companies could
// never be told apart safely. A number is "in" an organization while an ACTIVE employee record there holds it (last ten digits compared, as in ADR-079); marking that
// employee inactive releases it. Several people of the SAME organization may still share a number (the menu asks who is writing, ADR-079).
import type { Driver } from "@/lib/db/types";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { UserError } from "@/lib/master/service";

export const PHONE_IN_OTHER_ORG = "This phone number is already registered with another organization. A number can belong to one organization at a time.";

const lastTen = (s: string) => s.replace(/\D/g, "").slice(-10);

/** Is this number held by an active employee of any organization other than `tenantId`? */
export async function phoneInOtherOrganization(driver: Driver, tenantId: string, phone: string): Promise<boolean> {
  const digits = lastTen(phone);
  if (digits.length < 7) return false;
  const tenants = await withPlatform(driver, async (q) =>
    (await q.query<{ schema_name: string }>("select schema_name from public.tenants where id <> $1 and status = 'active' and provision_state = 'ready' limit 500", [tenantId])).rows);
  for (const t of tenants) {
    const found = await withTenant(driver, { schema: t.schema_name, userId: "00000000-0000-0000-0000-000000000000", role: "system" }, async (q) =>
      (await q.query("select 1 from employees where active and right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $1 limit 1", [digits])).rows.length > 0);
    if (found) return true;
  }
  return false;
}

/** Refuses a number that another organization holds. `field` names the form box to mark. */
export async function assertPhoneFree(driver: Driver, tenantId: string, phone: string | null | undefined, field = "phone"): Promise<void> {
  if (!phone || !phone.trim()) return;
  if (await phoneInOtherOrganization(driver, tenantId, phone)) throw new UserError(PHONE_IN_OTHER_ORG, { [field]: "Already registered with another organization" });
}
