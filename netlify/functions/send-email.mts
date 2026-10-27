// Answers Supabase's Send Email hook (ADR-024) at /api/auth/send-email, ahead of the page server. Supabase waits 5 seconds; the
// whole Next.js server takes about 4 to wake up after it has been idle, so a first sign-up could be rolled back after its email was
// already sent. This function carries only the email code, so it wakes in a fraction of a second. It is the same public address,
// checks the same signature and does the same thing as src/app/api/auth/send-email/route.ts, so it adds no new endpoint (rule 5).
import type { Config } from "@netlify/functions";
import { handleSendEmailHook } from "../../src/lib/email/hook";

const sendEmail = async (req: Request): Promise<Response> =>
  req.method === "POST" ? handleSendEmailHook(req) : new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });

export default sendEmail;

export const config: Config = { path: "/api/auth/send-email" };
