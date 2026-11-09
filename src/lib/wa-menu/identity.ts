// Who is writing to the Fleet OTG WhatsApp number (ADR-079): an active employee with a login, found by phone number in the organizations that switched the menu on and have the Pro
// plan. Only the last ten digits are compared, so 0300 1234567 and +92 300 1234567 match. Two employees with one number in one company are never guessed.
import type { Driver } from "@/lib/db/types";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import type { ActiveTenant } from "@/lib/auth/can";
import { tenantPlan } from "@/lib/billing/plans";
import { loadAccess } from "@/lib/billing/state";
import type { Candidate } from "./types";

export const lastTen = (e164: string) => e164.replace(/\D/g, "").slice(-10);

/** Is the menu available to this organization? The administrator switched it on, the plan includes it (Pro) and the subscription is live. */
export async function waMenuOffered(driver: Driver, tenantId: string): Promise<boolean> {
  const on = await withPlatform(driver, async (q) => (await q.query<{ on: boolean }>("select wa_menu_enabled as on from public.tenants where id = $1", [tenantId])).rows[0]?.on === true);
  return on && (await tenantPlan(driver, tenantId)).whatsappMenu && (await loadAccess(driver, tenantId)).full;
}

export async function findMenuSender(driver: Driver, from: string): Promise<{ found: Candidate[]; shared: boolean }> {
  const digits = lastTen(from);
  if (digits.length < 7) return { found: [], shared: false };
  const tenants = await withPlatform(driver, async (q) =>
    (await q.query<{ id: string; schema_name: string; name: string; currency: string | null }>(
      "select id, schema_name, name, currency from public.tenants where wa_menu_enabled and status = 'active' and provision_state = 'ready' order by created_at limit 200")).rows);
  const found: Candidate[] = [];
  let shared = false;
  for (const t of tenants) {
    const tenant: ActiveTenant = { id: t.id, schema: t.schema_name, name: t.name, currency: t.currency ?? undefined };
    const rows = await withTenant(driver, { schema: t.schema_name, userId: "00000000-0000-0000-0000-000000000000", role: "system" }, async (q) =>
      (await q.query<{ id: string; user_id: string; full_name: string }>(
        `select id, user_id, full_name from employees where active and user_id is not null and right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $1 limit 2`, [digits])).rows);
    if (rows.length === 0) continue;
    if (rows.length > 1) { shared = true; continue; }                  // one number, two people: never guess
    if (!(await waMenuOffered(driver, t.id))) continue;
    found.push({ tenant, employeeId: rows[0].id, userId: rows[0].user_id, name: rows[0].full_name });
  }
  return { found, shared };
}
