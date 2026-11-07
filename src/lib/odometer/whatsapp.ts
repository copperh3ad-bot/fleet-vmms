// The monthly odometer request on WhatsApp, answered by a reply (ADR-050). Two halves:
//  - runOdometerWhatsApp: run by the daily scheduler. For each organization that has switched it on, opens this month's cycle on the send day and sends each holder one
//    message from the Fleet OTG number (and one reminder later). Vehicles with an hour meter are left out; they use the link.
//  - processOdometerReply: run by the WhatsApp webhook. Finds the request a reply answers (WhatsApp's "reply" gives us that message's id), reads a number, and files it as a
//    submission for review, only if it came from the holder's own phone number. It never approves a reading and never moves an odometer.
// Nothing here logs a phone number, a message or a reading.
import type { Driver } from "@/lib/db/types";
import { withLinkContext, withPlatform, withTenant } from "@/lib/db/tenant";
import { loadAccess } from "@/lib/billing/state";
import { findTenantByToken, routeToken } from "@/lib/orgs";
import { normalizePhone } from "@/lib/phone";
import { SYSTEM_USER } from "@/lib/compliance/reminders";
import { sendWhatsAppOdometerRequest, whatsappOdometerConfigured, type InboundMessage } from "@/lib/whatsapp";
import { waReplyHash } from "@/lib/vendorflow/whatsapp-inbound";

export const REMINDER_AFTER_DAYS = 3;
const MAX_PER_RUN = 500;
const ROUTE_DAYS = 45;

export type OdometerWaRun = { schema: string; opened: boolean; sent: number; reminded: number; failed: number; error?: string };

const monthLabel = (d: Date) => d.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** Sends this month's requests and reminders for every organization that has switched the feature on. Safe to run more than once a day. */
export async function runOdometerWhatsApp(driver: Driver, now = new Date(), send = sendWhatsAppOdometerRequest): Promise<OdometerWaRun[]> {
  if (!whatsappOdometerConfigured()) return [];
  const tenants = await withPlatform(driver, async (q) =>
    (await q.query<{ id: string; schema_name: string }>("select id, schema_name from public.tenants where status = 'active' order by created_at")).rows);
  const out: OdometerWaRun[] = [];
  for (const t of tenants) {
    const run: OdometerWaRun = { schema: t.schema_name, opened: false, sent: 0, reminded: 0, failed: 0 };
    try {
      await (async () => {
      if (!(await loadAccess(driver, t.id)).full) return;
      const as = { schema: t.schema_name, userId: SYSTEM_USER, role: "system" };
      const cfg = await withTenant(driver, as, async (q) => {
        const rows = (await q.query<{ key: string; value: string }>("select key, value from settings where key in ('odometer_whatsapp', 'odometer_send_day', 'odometer_due_day')")).rows;
        return Object.fromEntries(rows.map((r) => [r.key, r.value]));
      });
      if (cfg.odometer_whatsapp !== "1") return;
      const sendDay = Math.min(28, Math.max(1, Number(cfg.odometer_send_day) || 1));
      if (now.getUTCDate() < sendDay) return;
      const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
      const dueDay = Math.min(28, Math.max(1, Number(cfg.odometer_due_day) || 25));
      const due = `${period.slice(0, 8)}${String(Math.max(dueDay, sendDay)).padStart(2, "0")}`;

      // The cycle for this month: opened here if nobody opened it yet.
      const cycle = await withTenant(driver, as, async (q) => {
        const found = (await q.query<{ id: string; status: string }>("select id, status from odometer_cycles where period = $1::date", [period])).rows[0];
        if (found) return found.status === "open" ? found.id : null;
        run.opened = true;
        return (await q.query<{ id: string }>("select open_odometer_cycle($1::date, $2::date, null) as id", [period, due])).rows[0].id;
      });
      if (!cycle) return;

      // Who still has to be asked, and who has to be reminded. Hour-meter vehicles are not asked here.
      const todo = await withTenant(driver, as, async (q) =>
        (await q.query<{ id: string; plate: string; name: string; phone: string; kind: "request" | "reminder" }>(
          `select s.id, v.registration_no as plate, e.full_name as name, e.phone,
                  case when not exists (select 1 from odometer_wa_messages w where w.submission_id = s.id) then 'request' else 'reminder' end as kind
             from odometer_submissions s
             join vehicles v on v.id = s.vehicle_id and not v.tracks_hours
             join employees e on e.id = s.assigned_to and e.active and coalesce(btrim(e.phone), '') <> ''
            where s.cycle_id = $1 and s.status in ('pending', 'rejected')
              and (not exists (select 1 from odometer_wa_messages w where w.submission_id = s.id)
                   or (not exists (select 1 from odometer_wa_messages w where w.submission_id = s.id and w.kind = 'reminder')
                       and (select max(w.sent_at) from odometer_wa_messages w where w.submission_id = s.id) < $2::timestamptz - ($3 || ' days')::interval))
            order by v.registration_no limit ${MAX_PER_RUN}`, [cycle, now.toISOString(), String(REMINDER_AFTER_DAYS)])).rows);

      for (const j of todo) {
        const phone = normalizePhone(j.phone);
        if (!phone.ok) { run.failed++; continue; }
        try {
          const wamid = await send(phone.e164, { name: j.name, plate: j.plate, month: monthLabel(now), reminder: j.kind === "reminder" });
          const hash = waReplyHash(wamid);
          // route first: a reply that arrives before the row is saved still finds its organization, and a row without a route only hides itself
          await routeToken(driver, "odoreply", t.id, hash, new Date(now.getTime() + ROUTE_DAYS * 864e5).toISOString());
          await withTenant(driver, as, (q) => q.query("insert into odometer_wa_messages(hash, submission_id, kind) values ($1, $2, $3) on conflict do nothing", [hash, j.id, j.kind]));
          if (j.kind === "request") run.sent++; else run.reminded++;
        } catch (e) {
          run.failed++;
          console.error(`odometer whatsapp: a message could not be sent: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);          // never the number or the name
        }
      }
      })();
    } catch (e) {
      run.error = e instanceof Error ? e.message.slice(0, 160) : "unknown";
    }
    out.push(run);
  }
  return out;
}

/** Reads a reply as a reading: only a number, with an optional "km". Anything else is not a reading. */
export function parseReading(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s*(kms?|kilomet(?:re|er)s?)\.?$/, "").replace(/[,\s]/g, "");
  return /^\d{1,7}(\.\d)?$/.test(t) ? Number(t) : null;
}

export type OdometerReplyOutcome = { handled: false } | { handled: true; reply: string | null };

/** A reply to one of our odometer requests, or `handled: false` for any other message (the webhook then tries workshop replies). */
export async function processOdometerReply(driver: Driver, msg: InboundMessage): Promise<OdometerReplyOutcome> {
  if (!msg.contextId) return { handled: false };
  const hash = waReplyHash(msg.contextId);
  const tenant = await findTenantByToken(driver, "odoreply", hash);
  if (!tenant) return { handled: false };
  const reading = msg.media.length ? null : parseReading(msg.text);
  const r = await withLinkContext(driver, tenant.schema, async (q) =>
    (await q.query<{ outcome: string; plate: string | null }>("select outcome, plate from file_odometer_reply($1, $2, $3::numeric)", [hash, msg.from, reading])).rows[0], "inbound_mail");
  switch (r?.outcome) {
    case "ok": return { handled: true, reply: `Thank you. We have your reading of ${reading!.toLocaleString("en-US", { maximumFractionDigits: 1 })} km for ${r.plate}. The fleet office will check it.` };
    case "bad_value": return { handled: true, reply: "We could not read that. Please reply to our message with the odometer as a number only, like 48210." };
    case "not_open": return { handled: true, reply: `We already have a reading for ${r.plate} this month, or the month is closed. Ask your fleet office if it needs to change.` };
    default: return { handled: true, reply: null };          // unknown, or not the holder's number: say nothing
  }
}
