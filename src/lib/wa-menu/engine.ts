// The WhatsApp menu and its guided questionnaires (ADR-079, a Pro feature). A known employee says Hi and gets a numbered list of what they may do; each choice asks its questions one at
// a time, checks every answer before asking the next, and ends in a summary. Only YES creates anything, through the same function the app uses, with the sender's own role, so approval
// and every other rule are unchanged. Run by the signed WhatsApp webhook (src/app/api/inbound/whatsapp/route.ts). Never logs a phone number, a message or an answer.
import type { Driver, Queryable } from "@/lib/db/types";
import { withTenant } from "@/lib/db/tenant";
import { membershipIn, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { allowShared } from "@/lib/rate-limit";
import { waJobCardsOffered } from "@/lib/wa-jobcards/service";
import type { InboundMessage } from "@/lib/whatsapp";
import { findMenuSender, lastTen } from "./identity";
import { flowById, FLOWS } from "./flows";
import { isBack, isCancel, isEdit, isGreeting, isSkip, isYes, listChoices } from "./text";
import { MAX_PHOTOS, takePhotos, type PhotoDeps, type StoredPhoto } from "./photos";
import type { Answers, Candidate, Ctx, Flow } from "./types";

export const MENU_MESSAGES_PER_HOUR = 40;
const HOUR = 3600;

export type MenuOutcome = { handled: boolean; reply: string | null };
const said = (reply: string | null): MenuOutcome => ({ handled: true, reply });
const NOT_MINE: MenuOutcome = { handled: false, reply: null };

type Session = { id: string; flow: string; step: string; answers: Answers; last_message_id: string | null; status: string };
const FOOTER = "Send CANCEL to stop, or MENU for the menu.";

async function openSession(q: Queryable, employeeId: string): Promise<Session | null> {
  await q.query("update whatsapp_sessions set status = 'lapsed', closed_at = now() where status = 'open' and expires_at < now() and employee_id = $1", [employeeId]);
  return (await q.query<Session>("select id, flow, step, answers, last_message_id, status from whatsapp_sessions where employee_id = $1 and status in ('open', 'submitting')", [employeeId])).rows[0] ?? null;
}

async function save(q: Queryable, id: string, patch: { flow?: string; step: string; answers: Answers }) {
  await q.query(
    "update whatsapp_sessions set flow = coalesce($2, flow), step = $3, answers = $4::jsonb, expires_at = now() + interval '30 minutes' where id = $1",
    [id, patch.flow ?? null, patch.step, JSON.stringify(patch.answers)]);
}
const close = (q: Queryable, id: string, status: "done" | "cancelled", result?: string) =>
  q.query("update whatsapp_sessions set status = $2, result = $3, closed_at = now() where id = $1", [id, status, result ?? null]);

const firstName = (full: string) => full.trim().split(/\s+/)[0] || "there";

/** The flows this person may use right now. */
async function available(driver: Driver, m: Membership): Promise<Flow[]> {
  const out: Flow[] = [];
  for (const f of FLOWS) if (await f.allowed(driver, m).catch(() => false)) out.push(f);
  return out;
}

async function showMenu(driver: Driver, m: Membership, me: Candidate, old: Session | null): Promise<MenuOutcome> {
  const flows = await available(driver, m);
  await withTenant(driver, m, async (q) => {
    if (old) await close(q, old.id, "cancelled");
    await q.query("delete from whatsapp_sessions where closed_at < now() - interval '1 day'");
  });
  if (flows.length === 0) return said(`Hello ${firstName(me.name)}. There is nothing I can do for your role in ${me.tenant.name} here yet. Please use the app.`);
  await withTenant(driver, m, (q) => q.query("insert into whatsapp_sessions(employee_id, flow, step, answers) values ($1, 'menu', 'choose', $2::jsonb)", [me.employeeId, JSON.stringify({ _menu: flows.map((f) => f.id) })]));
  return said(`Hello ${firstName(me.name)}, this is Fleet OTG for ${me.tenant.name}. What would you like to do?\n${listChoices(flows.map((f) => ({ id: f.id, label: f.label })))}\n\nReply with a number. ${FOOTER}`);
}

export async function processWhatsAppMenu(driver: Driver, msg: InboundMessage, opts: { now?: Date; photos?: PhotoDeps } = {}): Promise<MenuOutcome> {
  const { found, shared } = await findMenuSender(driver, msg.from);
  let text = msg.text.trim();
  if (found.length === 0) return shared && isGreeting(text) ? said("This phone number is used by more than one person, so I cannot tell who is writing. Please use the app.") : NOT_MINE;

  // Which company, when the number belongs to more than one: the message starts with its name and a colon, or the person has a conversation open in one.
  let me: Candidate | undefined;
  if (found.length === 1) me = found[0];
  else {
    const named = /^([^:\n]{2,60}):\s*([\s\S]*)$/.exec(text);
    const byName = named ? found.find((c) => c.tenant.name.toLowerCase() === named[1].trim().toLowerCase()) : undefined;
    if (byName) { me = byName; text = (named![2] ?? "").trim(); }
    else {
      const open: Candidate[] = [];
      for (const c of found) if (await withTenant(driver, { schema: c.tenant.schema, userId: c.userId, role: "system" }, (q) => openSession(q, c.employeeId))) open.push(c);
      if (open.length === 1) me = open[0];
      else if (isGreeting(text)) return said(`This number is registered with more than one company. Start your message with the company name and a colon, for example: ${found[0].tenant.name}: Hi`);
      else return NOT_MINE;
    }
  }
  const mine = me!;
  const sys = { schema: mine.tenant.schema, userId: mine.userId, role: "system" };

  const hasOpen = await withTenant(driver, sys, (q) => openSession(q, mine.employeeId));
  // Meta delivers a message again when it does not hear back in time. A message already handled, even one that finished its conversation, is not handled twice.
  if (msg.id && (await withTenant(driver, sys, (q) => q.query("select 1 from whatsapp_sessions where employee_id = $1 and last_message_id = $2 limit 1", [mine.employeeId, msg.id]))).rows.length > 0) return said(null);
  // A reply to one of our other messages (a workshop request, an odometer request) with nothing open here belongs to those flows.
  if (msg.contextId && !hasOpen) return NOT_MINE;
  if (!hasOpen && !isGreeting(text) && text.length === 0) return NOT_MINE;                      // a photo or file with nothing to say, and nothing open

  if (!(await allowShared(driver, `wa-menu-msg:${mine.tenant.id}:${lastTen(msg.from)}`, MENU_MESSAGES_PER_HOUR, HOUR))) return said("You have sent a lot of messages. Please wait a while, or use the app.");
  const m = await membershipIn(driver, mine.tenant, mine.userId);
  if (!m) return said(`Your login for ${mine.tenant.name} is not active. Please ask your administrator.`);
  const now = opts.now ?? new Date();

  if (!hasOpen) {
    if (isGreeting(text)) return showMenu(driver, m, mine, null);
    // Not a greeting and nothing open. Free text about a vehicle problem belongs to the AI job card draft where that is on; otherwise show the menu.
    if (await waJobCardsOffered(driver, mine.tenant.id).catch(() => false)) return NOT_MINE;
    const recentlyLapsed = (await withTenant(driver, m, (q) => q.query("select 1 from whatsapp_sessions where employee_id = $1 and status = 'lapsed' and closed_at > now() - interval '2 hours' limit 1", [mine.employeeId]))).rows.length > 0;
    if (recentlyLapsed) return said("That conversation timed out after 30 minutes. Say Hi to start again.");
    return showMenu(driver, m, mine, null);
  }

  return continueSession(driver, m, mine, hasOpen, text, msg, now, opts.photos);
}

async function continueSession(driver: Driver, m: Membership, me: Candidate, session: Session, text: string, msg: InboundMessage, now: Date, photoDeps?: PhotoDeps): Promise<MenuOutcome> {
  if (session.last_message_id === msg.id) return said(null);                        // Meta delivered the same message twice
  await withTenant(driver, m, (q) => q.query("update whatsapp_sessions set last_message_id = $2 where id = $1", [session.id, msg.id]));
  if (session.status === "submitting") return said(null);                           // being sent right now

  if (isCancel(text) || (session.step === "confirm" && /^(no|nahi|nahin)[.! ]*$/i.test(text))) {
    await withTenant(driver, m, (q) => close(q, session.id, "cancelled"));
    return said("Cancelled. Nothing was sent. Say Hi whenever you need me.");
  }
  if (/^(menu|0)[.! ]*$/i.test(text)) return showMenu(driver, m, me, session);
  const answers: Answers = session.answers ?? {};

  // The menu: the person picks a number.
  if (session.flow === "menu") {
    const ids = (answers._menu as string[] | undefined) ?? [];
    const n = /^\d{1,2}$/.test(text) ? Number(text) : 0;
    const flow = ids[n - 1] ? flowById(ids[n - 1]) : undefined;
    if (!flow) {
      if (isGreeting(text)) return showMenu(driver, m, me, session);
      return said(`Please reply with a number from 1 to ${ids.length}, or CANCEL.`);
    }
    if (!(await flow.allowed(driver, m).catch(() => false))) { await withTenant(driver, m, (q) => close(q, session.id, "cancelled")); return said("That is not available to you any more. Say Hi to see the menu again."); }
    const c: Ctx = { driver, m, me, answers: {}, now };
    const question = await flow.steps[0].ask(c);
    await withTenant(driver, m, (q) => save(q, session.id, { flow: flow.id, step: flow.steps[0].key, answers: c.answers }));
    return said(`${flow.label}. I will ask a few questions.\n\n${question}\n\n${FOOTER} Send BACK to go back one question.`);
  }

  const flow = flowById(session.flow);
  if (!flow) { await withTenant(driver, m, (q) => close(q, session.id, "cancelled")); return said("Something changed, so I stopped that. Say Hi to start again."); }
  const c: Ctx = { driver, m, me, answers, now };

  // The summary: YES sends, EDIT starts again.
  if (session.step === "confirm") {
    if (isEdit(text)) {
      const fresh: Ctx = { ...c, answers: {} };
      const question = await flow.steps[0].ask(fresh);
      await withTenant(driver, m, (q) => save(q, session.id, { step: flow.steps[0].key, answers: fresh.answers }));
      return said(`Let us start again.\n\n${question}`);
    }
    if (!isYes(text)) return said("Reply YES to send it, EDIT to start again, or CANCEL.");
    return submit(driver, m, me, session, flow, c);
  }

  const idx = flow.steps.findIndex((s) => s.key === session.step);
  const step = flow.steps[idx];
  if (!step) { await withTenant(driver, m, (q) => close(q, session.id, "cancelled")); return said("Something changed, so I stopped that. Say Hi to start again."); }

  if (isGreeting(text) && !step.optional) {
    return said(`We are in the middle of "${flow.label}". ${await step.ask(c)}\n\n${FOOTER}`);
  }
  if (isBack(text)) {
    if (idx === 0) return said(`That is the first question. ${await step.ask(c)}\n\n${FOOTER}`);
    const prev = flow.steps[idx - 1];
    delete answers[prev.key];
    await withTenant(driver, m, (q) => save(q, session.id, { step: prev.key, answers }));
    return said(await prev.ask({ ...c, answers }));
  }
  // A step that takes photos: a picture is kept, DONE or SKIP moves on, anything else is explained.
  if (step.photos) {
    const have = ((answers.photos as StoredPhoto[] | undefined) ?? []);
    if (msg.media.length) {
      if (!photoDeps) return said("I cannot take photos just now. Reply SKIP to go on without.");
      const { stored, skipped } = await takePhotos(photoDeps, me.tenant.schema, msg.media, have.length);
      answers.photos = [...have, ...stored];
      await withTenant(driver, m, (q) => save(q, session.id, { step: step.key, answers }));
      const n = (answers.photos as StoredPhoto[]).length;
      const lines = [n > have.length ? `Got it: ${n} of ${MAX_PHOTOS} photos.` : "I could not use that file."];
      if (skipped) lines.push(`${skipped} file${skipped === 1 ? " was" : "s were"} not used (only ordinary photos, up to ${MAX_PHOTOS}).`);
      lines.push(n >= MAX_PHOTOS ? "That is the most I can take. Reply DONE to continue." : "Send another, or reply DONE to continue.");
      return said(lines.join(" "));
    }
    if (!(isSkip(text) || /^(done|finished|that'?s all|no more)[.! ]*$/i.test(text))) return said(`Please send a photo, or reply DONE${have.length ? "" : " or SKIP"}.`);
    answers.photos = have.length ? have : null;
    return advance(driver, m, flow, session, c, answers, idx);
  }
  if (msg.media.length && !text) return said("Please type your answer. I cannot read photos or files here.");

  let value: unknown;
  if (step.optional && isSkip(text)) value = null;
  else {
    const r = await step.parse(text, c);
    if (!r.ok) return said(`${r.error}\n\n${await step.ask(c)}`);
    value = r.value;
  }
  answers[step.key] = value;
  return advance(driver, m, flow, session, c, answers, idx);
}

/** The next question, or the summary when that was the last one. */
async function advance(driver: Driver, m: Membership, flow: Flow, session: Session, c: Ctx, answers: Answers, idx: number): Promise<MenuOutcome> {
  const next = flow.steps[idx + 1];
  if (next) {
    const question = await next.ask({ ...c, answers });
    await withTenant(driver, m, (q) => save(q, session.id, { step: next.key, answers }));
    return said(question);
  }
  await withTenant(driver, m, (q) => save(q, session.id, { step: "confirm", answers }));
  return said(`${flow.summary(answers)}\n\nReply YES to send it, EDIT to start again, or CANCEL.`);
}

async function submit(driver: Driver, m: Membership, me: Candidate, session: Session, flow: Flow, c: Ctx): Promise<MenuOutcome> {
  const claimed = await withTenant(driver, m, async (q) => (await q.query("update whatsapp_sessions set status = 'submitting' where id = $1 and status = 'open' returning id", [session.id])).rows.length === 1);
  if (!claimed) return said(null);                                                   // already being sent
  try {
    if (!(await flow.allowed(driver, m))) throw new UserError("you are not allowed to do that any more");
    const reply = await flow.submit(c);
    await withTenant(driver, m, (q) => close(q, session.id, "done", reply.slice(0, 200)));
    return said(reply);
  } catch (e) {
    if (e instanceof UserError || (e as { name?: string })?.name === "ForbiddenError") {
      await withTenant(driver, m, (q) => close(q, session.id, "cancelled"));
      return said(`I could not send that: ${e instanceof UserError ? e.message : "you are not allowed to"}. Please use the app, or say Hi to try again.`);
    }
    await withTenant(driver, m, (q) => q.query("update whatsapp_sessions set status = 'open' where id = $1 and status = 'submitting'", [session.id]));
    throw e;
  }
}
