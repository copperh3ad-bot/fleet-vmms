// Daily reminders: documents and driving licences that are expiring or expired (ADR-044), and periodic maintenance that is due soon or overdue (ADR-062).
// Run from scripts/send-reminders.mts and the Netlify scheduled function by a scheduler (daily is enough); there is no web endpoint for it. Each reminder is
// recorded as claimed in the same transaction that writes its notifications, so a reminder is never sent twice and never lost. Where a mail service is set up
// (SMTP_URL and EMAIL_FROM), each person who has an email address on their employee record also gets ONE email a day listing everything new for them.
import type { Driver, Queryable } from "@/lib/db/types";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { loadAccess } from "@/lib/billing/state";
import { notify, usersWithPermission } from "@/lib/notify";
import { emailConfigured, mailFailure, sendMail } from "@/lib/email/send";
import type { Mail } from "@/lib/email/templates";
import { shell } from "@/lib/billing/payment-mails";
import { SITE_URL } from "@/lib/site";
import { dmy } from "@/lib/format/date";
import { DOC_LABEL } from "./schemas";

/** Actor recorded in the audit log for jobs that run without a person. It holds no permissions. */
export const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

export type ReminderRun = { schema: string; sent: number; emailed?: number; error?: string };

const MAX_LINES_PER_EMAIL = 40;
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** Who is told what today, collected while the notices are written, so each person gets one email. */
type Digest = Map<string, string[]>;
function tell(digest: Digest, users: (string | null | undefined)[], line: string) {
  for (const u of new Set(users.filter((x): x is string => !!x))) digest.set(u, [...(digest.get(u) ?? []), line]);
}

/** One email for one person: everything that needs their attention, newest first, with a link to the notices. Never carries a licence number. */
export function buildReminderMail(to: string, name: string, org: string, slug: string, lines: string[]): Mail {
  const shown = lines.slice(0, MAX_LINES_PER_EMAIL);
  const more = lines.length - shown.length;
  return shell({
    to, subject: `Fleet OTG reminders for ${org}: ${lines.length} ${lines.length === 1 ? "item needs" : "items need"} attention`,
    title: "Reminders", intro: `${name}, these need attention at ${org}.`,
    rows: shown.map((l, i): [string, string] => [String(i + 1), l]),
    cta: { label: "Open your notices", url: `${SITE_URL}/w/${encodeURIComponent(slug)}/notifications` },
    outro: more > 0 ? `And ${more} more. They are all in your notices.` : "You get this email only when something new is due. The same reminders are in your notices in the app.",
  });
}

export async function runDocumentReminders(driver: Driver, today?: string): Promise<ReminderRun[]> {
  const tenants = await withPlatform(driver, async (q) =>
    (await q.query<{ id: string; schema_name: string; name: string; slug: string }>("select id, schema_name, name, slug from public.tenants where status = 'active' order by created_at")).rows);
  const out: ReminderRun[] = [];
  for (const t of tenants) {
    try {
      if (!(await loadAccess(driver, t.id)).full) continue;      // a locked organization gets no reminders until it is paid up
      const as = { schema: t.schema_name, userId: SYSTEM_USER, role: "system" };
      const digest: Digest = new Map();
      let mails: Mail[] = [];
      const sent = await withTenant(driver, as, async (q) => {
        const n = (await documentAndLicenceReminders(q, t.id, today, digest)) + (await maintenanceReminders(q, t.id, digest));
        if (n > 0 && emailConfigured()) mails = await mailsFor(q, digest, t.name, t.slug);
        return n;
      });
      // Sent after the transaction has committed: a slow mail service must never hold the database, and a failed email never undoes a notice.
      let emailed = 0;
      for (const m of mails) {
        try { await sendMail(m); emailed++; } catch (e) { console.error(`reminder email failed: ${mailFailure(e)}`); }
      }
      out.push({ schema: t.schema_name, sent, emailed });
    } catch (e) {
      out.push({ schema: t.schema_name, sent: 0, error: e instanceof Error ? e.message : String(e) });   // one tenant failing must not stop the rest
    }
  }
  return out;
}

async function mailsFor(q: Queryable, digest: Digest, org: string, slug: string): Promise<Mail[]> {
  if (digest.size === 0) return [];
  const people = (await q.query<{ user_id: string; email: string; full_name: string }>(
    "select user_id, email, full_name from employees where active and email is not null and trim(email) <> '' and user_id = any($1::uuid[])", [[...digest.keys()]])).rows;
  return people.map((p) => buildReminderMail(p.email.trim(), p.full_name, org, slug, digest.get(p.user_id) ?? []));
}

async function documentAndLicenceReminders(q: Queryable, tenantId: string, today: string | undefined, digest: Digest): Promise<number> {
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
  const managers = await usersWithPermission(q, tenantId, "compliance.manage");
  for (const d of due) {
    await notify(q, [...managers, d.holder_user], d.days_left < 0 ? "document.expired" : "document.expiring", {
      entity_type: d.entity_type, entity_id: d.entity_id, vehicle_id: d.vehicle_id, plate: d.plate, doc: DOC_LABEL[d.doc_type] ?? d.doc_type,
      reference: d.reference, expires_on: d.expires_on, days_left: d.days_left,
    }, SYSTEM_USER);
    const doc = DOC_LABEL[d.doc_type] ?? d.doc_type;
    tell(digest, [...managers, d.holder_user], `${d.plate}: ${doc} ${d.days_left < 0 ? `expired ${days(-d.days_left)} ago` : d.days_left === 0 ? "expires today" : `expires in ${days(d.days_left)}`} (${dmy(d.expires_on)})`);
  }
  for (const l of licences) {
    const text = l.days_left < 0 ? `${l.full_name}'s driving licence expired ${days(-l.days_left)} ago`
      : l.days_left === 0 ? `${l.full_name}'s driving licence expires today` : `${l.full_name}'s driving licence expires in ${days(l.days_left)}`;
    await notify(q, [...managers, l.user_id], l.days_left < 0 ? "licence.expired" : "licence.expiring", {
      entity_type: "driver_licence", entity_id: l.entity_id, employee_id: l.employee_id, expires_on: l.expires_on, days_left: l.days_left, text,
    }, SYSTEM_USER);
    tell(digest, [...managers, l.user_id], text);
  }
  return due.length + licences.length;
}

/** Periodic maintenance that has become due soon or overdue (ADR-062): the person holding the vehicle and the people who manage service rules are told. */
async function maintenanceReminders(q: Queryable, tenantId: string, digest: Digest): Promise<number> {
  // An organization whose database has not had migration 0036 yet simply has no maintenance reminders until it does; its other reminders still go.
  if (!(await q.query<{ ok: boolean }>("select to_regprocedure('claim_pm_reminders()') is not null as ok")).rows[0]?.ok) return 0;
  const rows = (await q.query<{ vehicle_id: string; registration_no: string; service_type_key: string; label: string; stage: string; due_on: string | null; days_remaining: number | null; km_remaining: string | null; custodian_user: string | null }>(
    "select vehicle_id, registration_no, service_type_key, label, stage, due_on::text, days_remaining, km_remaining::text, custodian_user from claim_pm_reminders()")).rows;
  if (rows.length === 0) return 0;
  const managers = await usersWithPermission(q, tenantId, "service.manage");
  for (const r of rows) {
    const km = r.km_remaining !== null ? Number(r.km_remaining) : null;
    const left = [r.due_on ? `by ${dmy(r.due_on)}` : null, km !== null && km >= 0 ? `or within ${Math.round(km).toLocaleString("en-US")} km` : null].filter(Boolean).join(" ");
    const text = r.stage === "overdue" ? `${r.registration_no}: ${r.label} is overdue` : `${r.registration_no}: ${r.label} is due${left ? ` ${left}` : " soon"}`;
    await notify(q, [...managers, r.custodian_user], r.stage === "overdue" ? "service.overdue" : "service.due", {
      vehicle_id: r.vehicle_id, plate: r.registration_no, service: r.label, service_key: r.service_type_key, due_on: r.due_on, text,
    }, SYSTEM_USER);
    tell(digest, [...managers, r.custodian_user], text);
  }
  return rows.length;
}
