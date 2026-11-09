// The WhatsApp menu and its guided questionnaires (ADR-079, a Pro feature). A known employee says Hi and gets a numbered list of what they may do; each choice asks its questions one at
// a time, checks every answer before asking the next, and ends in a summary. Only YES creates anything, through the same function the app uses, with the sender's own role, so approval
// and every other rule are unchanged. Run by the signed WhatsApp webhook (src/app/api/inbound/whatsapp/route.ts). Never logs a phone number, a message or an answer.
import type { Driver, Queryable } from "@/lib/db/types";
import { withTenant } from "@/lib/db/tenant";
import { membershipIn, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { allowShared } from "@/lib/rate-limit";
import { otpChecksOn } from "@/lib/otp-switch";
import { waJobCardsOffered } from "@/lib/wa-jobcards/service";
import type { InboundMessage } from "@/lib/whatsapp";
import { findMenuSender, lastTen } from "./identity";
import { flowById, FLOWS } from "./flows";
import { isBack, isCancel, isEdit, isGreeting, isSkip, isYes, listChoices } from "./text";
import { MAX_PHOTOS, takePhotos, type PhotoDeps, type StoredPhoto } from "./photos";
import type { Answers, Candidate, Ctx, Flow } from "./types";

export const MENU_MESSAGES_PER_HOUR = 40;
const HOUR = 3600;

/** `list` asks the webhook to send a tappable list with this body and these rows. `reply` is the same thing as plain numbered text: it is what goes if the list cannot be sent. */
export type MenuList = { button: string; body: string; rows: { id: string; title: string; description?: string }[] };
export type MenuOutcome = { handled: boolean; reply: string | null; list?: MenuList };
const said = (reply: string | null, list?: MenuList): MenuOutcome => ({ handled: true, reply, ...(list ? { list } : {}) });

const trimTitle = (s: string) => (s.length <= 24 ? s : `${s.slice(0, 23).trimEnd()}…`);
const rowsFrom = (items: { id: string; label: string; short?: string }[]) => items.map((x) => ({ id: x.id, title: trimTitle(x.short ?? x.label), ...((x.short ?? x.label) !== x.label || x.label.length > 24 ? { description: x.label.slice(0, 72) } : {}) }));
/** A question with numbered options, as the body of a list message: the numbered lines are the rows, so they are not repeated in the body. */
const bodyOf = (text: string) => `${text.split("\n").filter((l) => !/^\d{1,2}\. /.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n\nTap the button to choose, or reply with a number.`;

/** The question of a step, as a tappable list when it has up to 10 options. Optional steps get a Skip row. */
function asked(text: string, step: { choices?: (c: Ctx) => { id: string; label: string }[] | null; optional?: boolean }, c: Ctx): MenuOutcome {
  const list = step.choices?.(c) ?? null;
  const room = step.optional ? 9 : 10;
  if (!list || list.length === 0 || list.length > room) return said(text);
  const rows = list.map((x, i) => ({ id: String(i + 1), label: x.label }));
  return said(text, { button: "Choose", body: bodyOf(text), rows: [...rowsFrom(rows), ...(step.optional ? [{ id: "skip", title: "Skip" }] : [])] });
}
const NOT_MINE: MenuOutcome = { handled: false, reply: null };

type Session = { id: string; flow: string; step: string; answers: Answers; last_message_id: string | null; status: string };
const FOOTER = "Send CANCEL to stop, or MENU for the menu.";
const allowShared2 = (driver: Driver, tenantId: string, from: string) => allowShared(driver, `wa-menu-msg:${tenantId}:${lastTen(from)}`, MENU_MESSAGES_PER_HOUR, HOUR);

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

async function showMenu(driver: Driver, m: Membership, me: Candidate, old: Session | null, lastMessageId: string | null = null): Promise<MenuOutcome> {
  const flows = await available(driver, m);
  await withTenant(driver, m, async (q) => {
    if (old) await close(q, old.id, "cancelled");
    await q.query("delete from whatsapp_sessions where closed_at < now() - interval '1 day'");
  });
  if (flows.length === 0) return said(`Hello ${firstName(me.name)}. There is nothing I can do for your role in ${me.tenant.name} here yet. Please use the app.`);
  await withTenant(driver, m, (q) => q.query("insert into whatsapp_sessions(employee_id, flow, step, answers, last_message_id) values ($1, 'menu', 'choose', $2::jsonb, $3)", [me.employeeId, JSON.stringify({ _menu: flows.map((f) => f.id) }), lastMessageId]));
  const text = `Hello ${firstName(me.name)}, this is Fleet OTG for ${me.tenant.name}. What would you like to do?\n${listChoices(flows.map((f) => ({ id: f.id, label: f.label })))}\n\nReply with a number. ${FOOTER}`;
  return said(text, { button: "Choose", body: `Hello ${firstName(me.name)}, this is Fleet OTG for ${me.tenant.name}. What would you like to do?\n\nTap the button to choose, or reply with a number. ${FOOTER}`, rows: rowsFrom(flows.map((f, i) => ({ id: String(i + 1), label: f.label, short: f.short }))) });
}

export async function processWhatsAppMenu(driver: Driver, msg: InboundMessage, opts: { now?: Date; photos?: PhotoDeps } = {}): Promise<MenuOutcome> {
  const betaShared = !(await otpChecksOn(driver));                                 // beta testing mode (ADR-076): a shared number asks who is writing
  const { found, shared } = await findMenuSender(driver, msg.from, { allowShared: betaShared });
  let text = msg.text.trim();
  if (found.length === 0) return shared && isGreeting(text) ? said("This phone number is used by more than one person, so I cannot tell who is writing. Please use the app.") : NOT_MINE;

  // Group by company. Which company, when the number belongs to more than one: the message starts with its name and a colon, or the person has a conversation open in one.
  const groups = [...found.reduce((g, c) => g.set(c.tenant.id, [...(g.get(c.tenant.id) ?? []), c]), new Map<string, Candidate[]>()).values()];
  const hasOpenIn = async (c: Candidate) => withTenant(driver, { schema: c.tenant.schema, userId: c.userId, role: "system" }, (q) => openSession(q, c.employeeId));
  let group: Candidate[] | undefined;
  if (groups.length === 1) group = groups[0];
  else {
    const named = /^([^:\n]{2,60}):\s*([\s\S]*)$/.exec(text);
    const byName = named ? groups.find((g) => g[0].tenant.name.toLowerCase() === named[1].trim().toLowerCase()) : undefined;
    if (byName) { group = byName; text = (named![2] ?? "").trim(); }
    else {
      const open: Candidate[][] = [];
      for (const g of groups) { for (const c of g) if (await hasOpenIn(c)) { open.push(g); break; } }
      if (open.length === 1) group = open[0];
      else if (isGreeting(text)) return said(`This number is registered with more than one company. Start your message with the company name and a colon, for example: ${groups[0][0].tenant.name}: Hi`);
      else return NOT_MINE;
    }
  }

  // Which person, when the number is on the records of several employees of one company (beta testing only). The sender picks from a list; the choice lasts the conversation.
  let me: Candidate | undefined;
  if (group.length === 1) me = group[0];
  else {
    for (const c of group) { const s = await hasOpenIn(c); if (s && s.flow !== "who") { me = c; break; } }
    if (!me) {
      const anchor = group[0];
      const asking = await withTenant(driver, { schema: anchor.tenant.schema, userId: anchor.userId, role: "system" }, (q) => openSession(q, anchor.employeeId));
      const ask = () => said(
        `This phone number is on more than one person's record (testing mode). Who is writing?\n${listChoices(group.map((c) => ({ id: c.employeeId, label: c.name })))}\n\nReply with a number.`,
        { button: "Choose", body: "This phone number is on more than one person's record (testing mode). Who is writing?\n\nTap the button to choose, or reply with a number.", rows: group.map((c, i) => ({ id: String(i + 1), title: trimTitle(c.name) })) });
      if (asking && asking.flow === "who") {
        const sysA = { schema: anchor.tenant.schema, userId: anchor.userId, role: "system" };
        if (isCancel(text)) { await withTenant(driver, sysA, (q) => close(q, asking.id, "cancelled")); return said("Cancelled. Say Hi whenever you need me."); }
        const n = /^\d{1,2}$/.test(text) ? Number(text) : 0;
        const chosen = group[n - 1];
        if (!chosen) return ask();
        await withTenant(driver, sysA, (q) => close(q, asking.id, "cancelled"));
        const cm = await membershipIn(driver, chosen.tenant, chosen.userId);
        if (!cm) return said(`Your login for ${chosen.tenant.name} is not active. Please ask your administrator.`);
        return showMenu(driver, cm, chosen, null, msg.id);
      }
      if (!isGreeting(text)) return NOT_MINE;
      if (!(await allowShared2(driver, group[0].tenant.id, msg.from))) return said("You have sent a lot of messages. Please wait a while, or use the app.");
      await withTenant(driver, { schema: anchor.tenant.schema, userId: anchor.userId, role: "system" }, (q) =>
        q.query("insert into whatsapp_sessions(employee_id, flow, step, answers, last_message_id) values ($1, 'who', 'choose', $2::jsonb, $3)", [anchor.employeeId, JSON.stringify({ _who: group.map((c) => c.employeeId) }), msg.id]));
      return ask();
    }
  }
  const mine = me;
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
    return asked(`${flow.label}. I will ask a few questions.\n\n${question}\n\n${FOOTER} Send BACK to go back one question.`, flow.steps[0], c);
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
    const pc: Ctx = { ...c, answers };
    const question = await prev.ask(pc);
    return asked(question, prev, pc);
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
    if (!r.ok) { const q = await step.ask(c); return asked(`${r.error}\n\n${q}`, step, c); }
    value = r.value;
  }
  answers[step.key] = value;
  return advance(driver, m, flow, session, c, answers, idx);
}

/** The next question, or the summary when that was the last one. */
async function advance(driver: Driver, m: Membership, flow: Flow, session: Session, c: Ctx, answers: Answers, idx: number): Promise<MenuOutcome> {
  const next = flow.steps[idx + 1];
  if (next) {
    const nc: Ctx = { ...c, answers };
    const question = await next.ask(nc);
    await withTenant(driver, m, (q) => save(q, session.id, { step: next.key, answers }));
    return asked(question, next, nc);
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
