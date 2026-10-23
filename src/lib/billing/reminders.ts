// Daily notices to an organization's administrators about its trial and subscription (ADR-014): the trial is about to
// end or has ended, a renewal is near, a payment is late or the workspace has locked. Each notice is sent once (the key
// is recorded in billing_reminders in the same transaction that claims it), so running the job twice is harmless. There is
// no email channel yet: the notice appears in the app, and the banner on every page says the same thing.
import type { Driver } from "@/lib/db/types";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { notify, usersWithPermission } from "@/lib/notify";
import { SYSTEM_USER } from "@/lib/compliance/reminders";
import { accessFrom, accessMessage, type BillingRow } from "./state";
import { BILLING_PERMISSION } from "./payments";

export type BillingReminderRun = { schema: string; sent: string | null; error?: string };

type Row = BillingRow & { tenant_id: string; schema_name: string };

/** What, if anything, to say today. The key makes it once per trial, per period, or per lock. */
export function reminderFor(row: BillingRow, now: Date): { key: string; text: string } | null {
  const a = accessFrom(row, now);
  const end = (row.current_period_end ?? "").slice(0, 10);
  switch (a.state) {
    case "trial": return a.daysLeft! <= 1 ? { key: "trial_ending", text: accessMessage(a)!.text + " Subscribe on the Billing page to keep your data and your team's access." } : null;
    case "active": return a.daysLeft! <= 3 ? { key: `renewal:${end}`, text: `Your subscription renews in ${a.daysLeft} ${a.daysLeft === 1 ? "day" : "days"}. Pay from the Billing page before then to avoid a lock.` } : null;
    case "ending": return a.daysLeft! <= 3 ? { key: `ending:${end}`, text: `Your subscription ends in ${a.daysLeft} ${a.daysLeft === 1 ? "day" : "days"}.` } : null;
    case "grace": return { key: `late:${end}`, text: accessMessage(a)!.text };
    case "locked": {
      if (a.lockedReason === "trial_ended") return { key: "trial_ended", text: accessMessage(a)!.text };
      if (a.lockedReason === "payment_overdue") return { key: `locked:${end}`, text: accessMessage(a)!.text };
      return null;
    }
    default: return null;
  }
}

export async function runBillingReminders(driver: Driver, now: Date = new Date()): Promise<BillingReminderRun[]> {
  const rows = await withPlatform(driver, async (q) =>
    (await q.query<Row>(
      `select b.tenant_id, t.schema_name, b.status, b.trial_ends_at::text, b.current_period_end::text, b.grace_days, b.comped, b.suspended, b.price_cents, b.currency
         from public.org_billing b join public.tenants t on t.id = b.tenant_id
        where t.status = 'active' and t.provision_state = 'ready' and not b.comped and not b.suspended order by b.created_at`)).rows);
  const out: BillingReminderRun[] = [];
  for (const r of rows) {
    const todo = reminderFor(r, now);
    if (!todo) continue;
    try {
      // Claim it first. If the claim was already there, someone has been told.
      const claimed = await withPlatform(driver, async (q) =>
        (await q.query("insert into public.billing_reminders(tenant_id, key) values ($1, $2) on conflict do nothing returning key", [r.tenant_id, todo.key])).rows.length > 0);
      if (!claimed) continue;
      await withTenant(driver, { schema: r.schema_name, userId: SYSTEM_USER, role: "system" }, async (q) => {
        await notify(q, await usersWithPermission(q, r.tenant_id, BILLING_PERMISSION), "billing.reminder", { text: todo.text, key: todo.key }, SYSTEM_USER);
      });
      out.push({ schema: r.schema_name, sent: todo.key });
    } catch (e) {
      out.push({ schema: r.schema_name, sent: null, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
