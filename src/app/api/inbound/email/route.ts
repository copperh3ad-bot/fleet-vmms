// Where Resend hands the app a workshop's reply (ADR-033). Open to the internet but does nothing for anyone except Resend: the call must carry a valid
// signature made with a secret only Resend and this app hold, and be recent. The reply is then filed on the job card by src/lib/vendorflow/inbound.ts.
// It answers 200 for anything it chooses not to file (so Resend does not keep retrying) and 500 only when something temporary went wrong (so it does);
// filing the same message twice is harmless. It never logs an address, a subject, a message or a link.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDriver } from "@/lib/db";
import { verifyWebhook } from "@/lib/email/webhook";
import { realInboundDeps } from "@/lib/email/resend-inbound";
import { processInboundEmail } from "@/lib/vendorflow/inbound";
import { storeInboundFile } from "@/lib/admin/service";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

const MAX_BODY = 100_000;
const reply = (status: number, body: Record<string, unknown> = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const eventSchema = z.object({
  type: z.string().max(60),
  data: z.object({
    email_id: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
    to: z.array(z.string().max(320)).max(20).default([]),
    received_for: z.array(z.string().max(320)).max(20).default([]),
  }),
});

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret || !process.env.RESEND_API_KEY) return reply(500, { error: "not set up" });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return reply(413);
  const body = await req.text();
  if (body.length > MAX_BODY) return reply(413);
  // Resend signs with Svix: the same scheme as Supabase's hook, under svix-* header names.
  const ok = verifyWebhook(secret, body, { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") });
  if (!ok) return reply(401, { error: "not allowed" });

  let event;
  try { event = eventSchema.parse(JSON.parse(body)); } catch { return reply(400, { error: "unreadable" }); }
  if (event.type !== "email.received") return reply(200, { ignored: true });

  const driver = getDriver();
  if (!(await allowShared(driver, `inbound-ip:${await clientIp()}`, 120, 600))) return reply(429);
  try {
    const out = await processInboundEmail(driver, realInboundDeps(storeInboundFile), { emailId: event.data.email_id, addresses: [...event.data.to, ...event.data.received_for] });
    return reply(200, { status: out.status });
  } catch (e) {
    console.error(`inbound-email: could not file a reply: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`);
    return reply(500, { error: "try again" });
  }
}
