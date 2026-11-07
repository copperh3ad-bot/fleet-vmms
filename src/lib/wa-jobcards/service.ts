// Raising a job card by WhatsApp (ADR-061, V1.1, a Pro feature). An employee sends one message about a vehicle problem; the AI turns it into a DRAFT; the sender
// replies YES and the card is created through the one existing function (createJobCard) with the sender's own role, as Requested. Nothing here approves, moves or
// closes anything: every later step stays in the app. Run by the WhatsApp webhook (src/app/api/inbound/whatsapp/route.ts).
// Never logs a phone number, a message, a photo or an answer from the AI.
import type { Driver, Queryable } from "@/lib/db/types";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { authorized, can, membershipIn, type ActiveTenant, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { createJobCard } from "@/lib/jobcards/service";
import { aiConfigured, readJobCardMessage, type AiFile, type CreateMessage } from "@/lib/ai/claude";
import type { JobCardDraft } from "@/lib/ai/jobcard-draft";
import { REASON_CATEGORY } from "@/lib/labels";
import { tenantPlan } from "@/lib/billing/plans";
import { loadAccess } from "@/lib/billing/state";
import { allowShared } from "@/lib/rate-limit";
import type { InboundMessage } from "@/lib/whatsapp";

export const MAX_PHOTOS = 3;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_ROUNDS = 3;
export const MESSAGES_PER_HOUR = 20;
export const DRAFTS_PER_DAY = 10;
const HOUR = 3600, DAY = 86_400;
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const YES = /^(yes|y|ok|okay|confirm|send|haan|han|ji|ji haan)[.! ]*$/i;
const NO = /^(no|n|cancel|stop|nahi|nahin)[.! ]*$/i;

export type IntakeDeps = {
  fetchMedia: (id: string, maxBytes: number) => Promise<{ bytes: Uint8Array; mime: string | null }>;
  store: (path: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  newId: () => string;
  create?: CreateMessage;
};
export type IntakeOutcome = { handled: boolean; reply: string | null };
const said = (reply: string): IntakeOutcome => ({ handled: true, reply });
const NOT_MINE: IntakeOutcome = { handled: false, reply: null };

// ---------- Switching it on ----------

/** Is raising job cards by WhatsApp available to this organization? The server has the AI, the plan includes it (Pro), the administrator switched it on and the subscription is live. */
export async function waJobCardsOffered(driver: Driver, tenantId: string): Promise<boolean> {
  if (!aiConfigured()) return false;
  const on = await withPlatform(driver, async (q) => (await q.query<{ on: boolean }>("select wa_jobcards_enabled as on from public.tenants where id = $1", [tenantId])).rows[0]?.on === true);
  return on && (await tenantPlan(driver, tenantId)).aiDocuments && (await loadAccess(driver, tenantId)).full;
}

export async function waJobCardsState(driver: Driver, m: Membership): Promise<{ on: boolean; pro: boolean; configured: boolean }> {
  const on = await withPlatform(driver, async (q) => (await q.query<{ on: boolean }>("select wa_jobcards_enabled as on from public.tenants where id = $1", [m.tenantId])).rows[0]?.on === true);
  return { on, pro: (await tenantPlan(driver, m.tenantId)).aiDocuments, configured: aiConfigured() };
}

/** The organization's administrator switches it on or off. Switching on needs the Pro plan and records who and when: the messages and photos go to the AI provider. */
export async function setWaJobCards(driver: Driver, m: Membership, on: boolean): Promise<void> {
  await authorized(driver, m, "admin.users", async () => undefined);
  if (on && !(await tenantPlan(driver, m.tenantId)).aiDocuments) throw new UserError("Job cards by WhatsApp are part of the Pro plan.");
  await withPlatform(driver, async (q) => {
    await q.query("update public.tenants set wa_jobcards_enabled = $2, wa_jobcards_by = case when $2 then $3::uuid else null end, wa_jobcards_at = case when $2 then now() else null end where id = $1", [m.tenantId, on, m.userId]);
  });
}

// ---------- Who is writing ----------

type Candidate = { tenant: ActiveTenant; employeeId: string; userId: string; name: string };

const lastTen = (e164: string) => e164.replace(/\D/g, "").slice(-10);

/** Active employees, in organizations that offer this, whose phone number is the sender's. Only the last ten digits are compared, so 0300 1234567 and +92 300 1234567 match. */
async function findSender(driver: Driver, from: string): Promise<Candidate[]> {
  const digits = lastTen(from);
  if (digits.length < 7) return [];
  const tenants = await withPlatform(driver, async (q) =>
    (await q.query<{ id: string; schema_name: string; name: string; currency: string | null }>(
      "select id, schema_name, name, currency from public.tenants where wa_jobcards_enabled and status = 'active' and provision_state = 'ready' order by created_at limit 200")).rows);
  const out: Candidate[] = [];
  for (const t of tenants) {
    const tenant: ActiveTenant = { id: t.id, schema: t.schema_name, name: t.name, currency: t.currency ?? undefined };
    const rows = await withTenant(driver, { schema: t.schema_name, userId: "00000000-0000-0000-0000-000000000000", role: "system" }, async (q) =>
      (await q.query<{ id: string; user_id: string; full_name: string }>(
        `select id, user_id, full_name from employees where active and user_id is not null and right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $1 limit 2`, [digits])).rows);
    if (rows.length !== 1) continue;                                   // none, or two employees with one number: never guess
    if (!(await waJobCardsOffered(driver, t.id))) continue;
    out.push({ tenant, employeeId: rows[0].id, userId: rows[0].user_id, name: rows[0].full_name });
  }
  return out;
}

type Intake = { id: string; rounds: number; draft: StoredDraft; media: { path: string; name: string; mime: string }[] };
type StoredDraft = { vehicle_id: string | null; vehicle_label: string | null; registration_no: string | null; category: string; reason_category: string; cause_text: string; priority: string };

async function openIntake(q: Queryable, employeeId: string): Promise<Intake | null> {
  await q.query("update whatsapp_intake set status = 'lapsed', closed_at = now() where status = 'waiting' and expires_at < now() and employee_id = $1", [employeeId]);
  const r = (await q.query<Intake>("select id, rounds, draft, media from whatsapp_intake where employee_id = $1 and status = 'waiting'", [employeeId])).rows[0];
  return r ?? null;
}

const bare = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

async function findVehicle(q: Queryable, employeeId: string, scopeOwn: boolean, reg: string | null): Promise<{ id: string; label: string } | null> {
  if (!reg || bare(reg).length < 3) return null;
  const v = (await q.query<{ id: string; registration_no: string; make: string | null; model: string | null }>(
    `select v.id, v.registration_no, v.make, v.model from vehicles v
      where upper(regexp_replace(v.registration_no, '[^A-Za-z0-9]', '', 'g')) = $1 and v.status <> 'retired' and dept_ok(v.id)
        and ($3::boolean = false or exists (select 1 from vehicle_custody c where c.vehicle_id = v.id and c.employee_id = $2 and c.to_date is null)) limit 2`, [bare(reg), employeeId, scopeOwn])).rows;
  if (v.length !== 1) return null;
  return { id: v[0].id, label: `${v[0].registration_no}${v[0].make || v[0].model ? ` (${[v[0].make, v[0].model].filter(Boolean).join(" ")})` : ""}` };
}

const reasonLabel = (c: string) => REASON_CATEGORY[c] ?? "Other";
function summary(d: StoredDraft, photos: number): string {
  return [
    `Job card for ${d.vehicle_label ?? "a vehicle (registration not yet known)"}:`, d.cause_text,
    `Reason: ${reasonLabel(d.reason_category)}. Priority: ${d.priority}.${photos ? ` ${photos} photo${photos === 1 ? "" : "s"} attached.` : ""}`,
  ].join("\n");
}

// ---------- One incoming message ----------

/** Handles a message from a known employee. Returns handled:false for anyone else, so the other WhatsApp flows still run. */
export async function processWhatsAppJobCard(driver: Driver, deps: IntakeDeps, msg: InboundMessage): Promise<IntakeOutcome> {
  const found = await findSender(driver, msg.from);
  if (found.length === 0) return NOT_MINE;

  // Which company, when the number belongs to more than one: the message starts with its name and a colon, or the person has a draft open in one.
  let text = msg.text.trim();
  let who: Candidate | undefined;
  if (found.length === 1) who = found[0];
  else {
    const m = /^([^:\n]{2,60}):\s*([\s\S]*)$/.exec(text);
    const named = m ? found.find((c) => c.tenant.name.toLowerCase() === m[1].trim().toLowerCase()) : undefined;
    if (named) { who = named; text = (m![2] ?? "").trim(); }
    else {
      const open: Candidate[] = [];
      for (const c of found) if (await withTenant(driver, { schema: c.tenant.schema, userId: c.userId, role: "system" }, (q) => openIntake(q, c.employeeId))) open.push(c);
      if (open.length === 1) who = open[0];
      else return said(`This number is registered with more than one company. Start your message with the company name and a colon, for example: ${found[0].tenant.name}: LHR-1001 brake noise.`);
    }
  }
  const me = who!;
  // A reply to one of our other messages (a workshop request, an odometer request) with nothing open here is not ours to answer.
  if (msg.contextId && !(await withTenant(driver, { schema: me.tenant.schema, userId: me.userId, role: "system" }, (q) => openIntake(q, me.employeeId)))) return NOT_MINE;

  if (!(await allowShared(driver, `wa-intake-msg:${me.tenant.id}:${lastTen(msg.from)}`, MESSAGES_PER_HOUR, HOUR))) return said("You have sent a lot of messages. Please wait a while, or raise the job card in the app.");

  const m = await membershipIn(driver, me.tenant, me.userId);
  if (!m) return said(`Your login for ${me.tenant.name} is not active. Please ask your administrator.`);
  const allowed = await withTenant(driver, m, (q) => can(q, m.role, "jobcard.create"));
  if (!allowed) return said(`Your role in ${me.tenant.name} cannot raise job cards. Please ask your administrator.`);

  const intake = await withTenant(driver, m, (q) => openIntake(q, me.employeeId));
  const word = text.trim();
  if (intake && !msg.media.length && NO.test(word)) {
    await withTenant(driver, m, (q) => q.query("update whatsapp_intake set status = 'cancelled', closed_at = now() where id = $1", [intake.id]));
    return said("Cancelled. Nothing was sent. Message me again whenever you need a job card.");
  }
  if (intake && !msg.media.length && YES.test(word)) return confirm(driver, m, me, intake);
  return draftFrom(driver, deps, m, me, intake, text, msg);
}

async function confirm(driver: Driver, m: Membership, me: Candidate, intake: Intake): Promise<IntakeOutcome> {
  const d = intake.draft;
  if (!d.vehicle_id) return said("I still need the vehicle. Reply with its registration number, for example LHR-1001.");
  try {
    const card = await withTenant(driver, m, async (q) => {
      const reason = (await q.query<{ id: string }>("select id from reason_codes where active and category = $1 order by code limit 1", [d.reason_category])).rows[0]
        ?? (await q.query<{ id: string }>("select id from reason_codes where active order by (category = 'other') desc, code limit 1")).rows[0];
      return reason ?? null;
    });
    if (!card) return said("This company has no reasons set up yet, so I cannot raise the job card. Please use the app.");
    const made = await createJobCard(driver, m, { vehicle_id: d.vehicle_id, requested_by: me.employeeId, category: d.category, reason_code_id: card.id, cause_text: d.cause_text, priority: d.priority }, true);
    await withTenant(driver, m, async (q) => {
      await q.query("update job_cards set source = 'whatsapp' where id = $1", [made.id]);
      for (const f of intake.media) await q.query("insert into attachments(entity_type, entity_id, storage_path, file_name, mime_type, uploaded_by) values ('job_card', $1, $2, $3, $4, $5)", [made.id, f.path, f.name, f.mime, m.userId]);
      await q.query("update whatsapp_intake set status = 'confirmed', job_card_id = $2, closed_at = now() where id = $1", [intake.id, made.id]);
    });
    return said(`Done. Job card ${made.job_no} has been raised for ${d.vehicle_label ?? "the vehicle"} and sent for approval. You can follow it in the app.`);
  } catch (e) {
    if (e instanceof UserError || (e as { name?: string })?.name === "ForbiddenError") {
      await withTenant(driver, m, (q) => q.query("update whatsapp_intake set status = 'cancelled', closed_at = now() where id = $1", [intake.id]));
      return said(`I could not raise that job card: ${e instanceof UserError ? e.message : "you are not allowed to for that vehicle"} Please use the app.`);
    }
    throw e;
  }
}

async function draftFrom(driver: Driver, deps: IntakeDeps, m: Membership, me: Candidate, intake: Intake | null, text: string, msg: InboundMessage): Promise<IntakeOutcome> {
  if (intake && intake.rounds >= MAX_ROUNDS + 1) {
    await withTenant(driver, m, (q) => q.query("update whatsapp_intake set status = 'cancelled', closed_at = now() where id = $1", [intake.id]));
    return said("We have gone back and forth a few times. Please start again with one message, or raise the job card in the app.");
  }
  if (!msg.media.length && text.length < 3) return said("Tell me the vehicle's registration number and what is wrong with it. You can add up to 3 photos.");
  if (!(await allowShared(driver, `wa-intake-draft:${me.tenant.id}:${lastTen(msg.from)}`, DRAFTS_PER_DAY, DAY))) return said("You have reached today's limit for job cards by WhatsApp. Please use the app.");
  const perDay = (await tenantPlan(driver, me.tenant.id)).aiPerDay;
  if (perDay > 0 && !(await allowShared(driver, `wa-intake-org:${me.tenant.id}`, perDay, DAY))) return said("Your company has reached today's limit for job cards by WhatsApp. Please use the app.");

  // Photos: ordinary images only, up to three, each stored where the job card's other files go.
  const files: AiFile[] = [];
  const stored: { path: string; name: string; mime: string }[] = [];
  const room = MAX_PHOTOS - (intake?.media.length ?? 0);
  let skipped = 0;
  for (const med of msg.media) {
    if (files.length >= room) { skipped++; continue; }
    try {
      const got = await deps.fetchMedia(med.id, MAX_PHOTO_BYTES);
      const mime = (got.mime ?? med.mime ?? "").toLowerCase();
      if (!IMAGE_MIME.has(mime) || got.bytes.length > MAX_PHOTO_BYTES) { skipped++; continue; }
      const name = `photo-${files.length + 1}.${EXT[mime]}`;
      const path = `${me.tenant.schema}/intake/${deps.newId()}/${name}`;
      await deps.store(path, got.bytes, mime);
      files.push({ name, mime, bytes: got.bytes });
      stored.push({ path, name, mime });
    } catch { skipped++; }
  }

  const previous: JobCardDraft | null = intake ? { readable: true, registration_no: intake.draft.registration_no, category: intake.draft.category, reason_category: intake.draft.reason_category, description: intake.draft.cause_text, priority: intake.draft.priority, warnings: [] } : null;
  const read = await readJobCardMessage({ text, previous, files }, deps.create);
  if (read.status !== "ok") {
    if (read.status === "unreadable" && intake) return said(`${read.reason} Reply with a correction, YES to send the draft above, or NO to cancel.`);
    return said(read.reason);
  }
  const d = read.draft;
  const vehicle = await withTenant(driver, m, (q) => findVehicle(q, me.employeeId, m.vehicleScope === "own", d.registration_no ?? intake?.draft.registration_no ?? null));
  const draft: StoredDraft = {
    vehicle_id: vehicle?.id ?? null, vehicle_label: vehicle?.label ?? null, registration_no: d.registration_no ?? intake?.draft.registration_no ?? null,
    category: d.category, reason_category: d.reason_category, cause_text: d.description, priority: d.priority,
  };
  const media = [...(intake?.media ?? []), ...stored].slice(0, MAX_PHOTOS);
  await withTenant(driver, m, async (q) => {
    await q.query("delete from whatsapp_intake where status <> 'waiting' and closed_at < now() - interval '7 days'");
    if (intake) {
      await q.query(
        `update whatsapp_intake set draft = $2::jsonb, media = $3::jsonb, rounds = rounds + 1, expires_at = now() + interval '30 minutes', model = $4,
                input_tokens = input_tokens + $5, output_tokens = output_tokens + $6 where id = $1`, [intake.id, JSON.stringify(draft), JSON.stringify(media), read.model, read.inputTokens, read.outputTokens]);
    } else {
      await q.query("insert into whatsapp_intake(employee_id, draft, media, model, input_tokens, output_tokens) values ($1, $2::jsonb, $3::jsonb, $4, $5, $6)",
        [me.employeeId, JSON.stringify(draft), JSON.stringify(media), read.model, read.inputTokens, read.outputTokens]);
    }
  });

  const lines = [summary(draft, media.length)];
  if (skipped) lines.push(`${skipped} file${skipped === 1 ? " was" : "s were"} not used (only up to ${MAX_PHOTOS} ordinary photos are read).`);
  for (const w of d.warnings) lines.push(`Note: ${w}`);
  if (!draft.vehicle_id) lines.push(draft.registration_no ? `I could not find a vehicle ${draft.registration_no} that you can raise a card for. Reply with the correct registration number.` : "Which vehicle is this for? Reply with its registration number.");
  else lines.push("Reply YES to send it, send a correction, or reply NO to cancel.");
  return said(lines.join("\n"));
}
