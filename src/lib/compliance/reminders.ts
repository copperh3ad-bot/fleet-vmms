// Document expiry reminders. Run from scripts/send-reminders.mts by a scheduler (daily is enough); there is no web
// endpoint for it. claim_document_reminders() records each reminder as sent in the same transaction that writes the
// notifications, so a reminder is never sent twice and never lost.
import type { Driver } from "@/lib/db/types";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { loadAccess } from "@/lib/billing/state";
import { notify, usersWithPermission } from "@/lib/notify";
import { DOC_LABEL } from "./schemas";

/** Actor recorded in the audit log for jobs that run without a person. It holds no permissions. */
export const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

export type ReminderRun = { schema: string; sent: number; error?: string };

export async function runDocumentReminders(driver: Driver, today?: string): Promise<ReminderRun[]> {
  const tenants = await withPlatform(driver, async (q) =>
    (await q.query<{ id: string; schema_name: string }>("select id, schema_name from public.tenants where status = 'active' order by created_at")).rows);
  const out: ReminderRun[] = [];
  for (const t of tenants) {
    try {
      if (!(await loadAccess(driver, t.id)).full) continue;      // a locked organization gets no reminders until it is paid up
      const sent = await withTenant(driver, { schema: t.schema_name, userId: SYSTEM_USER, role: "system" }, async (q) => {
        const due = (await q.query<{ entity_type: string; entity_id: string; vehicle_id: string; doc_type: string; reference: string | null; expires_on: string; days_left: number; days_before: number; plate: string; holder_user: string | null }>(
          `select r.entity_type, r.entity_id, r.vehicle_id, r.doc_type, r.reference, r.expires_on::text, r.days_left, r.days_before,
                  v.registration_no as plate,
                  (select e.user_id from vehicle_custody c join employees e on e.id = c.employee_id where c.vehicle_id = r.vehicle_id and c.to_date is null limit 1) as holder_user
             from claim_document_reminders(coalesce($1::date, current_date)) r join vehicles v on v.id = r.vehicle_id`, [today ?? null])).rows;
        // Driving licences (ADR-044): the same days, claimed the same way. The notice never carries the licence number.
        const licences = (await q.query<{ entity_id: string; employee_id: string; expires_on: string; days_left: number; full_name: string; user_id: string | null }>(
          `select r.entity_id, r.employee_id, r.expires_on::text, r.days_left, e.full_name, e.user_id
             from claim_licence_reminders(coalesce($1::date, current_date)) r join employees e on e.id = r.employee_id`, [today ?? null])).rows;
        if (due.length === 0 && licences.length === 0) return 0;
        const managers = await usersWithPermission(q, t.id, "compliance.manage");
        for (const d of due) {
          await notify(q, [...managers, d.holder_user], d.days_left < 0 ? "document.expired" : "document.expiring", {
            entity_type: d.entity_type, entity_id: d.entity_id, vehicle_id: d.vehicle_id, plate: d.plate, doc: DOC_LABEL[d.doc_type] ?? d.doc_type,
            reference: d.reference, expires_on: d.expires_on, days_left: d.days_left,
          }, SYSTEM_USER);
        }
        for (const l of licences) {
          const text = l.days_left < 0 ? `${l.full_name}'s driving licence expired ${-l.days_left} ${-l.days_left === 1 ? "day" : "days"} ago`
            : l.days_left === 0 ? `${l.full_name}'s driving licence expires today` : `${l.full_name}'s driving licence expires in ${l.days_left} ${l.days_left === 1 ? "day" : "days"}`;
          await notify(q, [...managers, l.user_id], l.days_left < 0 ? "licence.expired" : "licence.expiring", {
            entity_type: "driver_licence", entity_id: l.entity_id, employee_id: l.employee_id, expires_on: l.expires_on, days_left: l.days_left, text,
          }, SYSTEM_USER);
        }
        return due.length + licences.length;
      });
      out.push({ schema: t.schema_name, sent });
    } catch (e) {
      out.push({ schema: t.schema_name, sent: 0, error: e instanceof Error ? e.message : String(e) });   // one tenant failing must not stop the rest
    }
  }
  return out;
}
