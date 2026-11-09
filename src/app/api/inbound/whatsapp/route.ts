// Where Meta hands the app a workshop's or driver's WhatsApp reply (ADR-042). Open to the internet but does nothing for anyone except Meta: every call must carry a valid
// signature made with the app secret that only Meta and this app hold. GET is Meta's one-time check of the address. The reply is filed by src/lib/vendorflow/whatsapp-inbound.ts.
// It answers 200 for anything it chooses not to file (so Meta does not keep retrying) and 500 only when something temporary went wrong (so it does); filing the same message
// twice is harmless. It never logs a number, a message or a link.
import type { NextRequest } from "next/server";
import { getDriver } from "@/lib/db";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { storeInboundFile } from "@/lib/admin/service";
import { failedStatuses, fetchMedia, statusKinds, parseWebhook, sendReplyList, sendReplyText, verifyChallenge, verifyMetaSignature, whatsappInboundConfigured } from "@/lib/whatsapp";
import { processInboundWhatsApp } from "@/lib/vendorflow/whatsapp-inbound";
import { processOdometerReply } from "@/lib/odometer/whatsapp";
import { processWhatsAppJobCard } from "@/lib/wa-jobcards/service";
import { processWhatsAppMenu } from "@/lib/wa-menu/engine";
import { loggedRoute } from "@/lib/activity/route";

const MAX_BODY = 200_000;
const MAX_MESSAGES = 20;
const reply = (status: number, body: Record<string, unknown> = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function getImpl(req: NextRequest) {
  const u = req.nextUrl.searchParams;
  const challenge = verifyChallenge({ mode: u.get("hub.mode"), token: u.get("hub.verify_token"), challenge: u.get("hub.challenge") });
  return challenge === null ? new Response("not allowed", { status: 403 }) : new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

async function postImpl(req: NextRequest) {
  if (!whatsappInboundConfigured()) return reply(500, { error: "not set up" });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return reply(413);
  const body = await req.text();
  if (body.length > MAX_BODY) return reply(413);
  if (!verifyMetaSignature(process.env.WHATSAPP_APP_SECRET!, body, req.headers.get("x-hub-signature-256"))) return reply(401, { error: "not allowed" });

  let messages;
  try {
    const parsed = JSON.parse(body);
    const kinds = statusKinds(parsed);
    if (Object.keys(kinds).length) console.log(`whatsapp delivery status: ${JSON.stringify(kinds)}`);
    for (const f of failedStatuses(parsed).slice(0, 10)) console.error(`whatsapp message not delivered: code ${f.code ?? "?"}: ${f.title}`);          // why an accepted message did not arrive
    messages = parseWebhook(parsed).slice(0, MAX_MESSAGES);
  } catch { return reply(400, { error: "unreadable" }); }
  if (messages.length === 0) return reply(200, { ignored: true });                // delivery and read receipts, other numbers

  const driver = getDriver();
  if (!(await allowShared(driver, `inbound-wa-ip:${await clientIp()}`, 300, 600))) return reply(429);
  const deps = { fetchMedia: (id: string, max: number) => fetchMedia(id, max), store: (p: string, b: Uint8Array, t: string) => storeInboundFile(p, b, t), newId: () => crypto.randomUUID() };
  const tell = (to: string, text: string) => sendReplyText(to, text).catch(() => undefined);          // a failed acknowledgement never undoes the filing
  try {
    for (const m of messages) {
      const odo = await processOdometerReply(driver, m);          // a driver's answer to the monthly odometer request (ADR-050)
      if (odo.handled) { if (odo.reply) await tell(m.from, odo.reply); continue; }
      // A known employee saying Hi, or answering one of the menu's questions (ADR-079). A failure here is answered kindly and never retried, as below.
      try {
        const menu = await processWhatsAppMenu(driver, m, { photos: deps });
        if (menu.handled) {
          if (menu.list && menu.reply) await sendReplyList(m.from, menu.list.body, menu.list.button, menu.list.rows).catch(() => tell(m.from, menu.reply!));   // a list that cannot be sent goes as plain text
          else if (menu.reply) await tell(m.from, menu.reply);
          continue;
        }
      } catch (e) {
        console.error(`inbound-whatsapp: menu failed: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`);
        await tell(m.from, "Sorry, I could not process that just now. Please try again in a few minutes, or use the app.");
        continue;
      }
      // A known employee raising a job card (ADR-061). A failure here is answered kindly and never retried: Meta repeating the message would draft it twice.
      try {
        const wj = await processWhatsAppJobCard(driver, deps, m);
        if (wj.handled) { if (wj.reply) await tell(m.from, wj.reply); continue; }
      } catch (e) {
        console.error(`inbound-whatsapp: job card by WhatsApp failed: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`);
        await tell(m.from, "Sorry, I could not process that just now. Please try again in a few minutes, or raise the job card in the app.");
        continue;
      }
      const out = await processInboundWhatsApp(driver, deps, m);
      if (out.status === "filed") await tell(m.from, `Thank you. We have your message for job card ${out.jobNo}. The fleet office will enter it.`);
      else if (out.status === "no_context" && (await allowShared(driver, `inbound-wa-hint:${m.from}`, 1, 3600))) await tell(m.from, "To answer a request from Fleet OTG, please use Reply on that message, so we know which job it is for.");
    }
    return reply(200, { ok: true });
  } catch (e) {
    console.error(`inbound-whatsapp: could not file a reply: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`);
    return reply(500, { error: "try again" });
  }
}

export const POST = loggedRoute("webhook", "inbound whatsapp", postImpl);

export const GET = loggedRoute("webhook", "whatsapp verification", getImpl);
