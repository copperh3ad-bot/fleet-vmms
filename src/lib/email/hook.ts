// Where Supabase hands the app an email to send (ADR-024). It is open to the internet but does nothing for anyone except
// Supabase: the call must carry a valid signature made with a secret only Supabase and this app hold, and be recent. It
// sends the email through the owner's mail service. It never logs an address, a code or a link, and answers with only a
// short reason. If it cannot send, it says so, so Supabase tells the person instead of pretending the email went out.
//
// Written against the plain Request and Response of the web, with no Next.js import, so the same code runs in the page server
// (src/app/api/auth/send-email/route.ts) and in the small function that answers first (netlify/functions/send-email.mts, ADR-024).
// Supabase waits 5 seconds for an answer; the whole page server needs about 4 of them just to wake up.
import { verifyWebhook } from "./webhook";
import { buildMail, hookSchema } from "./templates";
import { EmailNotConfigured, mailFailure, sendMail } from "./send";
import { SITE_URL } from "../site";
import { isLoginEmail } from "../auth/username";

const MAX_BODY = 100_000;
const fail = (status: number, message: string) => Response.json({ error: { http_code: status, message } }, { status, headers: { "Cache-Control": "no-store" } });

export async function handleSendEmailHook(req: Request): Promise<Response> {
  const secret = process.env.AUTH_HOOK_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!secret || !supabaseUrl) return fail(500, "The email hook is not set up on this server.");
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return fail(413, "Too large.");
  const body = await req.text();
  if (body.length > MAX_BODY) return fail(413, "Too large.");
  const ok = verifyWebhook(secret, body, { id: req.headers.get("webhook-id"), timestamp: req.headers.get("webhook-timestamp"), signature: req.headers.get("webhook-signature") });
  if (!ok) return fail(401, "Not allowed.");

  let payload;
  try { payload = hookSchema.parse(JSON.parse(body)); } catch { return fail(400, "Unreadable request."); }
  // A made-up login address (ADR-025) has no mailbox. Nothing is sent to it, and Supabase is told it went fine.
  if (isLoginEmail(payload.user.email)) return Response.json({}, { headers: { "Cache-Control": "no-store" } });
  try {
    await sendMail(buildMail(payload, { supabaseUrl, siteUrl: SITE_URL }));
  } catch (e) {
    console.error(e instanceof EmailNotConfigured ? "send-email: mail service not configured" : `send-email: the mail service refused the message: ${mailFailure(e)}`);
    return fail(500, "The email could not be sent. Try again in a moment.");
  }
  // The hook runs as a tiny function that must wake fast, so it writes to the host's log, not the database (ADR-070). Never an address, a code or a link.
  console.log(`send-email: ${payload.email_data.email_action_type} email accepted by the mail server`);
  return Response.json({}, { headers: { "Cache-Control": "no-store" } });
}
